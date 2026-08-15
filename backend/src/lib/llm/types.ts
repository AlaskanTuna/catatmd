import type { z } from 'zod'
import type { Deidentified } from '../../deid/types.js'

/**
 * The single egress point to any LLM provider.
 *
 * `content` is `Deidentified`, so nothing that skipped the de-identification
 * gate can be passed here. No other module in the backend may import a provider
 * SDK directly — see AGENTS.md, clinical-safety do-nots.
 */
export interface LLMClient {
  readonly provider: LLMProvider
  readonly model: string

  /**
   * Structured generation. The result is validated against `schema`; a response
   * that does not conform is an error, never a partially-trusted object.
   */
  generate<T>(request: GenerateRequest<T>): Promise<T>

  /**
   * Conversational generation with tools, streamed (GitHub issue #169).
   *
   * **This is the one call path that does not validate against a closed
   * response schema, and that is a deviation worth stating rather than
   * burying.** `.claude/rules/security.md` requires every model response to be
   * `safeParse`d inside the adapter before it reaches a route, because a closed
   * schema with no free-text escape hatch is what defends against a transcript
   * shaped like an instruction. A copilot that answers a doctor in prose cannot
   * have one: prose *is* the output.
   *
   * What replaces it, and why the boundary still holds:
   *
   * - **Tool arguments are still validated.** Everything with a side effect
   *   arrives as a `CopilotProposal`, which is a closed discriminated union
   *   parsed before it leaves the backend. A malformed or invented tool call
   *   fails there.
   * - **Prose has no side effects.** Nothing the model writes is executed,
   *   stored on the record, or acted on. The worst outcome of a successful
   *   injection is wrong words in a chat bubble that the doctor reads as the
   *   copilot's opinion, which is how they already read it.
   * - **The egress guard is unchanged.** `assertNoIdentifiers` runs on this
   *   path exactly as it does on `generate`, because it guards what leaves the
   *   process rather than what comes back.
   */
  stream(request: StreamRequest): AsyncGenerator<StreamChunk>
}

export type LLMProvider = 'qwen' | 'gemini' | 'deepseek'

export interface GenerateRequest<T> {
  /** Names the call site in logs and traces. Never contains patient data. */
  operation: string
  system: string
  content: Deidentified
  schema: z.ZodType<T>
  /** Name given to the provider's structured-output schema. */
  schemaName: string
  temperature?: number
  /** Output ceiling. Defaults to 8192 at the adapter; see `note_and_gaps`. */
  maxTokens?: number
}

/**
 * One turn of conversation. `content` on every turn is `Deidentified`, so the
 * doctor's own typed message goes through the gate exactly like the digest
 * does: they are as able to type a patient's name into a chat box as into
 * anything else, and a boundary that trusted the operator would not be one.
 */
export interface StreamTurn {
  role: 'user' | 'assistant'
  content: Deidentified
}

export interface StreamTool {
  name: string
  description: string
  /** JSON Schema for the arguments, emitted from a Zod schema by the caller. */
  parameters: Record<string, unknown>
}

export interface StreamRequest {
  operation: string
  system: Deidentified
  turns: readonly StreamTurn[]
  tools: readonly StreamTool[]
  temperature?: number
  maxTokens?: number
  /** Aborts the provider call when the doctor closes the panel mid-answer. */
  signal?: AbortSignal
}

/**
 * `tool` arrives once per call with its arguments already reassembled from the
 * provider's deltas, rather than streamed piecemeal. A half-parsed argument
 * object has no use to a caller that must validate it as a whole before acting.
 */
export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: unknown }

export class LLMResponseError extends Error {
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message)
    this.name = 'LLMResponseError'
  }
}
