import { LIVE_DELTA_LOOKBACK_SEGMENTS, type Transcript, type TranscriptTurn } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * Ambient capture evaluates red flags over one window at a time (#219), where
 * the Finish pass evaluates the whole transcript. These tests pin the property
 * that makes that substitution safe: **the union of the windows raises the same
 * flag ids as the whole.**
 *
 * The engine is intra-turn almost everywhere, so window evaluation would be
 * trivially equivalent but for one matcher. `findDeniedAbility` composes a
 * question turn with `turns[index + 1]`, and it does so whether or not labels
 * are reviewed, so a boundary falling between the two halves of that pair
 * silently loses an emergency trigger. `LIVE_DELTA_LOOKBACK_SEGMENTS` exists
 * for exactly that, and the second test below is written to fail without it.
 */

const turn = (speaker: TranscriptTurn['speaker'], text: string): TranscriptTurn => ({
  speaker,
  text,
})

/**
 * `labelsReviewed: false` matches what `POST /:id/live-flags` forces: nobody
 * has reviewed a speaker label mid-consultation, and the route refuses to let a
 * client claim otherwise.
 */
const live = (turns: TranscriptTurn[]): Transcript => ({
  source: 'asr_live',
  labelsReviewed: false,
  turns,
})

const flagIds = (transcript: Transcript): string[] =>
  evaluateRedFlags(transcript, REDFLAG_TRIGGERS)
    .map((flag) => flag.id)
    .sort()

/**
 * Cuts turns into windows of `size`, carrying the previous window's tail
 * forward. On the live path a window is a run of closed segments and one closed
 * segment becomes one draft turn, so a one-segment lookback is one turn here.
 */
const windows = (turns: TranscriptTurn[], size: number, lookback: number): Transcript[] => {
  const out: Transcript[] = []
  for (let start = 0; start < turns.length; start += size) {
    const from = Math.max(0, start - lookback)
    out.push(live(turns.slice(from, start + size)))
  }
  return out
}

const unionOfWindows = (turns: TranscriptTurn[], size: number, lookback: number): string[] => {
  const ids = new Set<string>()
  for (const window of windows(turns, size, lookback)) {
    // Ids dedupe the overlap. `mergeRedFlags` stays a pure concat and is not
    // the place for this: a set keyed on `trigger.id` is the caller's job.
    for (const id of flagIds(window)) ids.add(id)
  }
  return [...ids].sort()
}

/** The pair straddles the boundary: the question ends window 1, the denial opens window 2. */
const STRADDLING_PAIR: TranscriptTurn[] = [
  turn('doctor', 'How long have you had the cough?'),
  turn('patient', 'About three days now.'),
  turn('doctor', 'Can you breathe okay?'),
  turn('patient', "No, I can't."),
  turn('doctor', 'Any fever with it?'),
  turn('patient', 'A little, on and off.'),
]

describe('red flags over a live window', () => {
  it('raises the denied-ability trigger when it reads the whole transcript', () => {
    // The premise of the other tests. If this stops firing they prove nothing.
    expect(flagIds(live(STRADDLING_PAIR))).toContain('significant-dyspnoea')
  })

  it('loses the trigger when windows are cut with no lookback', () => {
    // Written to fail if someone "simplifies" the lookback away. The pair is
    // split across the boundary and no window contains both halves, so the
    // only path that raises this trigger never runs.
    expect(unionOfWindows(STRADDLING_PAIR, 3, 0)).not.toContain('significant-dyspnoea')
  })

  it('recovers the trigger with the one-segment lookback', () => {
    expect(unionOfWindows(STRADDLING_PAIR, 3, LIVE_DELTA_LOOKBACK_SEGMENTS)).toContain(
      'significant-dyspnoea',
    )
  })

  it('matches whole-transcript evaluation exactly, at every window size', () => {
    const whole = flagIds(live(STRADDLING_PAIR))
    for (let size = 1; size <= STRADDLING_PAIR.length; size += 1) {
      expect(unionOfWindows(STRADDLING_PAIR, size, LIVE_DELTA_LOOKBACK_SEGMENTS)).toEqual(whole)
    }
  })

  it('adds no flag the whole transcript does not also raise', () => {
    // The live pass is additive against Finish, never against the patient: it
    // may surface a flag earlier, and must not invent one the authoritative
    // run would not reach.
    const benign: TranscriptTurn[] = [
      turn('doctor', 'What brings you in today?'),
      turn('patient', 'A sore throat since Monday.'),
      turn('doctor', 'Any difficulty swallowing?'),
      turn('patient', 'No, swallowing is fine.'),
    ]
    expect(unionOfWindows(benign, 2, LIVE_DELTA_LOOKBACK_SEGMENTS)).toEqual(flagIds(live(benign)))
  })
})
