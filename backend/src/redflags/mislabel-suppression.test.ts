import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * The executable statement of why drafted speaker labels are gated behind an
 * explicit doctor review (#118).
 *
 * Issue #70's suppression is correct given correct labels: a doctor's
 * screening question answered by a leading denial asserts nothing. But the
 * suppression trusts the labels. A mislabelling that dresses a patient's own
 * report up as that exact shape silently drops a genuine flag, and the
 * frontend's label-guessing heuristic produces precisely this shape when a
 * patient asks about their own symptom (its rule 3 hands any question to the
 * doctor, its rule 2 makes the next line the patient).
 *
 * This is not a bug in the engine, and nothing here should be "fixed" by
 * weakening the suppression. It pins the residual risk the review gate
 * mitigates: unreviewed guessed labels must never reach this engine.
 */

const URTI = REDFLAG_TRIGGERS.filter((trigger) => trigger.profiles.includes('adult-acute-urti'))

const transcript = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'fixture',
  turns,
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, URTI)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

describe('a mislabelled turn pair can suppress a genuine red flag', () => {
  const patientReport = 'Is it bad that I am coughing up blood?'
  const nextRemark = 'No need to panic first, let us have a look.'

  it('fires with the labels the consultation actually had', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'patient', text: patientReport },
          { speaker: 'doctor', text: nextRemark },
        ]),
      ),
    ).toEqual(['haemoptysis'])
  })

  it('goes silent when the same words carry swapped labels', () => {
    // The patient's report now reads as a doctor screening question, and the
    // doctor's reassurance as the patient's leading denial. The engine is
    // behaving exactly as issue #70 specified; the labels are the defect.
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: patientReport },
          { speaker: 'patient', text: nextRemark },
        ]),
      ),
    ).toEqual([])
  })
})
