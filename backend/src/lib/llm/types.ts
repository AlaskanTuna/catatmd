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

export class LLMResponseError extends Error {
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message)
    this.name = 'LLMResponseError'
  }
}
