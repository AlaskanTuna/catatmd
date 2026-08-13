import type { ClinicalFacts, InformationGap, OperationalBlock, SoapNote } from '@shared/types'

/**
 * Result of the `note_and_gaps` operation (docs/trd.md §12), after the
 * evidence-bound assertion check (§21.4) has run. `discardedFieldIds` names
 * every field the check forced to `NOT_ASSESSED` — field ids only, never the
 * discarded content (AGENTS.md — no assertion values in logs or errors).
 */
export interface NoteAndGapsResult {
  note: SoapNote
  clinicalFacts: ClinicalFacts
  operational: OperationalBlock
  gaps: InformationGap[]
  discardedFieldIds: string[]
}
