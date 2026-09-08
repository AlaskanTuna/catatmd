import type { GuidelineChunk } from '@shared/types'
import { GUIDELINE_CORPUS } from './corpus.js'

/**
 * Serialises the whole corpus into the `suggestions_and_red_flags` system
 * prompt (docs/trd.md §11, §12). The curated corpus is always sent whole;
 * retrieved CPG chunks (`backend/src/retrieval/`) are appended by the caller.
 * Only `id`, `title`, and `summary` are sent; `url`/`sourceLicence`/
 * `verbatimAllowed` are for the review UI, not the model.
 */
export function serialiseCorpusForPrompt(
  corpus: readonly GuidelineChunk[] = GUIDELINE_CORPUS,
): string {
  return corpus.map((chunk) => `[${chunk.id}] ${chunk.title}: ${chunk.summary}`).join('\n')
}
