import {
  type ClinicalSuggestion,
  type GuidelineChunk,
  makeSuggestionsSchema,
  type RedFlag,
  RedFlagCandidatesSchema,
} from '@shared/types'
import { type ClinicalProfile, getClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { corpusIdsFor } from '../guidelines/index.js'
import { getLLMClient } from '../lib/llm/index.js'
import { buildRedFlagsSystemPrompt, buildSuggestionsSystemPrompt } from './prompt.js'
import { filterUnsafeModelSuggestions, type SuppressedSuggestionId } from './safety.js'

export { buildRedFlagsSystemPrompt, buildSuggestionsSystemPrompt } from './prompt.js'
export { filterUnsafeModelSuggestions } from './safety.js'

/**
 * Operation 2 (docs/trd.md §12). Runs after de-identification and never
 * merges with the deterministic rules engine here — that union is the route
 * handler's job (`redflags/` exports `mergeRedFlags`), so this function
 * returns model candidates only.
 *
 * **Two concurrent calls since #340, not one.** `suggestions_and_red_flags`
 * answered both halves in a single response and was the slowest call in the
 * pipeline, which put it closest to the request bound. Splitting it halves the
 * output each call has to decode, and the two halves want different inputs
 * anyway: only the citing half needs the corpus, so the red-flag half stopped
 * carrying the whole retrieved set as input tokens.
 *
 * **The red-flag half always runs; the citing half often does not.** The
 * citable corpus is the retrieved set and nothing else, so a consultation that
 * retrieved nothing can support no cited suggestion. That used to be a model
 * call whose answer was discarded and replaced with `[]`. It is now no call at
 * all, which is the larger of the two savings on those consultations.
 *
 * `outOfScope` therefore rides on the red-flag half, the one that cannot be
 * skipped. Deriving it from an empty corpus instead would report "outside the
 * guideline scope" for a perfectly in-scope consultation that simply retrieved
 * nothing, and the review page renders those as two different sentences.
 */
export async function generateSuggestions(
  content: Deidentified,
  profile: ClinicalProfile = getClinicalProfile(),
  retrieved: readonly GuidelineChunk[] = [],
): Promise<{
  outOfScope: boolean
  redFlags: RedFlag[]
  suggestions: ClinicalSuggestion[]
  suppressedSuggestionIds: SuppressedSuggestionId[]
}> {
  const client = getLLMClient()

  const candidatesCall = client.generate({
    operation: 'red_flags',
    system: buildRedFlagsSystemPrompt(profile),
    content,
    schema: RedFlagCandidatesSchema,
    schemaName: 'red_flags',
  })

  if (retrieved.length === 0) {
    const candidates = await candidatesCall
    return {
      outOfScope: candidates.outOfScope,
      redFlags: candidates.redFlags,
      suggestions: [],
      suppressedSuggestionIds: [],
    }
  }

  const [candidates, proposed] = await Promise.all([
    candidatesCall,
    client.generate({
      operation: 'suggestions',
      system: buildSuggestionsSystemPrompt(profile, retrieved),
      content,
      schema: makeSuggestionsSchema(corpusIdsFor(retrieved)),
      schemaName: 'suggestions',
    }),
  ])

  /*
   * Enforced here rather than asked for in the prompt. One call could suppress
   * its own suggestions when it judged the consultation out of scope, because
   * it made both decisions at once; two calls cannot, and the citing half is
   * not told the verdict because it runs concurrently with the call that
   * reaches it. Dropping them here is deterministic, which is stronger than
   * the instruction it replaces.
   *
   * Only suggestions are dropped. `mergeRedFlags` is untouched and red-flag
   * candidates pass through regardless of scope, exactly as the prompt says.
   */
  if (candidates.outOfScope) {
    return {
      outOfScope: true,
      redFlags: candidates.redFlags,
      suggestions: [],
      suppressedSuggestionIds: [],
    }
  }

  const filtered = filterUnsafeModelSuggestions(proposed.suggestions)
  return {
    outOfScope: candidates.outOfScope,
    redFlags: candidates.redFlags,
    ...filtered,
  }
}
