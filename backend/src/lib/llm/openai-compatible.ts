import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { assertNoIdentifiers } from '../../deid/index.js'
import {
  type GenerateRequest,
  type LLMClient,
  type LLMProvider,
  LLMResponseError,
  type StreamChunk,
  type StreamRequest,
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
  private readonly resolvesSchemaRefs: boolean

  constructor(
    readonly provider: LLMProvider,
    readonly model: string,
    options: { apiKey: string; baseURL: string; resolvesSchemaRefs: boolean },
  ) {
    this.resolvesSchemaRefs = options.resolvesSchemaRefs
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    })
  }

  /**
   * The JSON Schema sent to the provider, in whichever form is smaller.
   *
   * A shape used more than once can be written out at every site, or once
   * under `definitions` with `$ref` pointers to it. Neither wins everywhere,
   * so this measures instead of assuming (GitHub issue #109). Both figures
   * measured 15/08/26:
   *
   * | Operation        | Inlined  | Referenced |
   * | ---------------- | -------- | ---------- |
   * | `clinical_facts` | 14,240 B | 3,558 B    |
   * | `note_and_gaps`  | 686 B    | 749 B      |
   *
   * `clinical_facts` is 34 copies of one assertion object, so extracting it
   * cuts 75% from the largest prompt in the system and the first call the
   * pipeline makes. `note_and_gaps` has one lightly reused shape, where the
   * pointers cost more than the duplication, and it is also the call that
   * writes the prose. Picking the smaller form leaves that request
   * byte-identical to what it has always been, which is the point: a schema
   * change under a generative call is exactly the kind of regression that
   * degrades a note without failing anything.
   *
   * Emitting twice costs microseconds against a call that measures tens of
   * seconds, and it keeps the rule honest for a schema nobody has weighed yet.
   */
  private emitSchema(schema: GenerateRequest<unknown>['schema']) {
    const inlined = z.toJSONSchema(schema, { target: 'draft-7' })
    // Gemini is the one provider here that will not resolve a pointer: the
    // referencing form returns a bodiless HTTP 400, while an unused
    // `definitions` block is accepted, so it is the `$ref` and not the
    // keyword. Measured against the live endpoint, same date.
    if (!this.resolvesSchemaRefs) return inlined

    const referenced = z.toJSONSchema(schema, { target: 'draft-7', reused: 'ref' })
    return JSON.stringify(referenced).length < JSON.stringify(inlined).length ? referenced : inlined
  }

  /**
   * Streamed conversational generation with tools (GitHub issue #169). See
   * `LLMClient.stream` for why this path validates differently, and what
   * replaces the closed response schema.
   *
   * The egress guard runs over **every** turn, not just the newest. History is
   * supplied by the client, so a caller that replayed an un-gated turn from an
   * earlier session would otherwise smuggle it out under a request whose latest
   * message was clean. Guarding the assembled payload rather than the increment
   * is the same reasoning as guarding inside the adapter rather than at the
   * call site.
   */
  async *stream(request: StreamRequest): AsyncGenerator<StreamChunk> {
    if (env.DEID_FAIL_CLOSED) {
      assertNoIdentifiers(request.system, request.operation)
      for (const turn of request.turns) assertNoIdentifiers(turn.content, request.operation)
    }

    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 1_024,
        stream: true,
        messages: [
          { role: 'system', content: request.system },
          ...request.turns.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
        /*
         * Omitted entirely when there are none, rather than sent as `[]`. A
         * caller with no tools is a real case here (a signed note, where the
         * copilot may read but has nothing to propose), and OpenAI-compatible
         * providers differ on whether an empty array is a valid value or a
         * malformed request.
         */
        ...(request.tools.length > 0 && {
          tools: request.tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }),
      },
      { signal: request.signal },
    )

    /*
     * Tool calls arrive as deltas keyed by index, with the name on the first
     * fragment and the JSON arguments split across the rest. They are
     * accumulated here and emitted once complete, because a caller cannot
     * validate half an argument object, and validation is the only thing
     * standing between a model-authored tool call and a write.
     */
    const pending = new Map<number, { name: string; args: string }>()

    for await (const part of completion) {
      const delta = part.choices[0]?.delta
      if (!delta) continue

      if (delta.content) yield { type: 'text', text: delta.content }

      for (const call of delta.tool_calls ?? []) {
        const entry = pending.get(call.index) ?? { name: '', args: '' }
        if (call.function?.name) entry.name = call.function.name
        if (call.function?.arguments) entry.args += call.function.arguments
        pending.set(call.index, entry)
      }
    }

    for (const [, entry] of [...pending].sort(([a], [b]) => a - b)) {
      if (!entry.name) continue
      let args: unknown
      try {
        args = JSON.parse(entry.args || '{}')
      } catch {
        // Dropped rather than thrown. A malformed argument string is one
        // unusable proposal, and failing the whole turn would discard the
        // prose the doctor is already reading.
        continue
      }
      yield { type: 'tool', name: entry.name, args }
    }
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
          schema: this.emitSchema(request.schema),
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
