import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { assertNoIdentifiers } from '../../deid/index.js'
import {
  type GenerateRequest,
  type LLMClient,
  type LLMProvider,
  LLMResponseError,
} from './types.js'

/**
 * One adapter covers all three providers — Qwen (Model Studio, Singapore),
 * DeepSeek, and Gemini all expose OpenAI-compatible chat completions with
 * JSON-schema structured output.
 *
 * Keeping them behind one adapter is what makes the provider swappable, which
 * is the architectural answer to the brief's data-residency requirement.
 */
export class OpenAICompatibleClient implements LLMClient {
  private readonly client: OpenAI

  constructor(
    readonly provider: LLMProvider,
    readonly model: string,
    options: { apiKey: string; baseURL: string },
  ) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL })
  }

  async generate<T>(request: GenerateRequest<T>): Promise<T> {
    // The egress guard (docs/trd.md §19 row 2). `Deidentified` guarantees the
    // *shape* of what arrives here, not its *provenance* — `markDeidentified`
    // is exported, so a value could in principle be branded without ever
    // passing through detection (§5). This re-scans the payload immediately
    // before it leaves the process and refuses to send it if anything fires.
    //
    // It runs inside the adapter rather than being injected, because a guard a
    // caller can omit by constructing the client differently is not a boundary.
    if (env.DEID_FAIL_CLOSED) {
      assertNoIdentifiers(request.content, request.operation)
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: request.temperature ?? 0.2,
      // The `note_and_gaps` response carries 34 assertions, each with a state,
      // a value and an evidence span, and measured at 3,324 completion tokens
      // on a 3,000-word consultation. That is close enough to the provider's
      // default output ceiling that some runs spill over and return truncated
      // JSON — which surfaces as a parse failure well after the real cause.
      max_tokens: request.maxTokens ?? 8192,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: z.toJSONSchema(request.schema, { target: 'draft-7' }),
        },
      },
    })

    const choice = completion.choices[0]
    const raw = choice?.message.content
    if (!raw) {
      throw new LLMResponseError('Provider returned an empty response', request.operation)
    }

    // Distinguished from malformed JSON deliberately. A truncated response is
    // also unparseable, so without this the failure reads as a provider bug
    // when it is a budget problem with a different fix.
    if (choice?.finish_reason === 'length') {
      throw new LLMResponseError(
        'Provider response hit the output token limit and was truncated',
        request.operation,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new LLMResponseError('Provider returned malformed JSON', request.operation)
    }

    const result = request.schema.safeParse(parsed)
    if (!result.success) {
      throw new LLMResponseError(
        `Provider response failed schema validation: ${z.prettifyError(result.error)}`,
        request.operation,
      )
    }

    return result.data
  }
}
