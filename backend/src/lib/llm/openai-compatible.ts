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

    const raw = completion.choices[0]?.message.content
    if (!raw) {
      throw new LLMResponseError('Provider returned an empty response', request.operation)
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
