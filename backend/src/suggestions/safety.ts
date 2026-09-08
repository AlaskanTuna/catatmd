import type { ClinicalSuggestion } from '@shared/types'
import { containsDiagnosticProse } from '../analysis/diagnostic-guard.js'

const MEDICATION_TERM =
  '(?:antibiotics?|antimicrobials?|medications?|medicines?|drugs?|tablets?|capsules?|inhalers?|steroids?|nitrofurantoin|aspirin|insulin|paracetamol|ibuprofen|salbutamol|amoxicillin|[a-z]+(?:cillin|mycin|cycline|floxacin|azole|pril|sartan|olol|statin|prazole|caine|vir|mab|tadine|zine|butamol|terol))'

const CLAUSE_BOUNDARY = /\s*(?:;|,\s*but\b|\bbut\b|\bhowever\b|\band then\b)\s*/i
const CONTEXT_LABEL = /^(?:plan|recommendation|treatment)\s*:\s*/i
const INFORMATION_GATHERING = /^(?:ask|document|confirm|review|check)\s+(?:whether|if)\b/i
const SAFE_MEDICATION_CONTEXT =
  /^(?:(?:do not|don't|avoid|consider)\s+(?:recommend(?:ing)?\s+)?(?:prescribe|prescribing|start|starting|give|giving|administer|administering|dispense|dispensing)|(?:the clinician|the doctor|you)\s+(?:should|must|needs? to)\s+not\s+(?:prescribe|start|give|administer|dispense))\b/i
const DIRECT_PRESCRIBING_ORDER = /^(?:please\s+)?prescribe\b/i
const MEDICATION_ACTION_ORDER = new RegExp(
  `\\b(?:start|give|administer|dispense|take|use)\\b[\\s\\S]{0,40}\\b${MEDICATION_TERM}\\b`,
  'i',
)
const MODAL_MEDICATION_ORDER =
  /\b(?:should|must|needs? to)\s+(?!not\b)(?:prescrib(?:e|ing)|start|give|administer|dispense)\b/i
const RECOMMENDED_MEDICATION_ORDER =
  /\brecommend(?:s|ed|ing)?\s+(?:prescribing|starting|giving|administering|dispensing)\b/i
const BARE_DOSE_REGIMEN = new RegExp(
  `^\\s*(?:${MEDICATION_TERM}(?:\\s*:\\s*|\\s+))?\\d+(?:\\.\\d+)?\\s*(?:mg|g|mcg|μg|ug|ml|units?|iu)\\b(?:\\s*(?:/|per)\\s*(?:kg|day|dose)|[\\s,]*(?:once|twice|thrice|daily|every\\s+\\d+\\s*(?:hours?|h)|(?:one|two|three|four)\\s+times?(?:\\s+daily)?|(?:q|od|bd|bid|tds|tid|qid|qhs|qds|stat)\\b)|[\\s,]*for\\s+\\d+\\s+days?)?`,
  'i',
)

function containsUnsafeMedicationProse(text: string): boolean {
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text]

  return sentences.some((sentence) => {
    if (sentence.trim().endsWith('?')) return false

    return sentence.split(CLAUSE_BOUNDARY).some((clause) => {
      const candidate = clause.trim().replace(CONTEXT_LABEL, '')
      if (INFORMATION_GATHERING.test(candidate) || SAFE_MEDICATION_CONTEXT.test(candidate)) {
        return false
      }

      return (
        DIRECT_PRESCRIBING_ORDER.test(candidate) ||
        MEDICATION_ACTION_ORDER.test(candidate) ||
        MODAL_MEDICATION_ORDER.test(candidate) ||
        RECOMMENDED_MEDICATION_ORDER.test(candidate) ||
        BARE_DOSE_REGIMEN.test(candidate)
      )
    })
  })
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

export type SuppressedSuggestionId = `model-suggestion-${number}`

export function filterUnsafeModelSuggestions(suggestions: readonly ClinicalSuggestion[]): {
  suggestions: ClinicalSuggestion[]
  suppressedSuggestionIds: SuppressedSuggestionId[]
} {
  const safeSuggestions: ClinicalSuggestion[] = []
  const suppressedSuggestionIds: SuppressedSuggestionId[] = []

  for (const [index, suggestion] of suggestions.entries()) {
    if (isUnsafeSuggestion(suggestion)) {
      suppressedSuggestionIds.push(`model-suggestion-${index + 1}`)
    } else {
      safeSuggestions.push(suggestion)
    }
  }

  return { suggestions: safeSuggestions, suppressedSuggestionIds }
}
