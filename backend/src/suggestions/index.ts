import {
  type ClinicalSuggestion,
  type GuidelineChunk,
  makeSuggestionsAndRedFlagsSchema,
  type RedFlag,
} from '@shared/types'
import { type ClinicalProfile, getClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { buildSuggestionsSystemPrompt } from './prompt.js'
import { filterUnsafeModelSuggestions, type SuppressedSuggestionId } from './safety.js'

export { buildSuggestionsSystemPrompt } from './prompt.js'
export { filterUnsafeModelSuggestions } from './safety.js'

/**
 * Operation 2 (docs/trd.md §12). Runs after de-identification and never
 * merges with the deterministic rules engine here — that union is the route
 * handler's job (`redflags/` exports `mergeRedFlags`), so this function
 * returns model candidates only.
 *
 * The citable corpus is the retrieved set and nothing else. When no chunks
 * were retrieved, no guideline-cited suggestion is possible; the call still
 * runs so the model can add red-flag candidates, but the result is forced to
 * zero suggestions and `outOfScope: true`.
 *
 * The schema narrows `guidelineId` to a `z.enum` built from the supplied
 * corpus: a citation naming an id outside the corpus fails decoding inside
 * `LLMClient.generate()` and never reaches this function's caller.
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
  const corpus = retrieved
  const response = await getLLMClient().generate({
    operation: 'suggestions_and_red_flags',
    system: buildSuggestionsSystemPrompt(profile, corpus),
    content,
    schema: makeSuggestionsAndRedFlagsSchema(corpus.map((chunk) => chunk.id)),
    schemaName: 'suggestions_and_red_flags',
  })

  if (corpus.length === 0) {
    return {
      outOfScope: true,
      redFlags: response.redFlags,
      suggestions: [],
      suppressedSuggestionIds: [],
    }
  }

  const filtered = filterUnsafeModelSuggestions(response.suggestions)
  return { ...response, ...filtered }
}
