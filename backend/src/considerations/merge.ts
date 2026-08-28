import type { ClinicalSuggestion } from '@shared/types'
import type { ClinicalConsideration } from './index.js'

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
 */
export function mergeSuggestions(
  ruleSuggestions: ClinicalSuggestion[],
  modelSuggestions: ClinicalSuggestion[],
): ClinicalSuggestion[] {
  return ruleSuggestions.concat(modelSuggestions)
}
