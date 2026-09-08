import { env } from '../../config/env.js'
import type { Deidentified } from '../../deid/types.js'
import { OpenAICompatibleEmbeddingClient } from './openai-compatible.js'

/**
 * Width of every stored vector. Fixed by the `vector(1024)` column in
 * `prisma/migrations/20260909000000_add_guideline_retrieval`; a different
 * width is a re-embed of the whole corpus, not a config change.
 */
export const EMBEDDING_DIMENSIONS = 1024

/**
 * The second egress point after `LLMClient`, and gated the same way: only the
 * branded `Deidentified` type is accepted, so a retrieval query built from a
 * transcript has been through `backend/src/deid/` before it can reach here.
 * Guideline text passes through the same gate at ingestion rather than being
 * exempted, so there is one rule and no list of exceptions to audit.
 */
export interface EmbeddingClient {
  readonly model: string
  embed(inputs: readonly Deidentified[], operation: string): Promise<number[][]>
}

let cached: EmbeddingClient | undefined

/**
 * Always Qwen, whatever `LLM_PROVIDER` says: the vectors in the database were
 * produced by one model, and a query embedded by another would silently match
 * nothing. Gemini and DeepSeek have no in-region embeddings endpoint anyway.
 */
export function getEmbeddingClient(): EmbeddingClient {
  if (cached) return cached
  if (!env.QWEN_API_KEY) {
    throw new Error('QWEN_API_KEY is required for guideline retrieval embeddings')
  }
  cached = new OpenAICompatibleEmbeddingClient(env.QWEN_EMBEDDING_MODEL, {
    apiKey: env.QWEN_API_KEY,
    baseURL: env.QWEN_BASE_URL,
  })
  return cached
}
