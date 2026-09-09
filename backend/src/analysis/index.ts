import { ClinicalFactsResponseSchema, NoteAndGapsResponseSchema, toSoapNote } from '@shared/types'
import { type ClinicalProfile, getClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { timeStage } from '../lib/logger.js'
import { stripDiagnosticProse } from './diagnostic-guard.js'
import { applyEvidenceCheck } from './evidence.js'
import { buildClinicalFactsSystemPrompt, buildNoteAndGapsSystemPrompt } from './prompt.js'
import type { NoteAndGapsResult } from './types.js'

export { buildEvidenceLinks, type EvidenceLink } from './note.js'
export type { NoteAndGapsResult } from './types.js'

/**
 * Operation 1 (docs/trd.md §12): the structured half of an analysis. It runs
 * as two concurrent calls, `clinical_facts` and `note_and_gaps`, both reading
 * the same de-identified transcript. There is still no extract-then-generate
 * pipeline; the note is written from the transcript, not from the assertions,
 * which is exactly why the two can run at once (§19 row 19).
 *
 * Concurrency here is not an optimisation bolted on afterwards. Splitting the
 * operation is only affordable because the halves are independent: run in
 * sequence they would cost the sum of both latencies and lose the budget the
 * split was meant to protect.
 *
 * `Promise.all` rejects on the first failure, which is the behaviour §12's
 * retry policy wants. Neither half is useful without the other (a note with no
 * assertions cannot be reviewed against the checklist), so a partial result
 * would be a worse thing to hand a doctor than an honest error.
 *
 * `content` and `transcriptText` carry the same de-identified transcript:
 * `content` as the branded type the LLM port requires, `transcriptText` as a
 * plain string for the evidence check (§21.4) to match spans against.
 */
export async function analyseNote(
  content: Deidentified,
  transcriptText: string,
  profile: ClinicalProfile = getClinicalProfile(),
): Promise<NoteAndGapsResult> {
  const client = getLLMClient()

  /*
   * Timed here rather than around the pair, because timing them together is
   * what made a timeout undiagnosable (#340): the caller wrapped this whole
   * function in one `note_generation` stage, so a failure named the pair and
   * never said which of the two calls had actually run long. `extraction` was
   * already declared in `PIPELINE_STAGES` and unused; this is the call it was
   * declared for.
   */
  const [facts, prose] = await Promise.all([
    timeStage('extraction', () =>
      client.generate({
        operation: 'clinical_facts',
        system: buildClinicalFactsSystemPrompt(profile),
        content,
        schema: ClinicalFactsResponseSchema,
        schemaName: 'clinical_facts',
      }),
    ),
    timeStage('note_generation', () =>
      client.generate({
        operation: 'note_and_gaps',
        system: buildNoteAndGapsSystemPrompt(profile),
        content,
        schema: NoteAndGapsResponseSchema,
        schemaName: 'note_and_gaps',
      }),
    ),
  ])

  const { clinicalFacts, operational, discardedFieldIds } = applyEvidenceCheck(
    facts.clinicalFacts,
    facts.operational,
    transcriptText,
  )

  const guarded = stripDiagnosticProse(toSoapNote(prose.note), prose.gaps)
  const medicalRecordNote = { ...prose.note, assessment: guarded.note.assessment }

  return {
    note: guarded.note,
    medicalRecordNote,
    clinicalFacts,
    operational,
    gaps: guarded.gaps,
    discardedFieldIds,
    suppressedFieldIds: guarded.suppressedFieldIds,
  }
}
