import type { ClinicalSuggestion } from '@shared/types'
import { containsDiagnosticProse } from '../analysis/diagnostic-guard.js'
import type { ClinicalConsideration } from './index.js'

/**
 * Prescribing and treatment-order phrasing, for the model pathway only.
 *
 * `analysis/diagnostic-guard.ts` covers the diagnostic half of docs/prd.md §10
 * and is reused rather than restated; this list covers the half it does not,
 * because a suggestion that prescribes is outside the intended purpose even
 * when it names no condition.
 *
 * Deliberately over-inclusive, on the same asymmetry as the diagnostic guard
 * (docs/trd.md §21.4): a suppressed model suggestion costs the doctor one
 * prompt they could have ignored, while a medication order reaching the
 * review screen reads as an instruction the system is not permitted to give.
 */
const MODEL_ORDER_PHRASING: readonly RegExp[] = [
  /\bprescri\w*/i,
  /\bdispens\w*/i,
  /\badminister\w*/i,
  /\brx\b/i,
  /\b(?:medication|treatment|drug)\s+orders?\b/i,
  // A directive verb pointed at something therapeutic.
  /\b(?:start\w*|commenc\w*|initiat\w*|giv(?:e|es|en|ing)|order(?:s|ed|ing)?|recommend\w*|switch\w*|escalat\w*)\s+(?:\S+\s+){0,5}(?:antibiotics?|antibacterials?|amoxicillin|penicillin|azithromycin|paracetamol|ibuprofen|medicines?|medications?|treatment|therapy|tablets?|capsules?)\b/i,
  // An explicit dose or strength is a medication order whatever the wording,
  // and is the form a bare regimen ("amoxicillin 500 mg TDS") takes.
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b/i,
  /\b(?:treat|manage)\w*\s+(?:with|as)\b/i,
  /\b(?:antibiotics?|antibacterials?|medications?|treatment|therapy)\s+(?:is|are)\s+(?:not\s+)?(?:indicated|required|needed|recommended)\b/i,
  /\b(?:must|should)\s+(?:be\s+)?(?:prescri\w*|dispens\w*|administer\w*|order\w*|start\w*|commenc\w*|initiat\w*|giv\w*|treat\w*)\b/i,
]

/**
 * Every free-text field the model authors on a suggestion. `citations[].quote`
 * is checked alongside `text` because the ID-constrained citation gate
 * (`suggestions/index.ts`) binds `guidelineId` only — the quote beside it is
 * model prose on the same rail.
 */
function modelAuthoredText(suggestion: ClinicalSuggestion): string[] {
  return [
    suggestion.text,
    ...suggestion.citations.map((c) => c.quote).filter((q): q is string => q !== undefined),
  ]
}

function isModelSuggestionSafe(suggestion: ClinicalSuggestion): boolean {
  return modelAuthoredText(suggestion).every(
    (text) =>
      !containsDiagnosticProse(text) && !MODEL_ORDER_PHRASING.some((pattern) => pattern.test(text)),
  )
}

/**
 * Drops any consideration whose citations are not entirely inside the active
 * profile's approved corpus. Mirrors the ID-constrained citation gate on the
 * model pathway — a rule cannot cite a guideline the profile does not carry.
 */
export function filterConsiderationsForCorpus(
  considerations: readonly ClinicalConsideration[],
  allowedGuidelineIds: ReadonlySet<string>,
): ClinicalConsideration[] {
  return considerations.filter((c) =>
    c.citations.every((citation) => allowedGuidelineIds.has(citation.guidelineId)),
  )
}

/**
 * Maps deterministic considerations onto the shared `ClinicalSuggestion`
 * shape without inventing fields. `source` / `ruleId` stay on the
 * consideration side; the envelope the doctor reviews is citation-bearing
 * suggestion text only.
 */
export function toClinicalSuggestions(
  considerations: readonly ClinicalConsideration[],
): ClinicalSuggestion[] {
  return considerations.map((c) => ({
    id: c.id,
    text: c.text,
    citations: [...c.citations],
  }))
}

/**
 * Zero-suppression union for suggestions, matching `mergeRedFlags`:
 * deterministic rule hits come first and are never dropped, reordered, or
 * replaced by model candidates — even when IDs collide. The model pathway
 * is additive only.
 *
 * It is also the safety boundary for that pathway. A model suggestion carrying
 * diagnostic or prescribing prose is dropped here, whatever its citation:
 * `z.enum(corpusIds)` constrains which guideline a suggestion may name, not
 * what it may say about it, so a valid citation id is not a pass. Deterministic
 * considerations are not filtered — they are rule text, citation-grounded, and
 * their "Differential consideration:" label is the documented exception
 * (docs/trd.md §3).
 */
export function mergeSuggestions(
  ruleSuggestions: ClinicalSuggestion[],
  modelSuggestions: ClinicalSuggestion[],
): ClinicalSuggestion[] {
  return ruleSuggestions.concat(modelSuggestions.filter(isModelSuggestionSafe))
}
