import {
  type ClinicalSuggestion,
  makeSuggestionsAndRedFlagsSchema,
  type RedFlag,
} from '@shared/types'
import { type ClinicalProfile, getClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { corpusIdsFor } from '../guidelines/index.js'
import { getLLMClient } from '../lib/llm/index.js'
import { buildSuggestionsSystemPrompt } from './prompt.js'

export { buildSuggestionsSystemPrompt } from './prompt.js'

/**
 * Operation 2 (docs/trd.md §12). Runs after de-identification and never
 * merges with the deterministic rules engine here — that union is the route
 * handler's job (`redflags/` exports `mergeRedFlags`), so this function
 * returns model candidates only.
 *
 * `corpusIds` narrows `guidelineId` to a `z.enum` at request time: a
 * citation naming an id outside the corpus fails decoding inside
 * `LLMClient.generate()` and never reaches this function's caller.
 */
export async function generateSuggestions(
  content: Deidentified,
  profile: ClinicalProfile = getClinicalProfile(),
): Promise<{
  outOfScope: boolean
  redFlags: RedFlag[]
  suggestions: ClinicalSuggestion[]
}> {
  return getLLMClient().generate({
    operation: 'suggestions_and_red_flags',
    system: buildSuggestionsSystemPrompt(profile),
    content,
    schema: makeSuggestionsAndRedFlagsSchema(corpusIdsFor(profile.guidelineCorpus)),
    schemaName: 'suggestions_and_red_flags',
  })
}
