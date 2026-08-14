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
 * Wall-clock bounds on a single provider call (GitHub issue #94).
 *
 * The SDK defaults are a 10-minute timeout and two silent retries, and it
 * retries timeouts, so one operation could occupy roughly 30 minutes against
 * CAP-1's 30-second budget. `max_tokens` below already bounds the response's
 * *size*; nothing bounded its *time*.
 *
 * 60s is roughly 3x the measured worst case (docs/trd.md §19 row 19: mean
 * 19.9s, worst 21.6s through the shipped `analyseNote`), so it cannot fire on a
 * healthy call. One retry is kept because a *fast* transient failure, such as a
 * refused connection inside the first second, still has room to finish inside
 * the budget. It caps the pathological case at two minutes rather than thirty.
 *
 * Both sit on the constructor rather than on each request, so they cover every
 * call path without opt-in. Same reasoning as the egress guard below: a bound a
 * caller can skip by building the client differently is not a bound.
 */
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 1

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
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    })
  }

  async generate<T>(request: GenerateRequest<T>): Promise<T> {
    // The egress guard (docs/trd.md §19 row 2). `Deidentified` guarantees the
    // *shape* of what arrives here, not its *provenance*, so a value could in
    // principle be branded without ever passing through detection (§5).
    // `markDeidentified` has been module-private to `deid/index.ts` since
    // 13/08/26, which closed the import-it-and-brand-anything route; a
    // deliberate `as Deidentified` cast remains possible, because TypeScript
    // cannot prevent one. This re-scans the payload immediately before it
    // leaves the process and refuses to send it if anything fires.
    //
    // It runs inside the adapter rather than being injected, because a guard a
    // caller can omit by constructing the client differently is not a boundary.
    if (env.DEID_FAIL_CLOSED) {
      assertNoIdentifiers(request.content, request.operation)
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: request.temperature ?? 0.2,
      // Headroom, not a target. The largest operation (`clinical_facts`, 34
      // assertions each with a state, a value and an evidence span) measures
      // 2,652 to 2,779 completion tokens on a 3,000-word consultation, so this
      // sits at roughly 3x the observed ceiling.
      //
      // Raising it is not a fix for truncation and has been measured making
      // things worse: at 16,384 the model emitted all 16,384 tokens without
      // terminating. A response that will not stop needs a structural bound
      // (docs/trd.md §21.3, Tier 1) rather than a bigger budget to fill.
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
