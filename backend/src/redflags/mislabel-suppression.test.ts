import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * The executable statement of why suppression is gated on `labelsReviewed`.
 *
 * Issue #70's suppression is correct given correct labels: a doctor's screening
 * question answered by a leading denial asserts nothing. But the suppression
 * trusts the labels, and a mislabelling that dresses a patient's own report up
 * as that exact shape silently drops a genuine flag. The frontend's
 * label-guessing heuristic produces precisely this shape when a patient asks
 * about their own symptom: its rule 3 hands any question to the doctor, and its
 * rule 2 makes the next line the patient.
 *
 * That used to be mitigated in the UI, by a review step the doctor had to work
 * through before drafted labels entered the transcript. The step was removed for
 * the real-time workflow, so the mitigation moved here, where it is enforceable
 * rather than merely offered: **the engine only reads the question-denial shape
 * when a person stands behind the labels.** A guessed label may leave a flag
 * standing for the doctor to dismiss, and may never take one away.
 *
 * Nothing here should be "fixed" by weakening the reviewed-labels case. Both
 * halves are the point: the shape still works when it can be trusted, and is
 * refused when it cannot.
 */

const URTI = REDFLAG_TRIGGERS.filter((trigger) => trigger.profiles.includes('adult-acute-urti'))

const transcript = (
  turns: { speaker: 'doctor' | 'patient'; text: string }[],
  labelsReviewed?: boolean,
): Transcript => ({
  source: 'fixture',
  turns,
  ...(labelsReviewed === undefined ? {} : { labelsReviewed }),
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, URTI)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

describe('a mislabelled turn pair cannot suppress a genuine red flag', () => {
  const patientReport = 'Is it bad that I am coughing up blood?'
  const nextRemark = 'No need to panic first, let us have a look.'

  const asSpoken = [
    { speaker: 'patient', text: patientReport },
    { speaker: 'doctor', text: nextRemark },
  ] as const
  // The patient's report now reads as a doctor screening question, and the
  // doctor's reassurance as the patient's leading denial.
  const swapped = [
    { speaker: 'doctor', text: patientReport },
    { speaker: 'patient', text: nextRemark },
  ] as const

  it('fires with the labels the consultation actually had', () => {
    expect(ruleIds(transcript([...asSpoken], true))).toEqual(['haemoptysis'])
  })

  it('survives the swap when nobody confirmed the labels', () => {
    // The engine has no basis for the question-denial reading, so it does not
    // take one. This is the guarantee the review step used to buy.
    expect(ruleIds(transcript([...swapped], false))).toEqual(['haemoptysis'])
  })

  it('treats an absent flag as unreviewed, not as reviewed', () => {
    // Transcripts stored before the field existed, and any caller that forgets
    // it. The safe reading of "nobody recorded whether a human checked" is that
    // nobody did.
    expect(ruleIds(transcript([...swapped]))).toEqual(['haemoptysis'])
  })

  it('still reads the shape when a person stands behind the labels', () => {
    // The residual risk, now bounded to transcripts a human labelled: issue
    // #70's suppression is a real requirement, and a doctor who mislabels their
    // own consultation is a different failure from a model that guesses wrong.
    expect(ruleIds(transcript([...swapped], true))).toEqual([])
  })
})

/**
 * The other direction, and the one the first version of this change missed.
 *
 * `findDeniedAbility` only ever adds a flag, so it needed no guard against
 * suppression. But it is still label-dependent, and there the dependency costs a
 * flag rather than buying one: it composes a doctor's question with the
 * patient's next-turn denial, and "Boleh telan tak?" / "Tak boleh doktor." has
 * no span for the ordinary matcher to anchor on, so this is the only path that
 * raises it. Under guessed labels the pair simply goes unrecognised and an
 * emergency trigger silently does not fire.
 *
 * So on unreviewed labels the speaker checks are dropped and the pair is
 * composed on adjacency alone. Both halves of the engine now fail in the same
 * direction on labels nobody confirmed: more flags, never fewer.
 */
describe('an ability denial is still found when the labels are guessed', () => {
  const question = 'Boleh telan tak?'
  const denial = 'Tak boleh doktor.'

  it('fires on the labels a reviewed consultation would have', () => {
    expect(
      ruleIds(
        transcript(
          [
            { speaker: 'doctor', text: question },
            { speaker: 'patient', text: denial },
          ],
          true,
        ),
      ),
    ).toContain('swallowing-oral-intake')
  })

  it('fires when the same pair carries swapped labels and nobody confirmed them', () => {
    expect(
      ruleIds(
        transcript(
          [
            { speaker: 'patient', text: question },
            { speaker: 'doctor', text: denial },
          ],
          false,
        ),
      ),
    ).toContain('swallowing-oral-intake')
  })
})
