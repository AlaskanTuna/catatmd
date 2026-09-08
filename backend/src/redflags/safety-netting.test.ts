import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * The production miss this pins: a doctor's closing safety-netting advice is
 * a statement, and `asserts()` reads every statement as asserting what it
 * mentions, so "Come back if you become breathless, fever goes past three
 * days, or you cannot swallow" raised `significant-dyspnoea` and
 * `swallowing-oral-intake` on a consultation whose patient had denied
 * breathlessness two turns earlier.
 *
 * The advice names the symptom conditionally rather than asserting it. The
 * suppression reads that shape out of the sentence the match sits in, and
 * everything outside it still fires: the bias toward over-triggering is
 * deliberate and stays.
 */

const URTI = REDFLAG_TRIGGERS.filter((trigger) => trigger.profiles.includes('adult-acute-urti'))

const transcript = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'fixture',
  // Labels written by hand here, so suppression is available to the engine.
  labelsReviewed: true,
  turns,
})

/** `ruleId` is absent on model candidates; this engine only produces rule ones. */
const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, URTI)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

/** The production sentence, verbatim. */
const ADVICE =
  'Come back if you become breathless, fever goes past three days, or you cannot swallow.'

/** The production shape: the patient denied breathlessness two turns earlier. */
const deniedThenAdvised = (): Transcript =>
  transcript([
    { speaker: 'doctor', text: 'How has your breathing been?' },
    { speaker: 'patient', text: 'Fine, no shortness of breath at all.' },
    { speaker: 'doctor', text: ADVICE },
  ])

describe('closing safety-netting advice names the symptom without asserting it', () => {
  it('raises neither trigger on the production sentence after a denial', () => {
    const ids = ruleIds(deniedThenAdvised())
    expect(ids).not.toContain('significant-dyspnoea')
    expect(ids).not.toContain('swallowing-oral-intake')
  })

  /**
   * The suppression never trusted the label, so it holds on the recorded
   * paths too, where `asserts()` falls back to firing on every turn.
   */
  it('still raises neither on the same sentence with unreviewed labels', () => {
    const ids = ruleIds({ ...deniedThenAdvised(), labelsReviewed: false })
    expect(ids).not.toContain('significant-dyspnoea')
    expect(ids).not.toContain('swallowing-oral-intake')
  })

  it('fires on a patient report, which is never conditional advice', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'patient', text: 'I am breathless when I climb the stairs.' }]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('fires when the assertion precedes the advice marker in the same sentence', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'You are breathless now, come back if it gets worse.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('fires when the assertion sits in a different sentence of the same turn', () => {
    expect(
      ruleIds(
        transcript([
          {
            speaker: 'doctor',
            text: 'You look breathless. Come back if the fever goes past three days.',
          },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('stays silent on Malay conditional advice, marker first', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'doctor', text: 'Kalau awak sesak nafas, datang balik ya.' }]),
      ),
    ).not.toContain('significant-dyspnoea')
  })

  it('stays silent on Malay return advice, marker after the verb', () => {
    expect(
      ruleIds(transcript([{ speaker: 'doctor', text: 'Datang balik kalau sesak nafas.' }])),
    ).not.toContain('significant-dyspnoea')
  })

  it('stays silent on a negator-carrying span inside return advice', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'doctor', text: 'Go to the hospital if you cannot breathe.' }]),
      ),
    ).not.toContain('significant-dyspnoea')
  })
})

/**
 * The boundaries a first draft got wrong, each one a false negative the
 * review reproduced. These are the must-not-suppress cases.
 */
describe('the suppression never reaches a genuine report', () => {
  it('cannot govern a whole unpunctuated recorded turn from one marker', () => {
    const ids = ruleIds({
      source: 'asr_live',
      labelsReviewed: false,
      turns: [
        {
          speaker: 'doctor',
          text: 'if you get worse come back to see me also you look breathless right now and you cannot swallow',
        },
      ],
    })
    expect(ids).toContain('significant-dyspnoea')
    expect(ids).toContain('swallowing-oral-intake')
  })

  it('keeps a first-person report in a mislabelled patient turn', () => {
    const ids = ruleIds({
      ...transcript([
        {
          speaker: 'doctor',
          text: 'The last doctor said come back if I cannot swallow, and now I cannot swallow.',
        },
      ]),
      labelsReviewed: false,
    })
    expect(ids).toContain('swallowing-oral-intake')
  })

  it('keeps a second, genuine mention later in the same turn', () => {
    const ids = ruleIds(
      transcript([
        {
          speaker: 'doctor',
          text: 'If you cannot swallow, go to hospital. You told me you cannot swallow anything since yesterday.',
        },
      ]),
    )
    expect(ids).toContain('swallowing-oral-intake')
  })

  it('keeps a present-tense observation appended to the advice sentence', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Come back if the fever climbs, and you are breathless now.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('keeps a plain observation coordinated onto the advice with "and"', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Come back if the fever persists, and you look breathless.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('treats a semicolon as the end of the advice sentence', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Come back if you get worse; you cannot swallow.' },
        ]),
      ),
    ).toContain('swallowing-oral-intake')
  })

  it('does not read a habitual "whenever" as return advice', () => {
    expect(
      ruleIds(
        transcript([{ speaker: 'doctor', text: 'Whenever you climb stairs you get breathless.' }]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('keeps a Malay observation coordinated onto the advice', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Kalau awak teruk datang balik, dan awak sesak nafas.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })
})

/**
 * The residue the docstring on `isSafetyNetting` accepts, pinned so a change
 * that widens or narrows it shows up here rather than in a clinic: an
 * unpunctuated recording whose terminal observation shares one clause with
 * the advice cannot be told apart from the advice by shape.
 */
describe('accepted residue, stated rather than hidden', () => {
  it('cannot separate a report from the advice inside one unpunctuated clause', () => {
    const ids = ruleIds({
      source: 'asr_live',
      labelsReviewed: false,
      turns: [{ speaker: 'doctor', text: 'come back if you get worse you cannot swallow' }],
    })
    expect(ids).not.toContain('swallowing-oral-intake')
  })
})
