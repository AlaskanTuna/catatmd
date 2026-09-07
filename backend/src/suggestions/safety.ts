import type { ClinicalSuggestion } from '@shared/types'
import { containsDiagnosticProse } from '../analysis/diagnostic-guard.js'

const MEDICATION_ORDER =
  /\b(?:prescrib(?:e|es|ed|ing)|start(?:s|ed|ing)?|give(?:s|n|ing)?|administer(?:s|ed|ing)?|dispens(?:e|es|ed|ing)?|take(?:s|n|ing)?|use(?:s|d|ing)?)\b[\s\S]{0,80}\b(?:antibiotic(?:s)?|antimicrobial(?:s)?|medication(?:s)?|medicine(?:s)?|drug(?:s)?|tablet(?:s)?|capsule(?:s)?|inhaler(?:s)?|steroid(?:s)?|paracetamol|ibuprofen|[a-z]+(?:cillin|mycin|cycline|floxacin|azole|pril|sartan|olol|statin|prazole|caine|vir|mab|tadine|zine|butamol|terol))\b/i

const DOSE_REGIMEN =
  /\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|ug|ml|units?|iu)\b(?:\s*(?:\/|per)\s*(?:kg|day|dose)|[\s,]*(?:once|twice|thrice|daily|every\s+\d+\s*(?:hours?|h)|(?:one|two|three|four)\s+times?(?:\s+daily)?|(?:q|od|bd|bid|tds|tid|qid|qhs|qds|stat)\b)|[\s,]*for\s+\d+\s+days?)?/i

function containsUnsafeMedicationProse(text: string): boolean {
  return MEDICATION_ORDER.test(text) || DOSE_REGIMEN.test(text)
}

function isUnsafeSuggestion(suggestion: ClinicalSuggestion): boolean {
  if (containsDiagnosticProse(suggestion.text) || containsUnsafeMedicationProse(suggestion.text)) {
    return true
  }

  return suggestion.citations.some(
    (citation) =>
      citation.quote !== undefined &&
      (containsDiagnosticProse(citation.quote) || containsUnsafeMedicationProse(citation.quote)),
  )
}

export function filterUnsafeModelSuggestions(suggestions: readonly ClinicalSuggestion[]): {
  suggestions: ClinicalSuggestion[]
  suppressedSuggestionIds: string[]
} {
  const safeSuggestions: ClinicalSuggestion[] = []
  const suppressedSuggestionIds: string[] = []

  for (const suggestion of suggestions) {
    if (isUnsafeSuggestion(suggestion)) {
      suppressedSuggestionIds.push(suggestion.id)
    } else {
      safeSuggestions.push(suggestion)
    }
  }

  return { suggestions: safeSuggestions, suppressedSuggestionIds }
}
