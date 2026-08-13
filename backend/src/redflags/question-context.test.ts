import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURE_RUBRICS, FIXTURES } from '../fixtures/index.js'
import { evaluateRedFlags } from './evaluate.js'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * GitHub issue #70. The engine matched every turn as if it asserted what it
 * mentioned, so a doctor running through a review of systems raised a flag for
 * each symptom she asked about. Three fired on the negative-control fixture,
 * one of them EMERGENCY, while the patient had denied all three in the next
 * turn.
 *
 * The bias toward over-triggering is deliberate and stays. What follows pins
 * the boundary between over-triggering and asserting something nobody said.
 */

const URTI = REDFLAG_TRIGGERS.filter((trigger) => trigger.profiles.includes('adult-acute-urti'))

const transcript = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'fixture',
  turns,
})

/** `ruleId` is absent on model candidates; this engine only produces rule ones. */
const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, URTI)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

describe('every fixture is graded against its rubric (issue #70)', () => {
  /**
   * The rubrics used to be prose. `urti-identifier-dense-routine` had stated
   * that any flag on it is a false positive for as long as it has existed, and
   * three were being raised while the whole suite passed, because nothing ever
   * ran a fixture through the engine. This is what makes `failsQaIf`
   * executable.
   */
  it.each(FIXTURE_RUBRICS.map((r) => [r.fixtureId, r] as const))(
    '%s raises exactly the rules its rubric names',
    (fixtureId, rubric) => {
      const fixture = FIXTURES.find((f) => f.id === fixtureId)
      if (fixture === undefined) throw new Error(`fixture ${fixtureId} missing`)

      expect(ruleIds(fixture.transcript)).toEqual([...rubric.expectedRedFlagIds].sort())
    },
  )
})

describe('a question is not an assertion, but silence about the answer is not a denial', () => {
  it('does not fire when the doctor screens and the patient denies', () => {
    expect(
      ruleIds(
        transcript([
          {
            speaker: 'doctor',
            text: 'Any chest pain, difficulty breathing, or coughing up blood?',
          },
          {
            speaker: 'patient',
            text: 'No, none of that. Breathing is fine, no pain in the chest.',
          },
        ]),
      ),
    ).toEqual([])
  })

  /**
   * The reason the obvious fix was rejected. Discarding every question would
   * lose this flag outright: the patient never says the words, so the doctor's
   * question is the only place the symptom is named.
   */
  it('fires when the doctor screens and the patient affirms without naming the symptom', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'patient', text: 'Yes, since this morning.' },
        ]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires when the doctor screens and the patient neither confirms nor denies', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'patient', text: 'Hard to say doctor, maybe when I climb stairs.' },
        ]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires on a doctor-observed finding, which is a statement rather than a question', () => {
    expect(ruleIds(transcript([{ speaker: 'doctor', text: 'I can hear stridor.' }]))).toEqual([
      'stridor-airway-compromise',
    ])
  })

  it('fires when the patient asks about their own symptom', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'Is it bad that I am coughing up blood?' }])),
    ).toEqual(['haemoptysis'])
  })
})

/**
 * Suppression binds a question to the turn immediately after it. Real
 * consultations interleave, so every other shape must fail open: a spurious
 * flag costs a doctor one dismissal, a suppressed one costs the thing this
 * engine exists to prevent.
 */
describe('interleaved turns fail open', () => {
  it('fires when the patient asks a clarifying question before answering', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'patient', text: 'Which one doctor, the front or the side?' },
          { speaker: 'patient', text: 'No, none of that.' },
        ]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires for the earlier question when two are answered at once', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'doctor', text: 'And any coughing up blood?' },
          { speaker: 'patient', text: 'No, none of that.' },
        ]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires when the doctor speaks again before the patient replies', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'doctor', text: 'Take your time.' },
          { speaker: 'patient', text: 'No, none of that.' },
        ]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires when the question is the last turn and nothing answers it', () => {
    expect(ruleIds(transcript([{ speaker: 'doctor', text: 'Any chest pain?' }]))).toEqual([
      'chest-pain',
    ])
  })
})

describe('a denial that repeats the phrase it denies', () => {
  it('does not fire on "no pain in the chest"', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'patient', text: 'Breathing is fine, no pain in the chest.' }]),
      ),
    ).toEqual([])
  })

  it('still fires after "but", which ends the negation\'s reach', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'No fever but chest pain since morning.' }])),
    ).toEqual(['chest-pain'])
  })

  it('fires on a plain report', () => {
    expect(ruleIds(transcript([{ speaker: 'patient', text: 'I have chest pain.' }]))).toEqual([
      'chest-pain',
    ])
  })
})

describe('vocabulary that was missing a genuine escalation', () => {
  /**
   * "cannot swallow" matched neither `can't swallow` nor `unable to swallow`,
   * so the most alarming line in the hard red-flag fixture raised nothing. The
   * flag it does raise came from "drooling" in the same sentence, which is
   * luck rather than coverage.
   */
  it('fires on "cannot swallow", not only the contracted form', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'I cannot swallow anything now.' }])),
    ).toEqual(['swallowing-oral-intake'])
  })
})
