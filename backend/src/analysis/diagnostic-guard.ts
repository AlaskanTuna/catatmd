import type { InformationGap, SoapNote } from '@shared/types'

/**
 * Tier-3 guard (docs/trd.md §21.3) for docs/prd.md §10: the SOAP assessment
 * and gap text must never state or imply a diagnosis. The structured
 * `operational.diagnosis` field is the only place a diagnosis may appear,
 * and it is bound by the evidence check (§21.4), not by this pattern match.
 */
const DIAGNOSTIC_PHRASING: readonly RegExp[] = [
  /\bdiagnos(is|ed|es|ing)\b/i,
  /\bimpression\s*:/i,
  /\bdifferential\b/i,
  /\bconsistent with a diagnosis\b/i,
]

function containsDiagnosticProse(text: string): boolean {
  return DIAGNOSTIC_PHRASING.some((pattern) => pattern.test(text))
}

export interface DiagnosticGuardResult {
  note: SoapNote
  gaps: InformationGap[]
  /** Field ids suppressed. Ids only — never the offending content. */
  suppressedFieldIds: string[]
}

/**
 * Suppresses the offending field rather than rejecting the response.
 *
 * This used to throw, which was the wrong runtime behaviour for a Tier-3
 * control and inconsistent with the evidence check beside it: §21.4 downgrades
 * the individual fact precisely so one bad field does not cost the doctor the
 * whole analysis. Throwing here did exactly that — a single stray "diagnosis"
 * in the assessment discarded a 26-second run, and the doctor's only recourse
 * was to trigger it again and hope.
 *
 * §21.4's asymmetry argument applies unchanged. A blanked assessment costs the
 * doctor one field they were going to edit anyway, and the structured
 * `diagnosis` field still carries the answer. A lost analysis costs the whole
 * consultation.
 *
 * The rate is worth watching rather than ignoring: `suppressedFieldIds` is
 * recorded on the audit event for the same reason `discardedFieldIds` is
 * (§21.7 — the downgrade rate is itself a quality signal).
 */
export function stripDiagnosticProse(
  note: SoapNote,
  gaps: readonly InformationGap[],
): DiagnosticGuardResult {
  const suppressedFieldIds: string[] = []

  let assessment = note.assessment
  if (containsDiagnosticProse(assessment)) {
    assessment = ''
    suppressedFieldIds.push('note.assessment')
  }

  const keptGaps = gaps.filter((gap) => {
    if (containsDiagnosticProse(gap.question) || containsDiagnosticProse(gap.rationale)) {
      suppressedFieldIds.push(`gap.${gap.id}`)
      return false
    }
    return true
  })

  return { note: { ...note, assessment }, gaps: keptGaps, suppressedFieldIds }
}
