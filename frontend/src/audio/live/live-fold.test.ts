import { MAX_LIVE_DELTA_SEGMENTS, type RedFlag } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../protocol.js'
import { appendOnly, closedSegments, deltaFor, mergeFlags, segmentsToDelta } from './live-fold.js'

const segment = (text: string, start: number): TranscriptSegment => ({
  text,
  start,
  end: start + 2,
})

const flag = (id: string): RedFlag => ({
  id,
  label: id,
  severity: 'urgent',
  evidence: 'evidence',
  source: 'rule',
  ruleId: id,
  guidelineIds: [],
})

describe('closedSegments', () => {
  it('never returns the trailing segment, which can still grow', () => {
    const segments = [segment('one', 0), segment('two', 3), segment('three', 6)]
    expect(closedSegments(segments).map((s) => s.text)).toEqual(['one', 'two'])
  })

  it('returns nothing while only one segment exists', () => {
    expect(closedSegments([segment('one', 0)])).toEqual([])
  })

  it('returns nothing for an empty stream', () => {
    expect(closedSegments([])).toEqual([])
  })
})

describe('deltaFor', () => {
  const closed = [segment('a', 0), segment('b', 3), segment('c', 6), segment('d', 9)]

  it('carries exactly one already-sent segment as the lookback', () => {
    // Committed two, so 'c' and 'd' are new and 'b' is the lookback. Without
    // 'b' an adjacency pair spanning b/c would be lost; see
    // backend/src/redflags/live-window.test.ts.
    expect(deltaFor(closed, 2).map((s) => s.text)).toEqual(['b', 'c', 'd'])
  })

  it('sends everything on the first cycle, with nothing to look back at', () => {
    expect(deltaFor(closed, 0).map((s) => s.text)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sends nothing when no new segment has closed', () => {
    expect(deltaFor(closed, 4)).toEqual([])
  })

  it('clamps the window so a run of failures cannot latch it shut', () => {
    /*
     * Found by clinical review. `committed` only advances on success, so
     * without this ceiling a long run of failures grows the window until it
     * breaches MAX_LIVE_DELTA_CHARACTERS, after which the route refuses it as
     * invalid for the rest of the consultation and the safety pane freezes
     * with no signal. Losing the oldest segments is recoverable and surfaced;
     * a window that can never be accepted again is not.
     */
    const many = Array.from({ length: 200 }, (_, i) => segment(`Sentence ${i}.`, i * 3))
    expect(deltaFor(many, 0).length).toBe(MAX_LIVE_DELTA_SEGMENTS)
    expect(deltaFor(many, 0).at(-1)?.text).toBe('Sentence 199.')
  })
})

describe('segmentsToDelta', () => {
  it('produces turns the API can accept', () => {
    const turns = segmentsToDelta([
      segment('What brings you in today?', 0),
      segment('A sore throat since Monday.', 3),
    ])
    expect(turns.length).toBeGreaterThan(0)
    for (const turn of turns) {
      expect(turn.text.length).toBeGreaterThan(0)
      expect(['doctor', 'patient']).toContain(turn.speaker)
    }
  })

  it('reconstructs from the same segments, so labelling is never skipped', () => {
    // `segmentsToDraft` refuses to label unless the text reconstructs exactly.
    // Joining the text any other way silently drops to unlabelled prose.
    const segments = [segment('Any fever?', 0), segment('A little.', 3)]
    expect(segmentsToDelta(segments).length).toBeGreaterThan(0)
  })

  it('returns nothing for no segments', () => {
    expect(segmentsToDelta([])).toEqual([])
  })
})

describe('mergeFlags', () => {
  it('adds a newly raised flag', () => {
    expect(mergeFlags([flag('a')], [flag('b')]).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('never drops a flag the doctor has already been shown', () => {
    // A window with no flags must not clear the pane.
    expect(mergeFlags([flag('a')], []).map((f) => f.id)).toEqual(['a'])
  })

  it('keeps the first instance when the lookback resends one', () => {
    const first = flag('a')
    const resent = { ...flag('a'), evidence: 'different wording' }
    expect(mergeFlags([first], [resent])[0]).toBe(first)
  })
})

describe('appendOnly', () => {
  it('accepts an extension of what is already shown', () => {
    expect(appendOnly(['one'], ['one', 'two'])).toEqual(['one', 'two'])
  })

  it('refuses a payload that rewrites a shown line', () => {
    expect(appendOnly(['one', 'two'], ['one', 'rewritten'])).toEqual(['one', 'two'])
  })

  it('refuses a payload that drops a shown line', () => {
    expect(appendOnly(['one', 'two'], ['one'])).toEqual(['one', 'two'])
  })

  it('accepts anything when nothing has been shown yet', () => {
    expect(appendOnly([], ['one'])).toEqual(['one'])
  })
})
