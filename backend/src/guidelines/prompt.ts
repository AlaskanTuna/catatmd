import type { GuidelineChunk } from '@shared/types'

/**
 * Serialises the given corpus into the `suggestions_and_red_flags` system
 * prompt (docs/trd.md §11, §12). Callers pass the full corpus they want the
 * model to cite from, whether that is the curated corpus, retrieved CPG chunks
 * (`backend/src/retrieval/`), or a union of both.
 *
 * Only `id`, `title`, and `summary` are sent; `url`/`sourceLicence`/
 * `verbatimAllowed` are for the review UI, not the model.
 */
export function serialiseCorpusForPrompt(corpus: readonly GuidelineChunk[]): string {
  return corpus.map((chunk) => `[${chunk.id}] ${chunk.title}: ${chunk.summary}`).join('\n')
}
