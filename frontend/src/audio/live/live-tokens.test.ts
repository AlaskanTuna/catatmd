import { describe, expect, it } from 'vitest'
import { segmentsToDraft } from '../draft-turns.js'
import {
  absorb,
  EMPTY_LIVE_TRANSCRIPT,
  interimSpeaker,
  interimText,
  type LiveToken,
  SEGMENT_GAP_MS,
  tokensToSegments,
  tokensToText,
} from './live-tokens.js'

const token = (text: string, overrides: Partial<LiveToken> = {}): LiveToken => ({
  text,
  startMs: 0,
  endMs: 500,
  isFinal: true,
  speaker: '1',
  language: 'en',
  endpoint: false,
  ...overrides,
})

/** Consecutive tokens 100 ms apart, so nothing trips the pause backstop. */
const run = (texts: string[], overrides: Partial<LiveToken> = {}): LiveToken[] =>
  texts.map((text, i) => token(text, { startMs: i * 600, endMs: i * 600 + 500, ...overrides }))

describe('absorb', () => {
  it('appends settled tokens, which the recogniser sends once and never repeats', () => {
    const first = absorb(EMPTY_LIVE_TRANSCRIPT, run(['Good', ' morning']))
    const second = absorb(first, run([' doctor']))

    expect(second.final.map((t) => t.text)).toEqual(['Good', ' morning', ' doctor'])
  })

  it('replaces the unsettled tail rather than accumulating it', () => {
    // Provisional tokens are re-sent in full and change until they settle.
    // Accumulating them is the bug that makes live text stutter and duplicate.
    const first = absorb(EMPTY_LIVE_TRANSCRIPT, [token('bat', { isFinal: false })])
    const second = absorb(first, [token('batuk', { isFinal: false })])

    expect(second.interim.map((t) => t.text)).toEqual(['batuk'])
  })

  it('clears the tail when a message carries no unsettled tokens', () => {
    const withTail = absorb(EMPTY_LIVE_TRANSCRIPT, [token('bat', { isFinal: false })])

    expect(absorb(withTail, run(['batuk'])).interim).toEqual([])
  })

  it('leaves the settled text untouched when only the tail moves', () => {
    const settled = absorb(EMPTY_LIVE_TRANSCRIPT, run(['Good']))
    const next = absorb(settled, [token('mor', { isFinal: false })])

    expect(next.final).toBe(settled.final)
  })
})

describe('tokensToSegments speaker attribution', () => {
  it('carries the speaker off the tokens that formed the group', () => {
    // The recogniser diarises, and the live view needs the label to read as a
    // conversation. It was previously used to cut groups and then discarded.
    const segments = tokensToSegments([
      token('Any fever?', { speaker: '1' }),
      token(' Yes, since Tuesday.', { speaker: '2', startMs: 2_000, endMs: 3_000 }),
    ])

    expect(segments.map((segment) => segment.speaker)).toEqual(['1', '2'])
  })

  it('leaves the speaker null when the recogniser does not diarise', () => {
    const segments = tokensToSegments([token('Hello there.', { speaker: null })])
    expect(segments[0]?.speaker).toBeNull()
  })
})

describe('tokensToSegments', () => {
  it('keeps one speaker talking without a pause as a single segment', () => {
    const segments = tokensToSegments(run(['Good', ' morning', ' doctor']))

    expect(segments).toHaveLength(1)
    expect(segments[0]?.text).toBe('Good morning doctor')
  })

  it('starts a new segment when the speaker changes', () => {
    const doctor = run(['What brings you in'], { speaker: '1' })
    const patient = run(['I have a cough'], { speaker: '2' }).map((t) => ({
      ...t,
      startMs: 2_000,
      endMs: 2_500,
    }))

    expect(tokensToSegments([...doctor, ...patient]).map((s) => s.text)).toEqual([
      'What brings you in',
      'I have a cough',
    ])
  })

  it('closes a segment on an endpoint marker and never renders it', () => {
    const segments = tokensToSegments([
      ...run(['Good morning']),
      token('<end>', { endpoint: true, startMs: 600, endMs: 600 }),
      token(' How long', { startMs: 1_000, endMs: 1_500 }),
    ])

    expect(segments.map((s) => s.text)).toEqual(['Good morning', 'How long'])
    expect(segments.some((s) => s.text.includes('<end>'))).toBe(false)
  })

  it('breaks on a pause longer than the backstop, and not on a shorter one', () => {
    const short = tokensToSegments([
      token('one', { startMs: 0, endMs: 500 }),
      token(' two', { startMs: 500 + SEGMENT_GAP_MS - 100, endMs: 500 + SEGMENT_GAP_MS + 400 }),
    ])
    const long = tokensToSegments([
      token('one', { startMs: 0, endMs: 500 }),
      token(' two', { startMs: 500 + SEGMENT_GAP_MS + 100, endMs: 500 + SEGMENT_GAP_MS + 600 }),
    ])

    expect(short).toHaveLength(1)
    expect(long).toHaveLength(2)
  })

  it('carries timestamps from the first and last token of each group, in seconds', () => {
    const segments = tokensToSegments([
      token('one', { startMs: 1_200, endMs: 1_800 }),
      token(' two', { startMs: 1_800, endMs: 2_400 }),
    ])

    expect(segments[0]).toMatchObject({ start: 1.2, end: 2.4 })
  })

  it('joins tokens without inserting spaces, so Chinese does not gain gaps', () => {
    // Tokens carry their own leading spaces; Chinese tokens carry none.
    const segments = tokensToSegments(run(['我', '咳嗽', '三天']))

    expect(segments[0]?.text).toBe('我咳嗽三天')
  })

  it('drops a group that is only whitespace rather than emitting an empty segment', () => {
    expect(tokensToSegments(run([' ', '  ']))).toEqual([])
  })

  it('returns nothing for no tokens', () => {
    expect(tokensToSegments([])).toEqual([])
  })
})

describe('tokensToText and the labelling pass it feeds', () => {
  it('produces text the segments reconstruct exactly, so labels survive', () => {
    // `segmentsToDraft` refuses to label unless the segments rebuild the text.
    // Deriving both from one place is what keeps that check passing; two
    // independent joins would drift on whitespace and silently fall back to
    // unlabelled prose.
    const tokens = [
      ...run(['What brings you in today'], { speaker: '1' }),
      ...run(['I have had a cough for three days'], { speaker: '2' }).map((t) => ({
        ...t,
        startMs: 5_000,
        endMs: 5_500,
      })),
    ]

    const text = tokensToText(tokens)
    const segments = tokensToSegments(tokens)

    expect(segments.map((s) => s.text).join(' ')).toBe(text)
    expect(segmentsToDraft(segments, text, { withOffsets: true }).length).toBeGreaterThan(0)
  })

  it('never carries a control marker into the transcript', () => {
    const text = tokensToText([
      ...run(['Good morning']),
      token('<end>', { endpoint: true, startMs: 600, endMs: 600 }),
      token('<fin>', { endpoint: true, startMs: 700, endMs: 700 }),
    ])

    expect(text).not.toContain('<end>')
    expect(text).not.toContain('<fin>')
  })
})

describe('interimText', () => {
  it('renders the unsettled tail as plain text', () => {
    expect(
      interimText([token('I have', { isFinal: false }), token(' a cou', { isFinal: false })]),
    ).toBe('I have a cou')
  })

  it('omits control markers, which are boundaries rather than speech', () => {
    expect(
      interimText([
        token('<end>', { isFinal: false, endpoint: true }),
        token('ok', { isFinal: false }),
      ]),
    ).toBe('ok')
  })

  it('is empty when nothing is pending', () => {
    expect(interimText([])).toBe('')
  })
})

describe('tokensToSegments when diarisation is noisy', () => {
  /*
   * The recogniser emits subword tokens, so "Ya" arrives as "Y" then "a", and
   * its real-time diarisation is documented to show "temporary speaker
   * switches that stabilize as more context is available". A switch that lands
   * inside a word must never become a segment boundary: it renders one word
   * across two lines, and `segmentsToDraft` reads a boundary as its primary
   * evidence of a real speaker handoff.
   */
  const midWordFlip = [
    token('Y', { speaker: '1', startMs: 25_000, endMs: 25_120 }),
    token('a', { speaker: '2', startMs: 25_120, endMs: 25_240 }),
    token(', semalam around 38.5', { speaker: '2', startMs: 25_240, endMs: 26_500 }),
  ]

  it('never closes a segment inside a word', () => {
    const segments = tokensToSegments(midWordFlip)

    expect(segments).toHaveLength(1)
    expect(segments[0]?.text).toBe('Ya, semalam around 38.5')
  })

  it('does not let one mis-diarised subword relabel the whole turn', () => {
    // Reading the group's first token said '1' here, which is how a single bad
    // subword captured an entire patient turn.
    expect(tokensToSegments(midWordFlip)[0]?.speaker).toBe('2')
  })

  it('still cuts on a speaker change at a word boundary with no pause', () => {
    // The leading space is what makes this a boundary rather than a word, so
    // the guard must not swallow a handoff merely because it arrived quickly.
    const segments = tokensToSegments([
      token('badan pun rasa very tired', { speaker: '2', startMs: 13_000, endMs: 15_000 }),
      token(' Okay', { speaker: '1', startMs: 15_000, endMs: 15_400 }),
    ])

    expect(segments.map((segment) => segment.text)).toEqual(['badan pun rasa very tired', 'Okay'])
  })

  it('still cuts between Chinese tokens, which carry no leading space', () => {
    // The guard keys on Latin script precisely so it cannot suppress a cut
    // here, where every token is its own word and none carries a space.
    const segments = tokensToSegments([
      token('我咳嗽三天', { speaker: '2', startMs: 0, endMs: 1_500 }),
      token('好的', { speaker: '1', startMs: 1_500, endMs: 2_000 }),
    ])

    expect(segments.map((segment) => segment.text)).toEqual(['我咳嗽三天', '好的'])
  })
})

describe('interimSpeaker', () => {
  it('reads whoever holds most of the tail, not whoever opened it', () => {
    expect(
      interimSpeaker([
        token('Y', { isFinal: false, speaker: '1', startMs: 0, endMs: 120 }),
        token('a', { isFinal: false, speaker: '2', startMs: 120, endMs: 240 }),
        token(', semalam', { isFinal: false, speaker: '2', startMs: 240, endMs: 1_400 }),
      ]),
    ).toBe('2')
  })

  it('ignores control markers, which are boundaries rather than speech', () => {
    expect(
      interimSpeaker([
        token('<end>', { isFinal: false, endpoint: true, speaker: '1' }),
        token('ok', { isFinal: false, speaker: '2', startMs: 0, endMs: 500 }),
      ]),
    ).toBe('2')
  })

  it('is null when nothing is pending', () => {
    expect(interimSpeaker([])).toBeNull()
  })
})
