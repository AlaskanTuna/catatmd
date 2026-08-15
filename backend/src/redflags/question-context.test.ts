import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURE_RUBRICS, FIXTURES } from '../fixtures/index.js'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS, REDFLAG_TRIGGERS } from './triggers.js'

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

  /**
   * Issue #150. "just" introduces an affirmed symptom exactly the way "cuma"
   * does in Malay, and treating it as still inside the denial suppressed an
   * urgent trigger on ordinary phrasing.
   */
  it('fires after "just", which introduces an affirmed symptom (issue #150)', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'No fever, just chest pain.' }])),
    ).toEqual(['chest-pain'])
  })

  it('fires after "only", the same construction', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'patient', text: 'No fever, only chest pain when I cough.' }]),
      ),
    ).toEqual(['chest-pain'])
  })

  it('fires on the minimiser reading too, because a minimised symptom is present', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'No fever, just a bit of chest pain.' }])),
    ).toEqual(['chest-pain'])
  })

  it('still suppresses when the denial itself comes after "just"', () => {
    expect(
      ruleIds(transcript([{ speaker: 'patient', text: 'Honestly just no chest pain at all.' }])),
    ).toEqual([])
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

/**
 * Issue #163. A positively framed ability question answered with a bare
 * negation asserts the inability the trigger exists to catch, but no matcher
 * span exists in either turn, so v4 raised nothing on the commonest
 * question-answer shape in either language. The composition is deliberately
 * narrow: adjacent doctor-question and patient-reply, an unhedged leading
 * denial, and no re-affirmation after it.
 */
describe('a positively framed ability question answered with a bare negation (issue #163)', () => {
  const allRuleIds = (t: Transcript): string[] =>
    evaluateRedFlags(t, ALL_REDFLAG_TRIGGERS)
      .map((f) => f.ruleId)
      .filter((id): id is string => id !== undefined)
      .sort()

  it.each([
    ['swallowing-oral-intake', 'Boleh telan tak?', 'Tak.'],
    ['significant-dyspnoea', 'Boleh bernafas macam biasa tak?', 'Tak boleh doktor.'],
    ['uti-unable-to-pass-urine', 'Kencing boleh keluar tak?', 'Tak keluar langsung.'],
    ['swallowing-oral-intake', 'Can you swallow?', 'No.'],
    ['swallowing-oral-intake', 'Are you able to eat or drink?', 'Cannot, doctor.'],
    ['swallowing-oral-intake', 'Can you swallow?', "No, I can't."],
    ['swallowing-oral-intake', 'Can you eat or drink?', 'Nothing since yesterday.'],
    ['swallowing-oral-intake', 'Boleh telan tak?', 'Tak, tak boleh langsung.'],
    [
      'significant-dyspnoea',
      'Boleh bernafas macam biasa tak?',
      'Tak boleh doktor, sikit-sikit pun tak boleh.',
    ],
    ['uti-unable-to-pass-urine', 'Boleh kencing tak?', 'Belum lagi doktor.'],
  ] as const)('raises %s for "%s" answered "%s"', (id, question, reply) => {
    expect(
      allRuleIds(
        transcript([
          { speaker: 'doctor', text: question },
          { speaker: 'patient', text: reply },
        ]),
      ),
    ).toContain(id)
  })

  it.each([
    ['an affirmed ability', 'Boleh telan tak?', 'Boleh.'],
    ['a hedged yes', 'Boleh telan tak?', 'Boleh, sikit-sikit je.'],
    ['uncertainty, because unknown is never negative', 'Boleh telan tak?', 'Tak pasti doktor.'],
    ['English uncertainty', 'Can you swallow?', 'Not sure.'],
    [
      'a denial followed by re-affirmed intake, the pinned canary',
      'Boleh makan tak?',
      'Takde, boleh makan minum macam biasa.',
    ],
  ] as const)('stays silent on %s', (_case, question, reply) => {
    expect(
      allRuleIds(
        transcript([
          { speaker: 'doctor', text: question },
          { speaker: 'patient', text: reply },
        ]),
      ),
    ).toEqual([])
  })

  it('stays silent on an unanswered ability question, which asserts nothing abnormal', () => {
    expect(allRuleIds(transcript([{ speaker: 'doctor', text: 'Boleh telan tak?' }]))).toEqual([])
  })

  it('does not compose across an interleaved turn, so a denial never pairs with the wrong question', () => {
    expect(
      allRuleIds(
        transcript([
          { speaker: 'doctor', text: 'Boleh telan tak?' },
          { speaker: 'doctor', text: 'Take your time.' },
          { speaker: 'patient', text: 'Tak.' },
        ]),
      ),
    ).toEqual([])
  })

  it('leaves the negatively framed forms on their existing over-firing route', () => {
    expect(
      allRuleIds(
        transcript([
          { speaker: 'doctor', text: 'Tak boleh telan ke?' },
          { speaker: 'patient', text: 'Boleh je, takde masalah.' },
        ]),
      ),
    ).toContain('swallowing-oral-intake')
  })
})
