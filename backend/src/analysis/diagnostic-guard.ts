import type { InformationGap, SoapNote } from '@shared/types'
import { LLMResponseError } from '../lib/llm/index.js'

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

/** Throws `LLMResponseError` naming the offending field id, never its content. */
export function assertNoDiagnosticProse(note: SoapNote, gaps: readonly InformationGap[]): void {
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['note.assessment', note.assessment],
    ...gaps.flatMap(
      (gap) =>
        [
          [`gap.${gap.id}.question`, gap.question],
          [`gap.${gap.id}.rationale`, gap.rationale],
        ] as const,
    ),
  ]

  for (const [fieldId, text] of fields) {
    if (containsDiagnosticProse(text)) {
      throw new LLMResponseError(
        `note_and_gaps response contains diagnostic language in ${fieldId}`,
        'note_and_gaps',
      )
    }
  }
}
