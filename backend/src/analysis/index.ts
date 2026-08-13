import { ClinicalFactsResponseSchema, NoteAndGapsResponseSchema } from '@shared/types'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { stripDiagnosticProse } from './diagnostic-guard.js'
import { applyEvidenceCheck } from './evidence.js'
import { CLINICAL_FACTS_SYSTEM_PROMPT, NOTE_AND_GAPS_SYSTEM_PROMPT } from './prompt.js'
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
): Promise<NoteAndGapsResult> {
  const client = getLLMClient()

  const [facts, prose] = await Promise.all([
    client.generate({
      operation: 'clinical_facts',
      system: CLINICAL_FACTS_SYSTEM_PROMPT,
      content,
      schema: ClinicalFactsResponseSchema,
      schemaName: 'clinical_facts',
    }),
    client.generate({
      operation: 'note_and_gaps',
      system: NOTE_AND_GAPS_SYSTEM_PROMPT,
      content,
      schema: NoteAndGapsResponseSchema,
      schemaName: 'note_and_gaps',
    }),
  ])

  const { clinicalFacts, operational, discardedFieldIds } = applyEvidenceCheck(
    facts.clinicalFacts,
    facts.operational,
    transcriptText,
  )

  const guarded = stripDiagnosticProse(prose.note, prose.gaps)

  return {
    note: guarded.note,
    clinicalFacts,
    operational,
    gaps: guarded.gaps,
    discardedFieldIds,
    suppressedFieldIds: guarded.suppressedFieldIds,
  }
}
