import { NoteAndGapsResponseSchema } from '@shared/types'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { assertNoDiagnosticProse } from './diagnostic-guard.js'
import { applyEvidenceCheck } from './evidence.js'
import { NOTE_AND_GAPS_SYSTEM_PROMPT } from './prompt.js'
import type { NoteAndGapsResult } from './types.js'

export { buildEvidenceLinks, type EvidenceLink } from './note.js'
export type { NoteAndGapsResult } from './types.js'

/**
 * Operation 1 (docs/trd.md §12) — the single call that produces the SOAP
 * scaffold, the per-field clinical assertions, the operational block, and
 * information gaps. There is no separate extract-then-generate pipeline.
 *
 * `content` and `transcriptText` carry the same de-identified transcript:
 * `content` as the branded type the LLM port requires, `transcriptText` as a
 * plain string for the evidence check (§21.4) to match spans against.
 */
export async function analyseNote(
  content: Deidentified,
  transcriptText: string,
): Promise<NoteAndGapsResult> {
  const response = await getLLMClient().generate({
    operation: 'note_and_gaps',
    system: NOTE_AND_GAPS_SYSTEM_PROMPT,
    content,
    schema: NoteAndGapsResponseSchema,
    schemaName: 'note_and_gaps',
  })

  const { clinicalFacts, operational, discardedFieldIds } = applyEvidenceCheck(
    response.clinicalFacts,
    response.operational,
    transcriptText,
  )

  assertNoDiagnosticProse(response.note, response.gaps)

  return {
    note: response.note,
    clinicalFacts,
    operational,
    gaps: response.gaps,
    discardedFieldIds,
  }
}
