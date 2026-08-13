import type { GuidelineChunk } from '@shared/types'
import { GUIDELINE_CORPUS } from './corpus.js'

/**
 * Serialises the whole corpus into the `suggestions_and_red_flags` system
 * prompt (docs/trd.md §11, §12). No retrieval step — at 10-15 chunks,
 * selecting candidate IDs before the call would be unjustifiable complexity.
 * Only `id`, `title`, and `summary` are sent; `url`/`sourceLicence`/
 * `verbatimAllowed` are for the review UI, not the model.
 */
export function serialiseCorpusForPrompt(
  corpus: readonly GuidelineChunk[] = GUIDELINE_CORPUS,
): string {
  return corpus.map((chunk) => `[${chunk.id}] ${chunk.title}: ${chunk.summary}`).join('\n')
}
