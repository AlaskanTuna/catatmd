import { describe, expect, it } from 'vitest'
import { segmentsToDraft, voteRolesBySpeaker } from '../draft-turns.js'
import {
  batchWordsToTokens,
  MAX_REFINED_UNITS_PER_MINUTE,
  MIN_REFINED_UNIT_RATIO,
  MIN_SPEAKER_COVERAGE,
  refinementCheckTexts,
  refinementTimeoutMs,
  refinementVerdict,
  units,
} from './batch-tokens.js'
import type { BatchWord } from './elevenlabs-batch.js'
import { type LiveToken, SEGMENT_GAP_MS, tokensToSegments, tokensToText } from './live-tokens.js'

/**
 * The refined transcript is mapped onto the live path's own token shape, so
 * everything downstream (segments, the labelling pass, the voice vote) runs
 * unchanged, and every check it must pass before it replaces the live one is a
 * pure function here (#436).
 */

const word = (
  text: string,
  start: number,
  end: number,
  speaker: string | null = 'speaker_0',
): BatchWord => ({
  text,
  start,
  end,
  type: 'word',
  ...(speaker === null ? {} : { speaker_id: speaker }),
})

const space = (start: number, end: number, speaker = 'speaker_0'): BatchWord => ({
  text: ' ',
  start,
  end,
  type: 'spacing',
  speaker_id: speaker,
})

/** A sentence as the vendor returns it: words with spacing elements between. */
function sentence(text: string, startAt: number, speaker: string): BatchWord[] {
  const out: BatchWord[] = []
  let at = startAt
  for (const [index, piece] of text.split(' ').entries()) {
    if (index > 0) out.push(space(at, at, speaker))
    out.push(word(piece, at, at + 0.3, speaker))
    at += 0.4
  }
  return out
}

const liveToken = (text: string, startMs: number, speaker: string | null = '1'): LiveToken => ({
  text,
  startMs,
  endMs: startMs + 300,
  isFinal: true,
  speaker,
  language: null,
  confidence: 0.9,
  endpoint: false,
})

/** A live transcript of the same words, so the unit ratio holds. */
function liveOf(words: readonly BatchWord[]): LiveToken[] {
  return batchWordsToTokens(words)
}

describe('batchWordsToTokens', () => {
  it('folds a spacing element into the word after it, as the live tokens carry spaces', () => {
    const tokens = batchWordsToTokens([
      word('Selamat', 0, 0.4),
      space(0.4, 0.5),
      word('pagi', 0.5, 0.9),
    ])

    expect(tokens.map((token) => token.text)).toEqual(['Selamat', ' pagi'])
    expect(tokensToText(tokens)).toBe('Selamat pagi')
  })

  it('maps seconds to milliseconds, and the folded word keeps its own timing', () => {
    const [, second] = batchWordsToTokens([
      word('Selamat', 0, 0.4),
      space(0.4, 0.5),
      word('pagi', 0.5, 0.9),
    ])

    expect(second).toMatchObject({ startMs: 500, endMs: 900, isFinal: true, endpoint: false })
  })

  it('numbers speakers from one, the way the live path shows them', () => {
    const tokens = batchWordsToTokens([
      word('Hello', 0, 0.3, 'speaker_0'),
      word('Hi', 1, 1.3, 'speaker_1'),
      word('x', 2, 2.3, 'speaker_9'),
    ])

    expect(tokens.map((token) => token.speaker)).toEqual(['1', '2', '10'])
  })

  it('leaves an unrecognised or absent speaker as unknown rather than guessing', () => {
    const tokens = batchWordsToTokens([word('Hello', 0, 0.3, null), word('Hi', 1, 1.3, 'agent')])

    expect(tokens.map((token) => token.speaker)).toEqual([null, null])
  })

  it('carries no confidence, so a refined transcript shows no uncertainty cues', () => {
    const tokens = batchWordsToTokens([word('batuk', 0, 0.4)])

    expect(tokens[0]?.confidence).toBeNull()
    expect(tokensToSegments(tokens)[0]?.uncertain).toBeUndefined()
  })

  it('drops audio events, so a cough is never written into the text as a word', () => {
    const tokens = batchWordsToTokens([
      word('Batuk', 0, 0.4),
      { text: '(coughs)', start: 0.5, end: 1, type: 'audio_event', speaker_id: 'speaker_1' },
      space(1, 1.1),
      word('lagi', 1.1, 1.4),
    ])

    expect(tokensToText(tokens)).toBe('Batuk lagi')
  })

  it('concatenates Chinese, which carries no spacing elements', () => {
    const tokens = batchWordsToTokens([
      word('咳', 0, 0.2),
      word('嗽', 0.2, 0.4),
      word('三', 0.4, 0.6),
      word('天', 0.6, 0.8),
    ])

    expect(tokensToText(tokens)).toBe('咳嗽三天')
  })

  it('still cuts a segment on a long pause when spacing sits inside the gap', () => {
    // The spacing element spans the silence. Folding it into the next word
    // with that word's own start is what keeps the pause visible to the
    // 1500 ms backstop; taking the spacing's start would hide it.
    const tokens = batchWordsToTokens([
      word('Okay', 0, 0.5),
      space(0.5, 0.5 + (SEGMENT_GAP_MS + 500) / 1_000),
      word('next', 0.5 + (SEGMENT_GAP_MS + 500) / 1_000, 3),
    ])

    expect(tokensToSegments(tokens).map((segment) => segment.text)).toEqual(['Okay', 'next'])
  })

  it('cuts on a change of voice, giving segments the drafting pass can use', () => {
    const words = [
      ...sentence('What brings you in today?', 0, 'speaker_0'),
      space(2, 2.5, 'speaker_1'),
      ...sentence('I have a cough for three days.', 2.5, 'speaker_1'),
    ]
    const tokens = batchWordsToTokens(words)
    const segments = tokensToSegments(tokens)

    expect(segments.map((segment) => [segment.speaker, segment.text])).toEqual([
      ['1', 'What brings you in today?'],
      ['2', 'I have a cough for three days.'],
    ])
    // `usable()` inside `segmentsToDraft` refuses segments that do not rebuild
    // the text, so a non-empty draft is the proof they do.
    expect(segmentsToDraft(segments, tokensToText(tokens)).length).toBeGreaterThan(0)
  })

  it('gives the voice vote a decisive ranking', () => {
    const words = [
      ...sentence('What brings you in today?', 0, 'speaker_0'),
      ...sentence('I have a cough and my throat hurts.', 3, 'speaker_1'),
      ...sentence('How long have you had the cough?', 7, 'speaker_0'),
      ...sentence('I have had it for three days.', 10, 'speaker_1'),
      ...sentence('Do you have any fever?', 13, 'speaker_0'),
      ...sentence('Yes.', 16, 'speaker_1'),
    ]
    const tokens = batchWordsToTokens(words)
    const segments = tokensToSegments(tokens)
    const drafted = segmentsToDraft(segments, tokensToText(tokens))

    const voted = voteRolesBySpeaker(drafted, segments)

    expect(voted.map((line) => [line.speaker, line.text])).toEqual([
      ['doctor', 'What brings you in today?'],
      ['patient', 'I have a cough and my throat hurts.'],
      ['doctor', 'How long have you had the cough?'],
      ['patient', 'I have had it for three days.'],
      ['doctor', 'Do you have any fever?'],
      ['patient', 'Yes.'],
    ])
  })
})

describe('units', () => {
  it('counts words in spaced scripts and characters in Chinese', () => {
    expect(units('saya batuk tiga hari')).toBe(4)
    expect(units('咳嗽三天')).toBe(4)
    expect(units('ada MC 咳嗽')).toBe(4)
    expect(units(' ... ')).toBe(0)
  })
})

describe('refinementVerdict', () => {
  const conversation = [
    ...sentence('Ada batuk sikit doktor', 0, 'speaker_1'),
    ...sentence('Berapa lama sudah batuk', 2, 'speaker_0'),
    ...sentence('Tiga hari', 4, 'speaker_1'),
  ]
  const live = liveOf(conversation)

  it('accepts a refined transcript that passes every row, and returns its tokens', () => {
    const verdict = refinementVerdict({ words: conversation, live, durationSeconds: 60 })

    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(tokensToText(verdict.tokens)).toBe(tokensToText(live))
  })

  it('refuses a transcript with no words', () => {
    expect(refinementVerdict({ words: [], live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'no_words',
    })
    expect(
      refinementVerdict({ words: [space(0, 1), word('  ', 1, 2)], live, durationSeconds: 60 }),
    ).toEqual({ ok: false, reason: 'no_words' })
  })

  it(`refuses when fewer than ${MIN_SPEAKER_COVERAGE * 100}% of words carry a speaker`, () => {
    const words = conversation.map((entry, index) =>
      entry.type === 'word' && index < 6 ? { ...entry, speaker_id: null } : entry,
    )

    expect(refinementVerdict({ words, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'speakers_missing',
    })
  })

  it('refuses one voice where the live transcript heard two', () => {
    // The medical model's failure mode in §20.13: voices merged into one.
    const words = conversation.map((entry) => ({ ...entry, speaker_id: 'speaker_0' }))

    expect(refinementVerdict({ words, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'speaker_count',
    })
  })

  it('accepts one voice where the live transcript also heard only one', () => {
    const words = conversation.map((entry) => ({ ...entry, speaker_id: 'speaker_0' }))
    const single = live.map((token) => ({ ...token, speaker: '1' }))

    expect(refinementVerdict({ words, live: single, durationSeconds: 60 }).ok).toBe(true)
  })

  it('refuses more than two voices, which the config asked the vendor not to return', () => {
    const words = conversation.map((entry, index) =>
      index === 0 ? { ...entry, speaker_id: 'speaker_2' } : entry,
    )

    expect(refinementVerdict({ words, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'speaker_count',
    })
  })

  it('counts reconnected live voices by number, not by connection', () => {
    // `fromConnection` marks a reopened socket's voices `n/c`; the person is
    // still one of two.
    const reconnected = live.map((token, index) =>
      index > 6 ? { ...token, speaker: `${token.speaker}/1` } : token,
    )

    expect(
      refinementVerdict({ words: conversation, live: reconnected, durationSeconds: 60 }).ok,
    ).toBe(true)
  })

  it('refuses word starts that run backwards', () => {
    // The third word now starts before the second one did.
    const words = conversation.map((entry, index) =>
      index === 4 ? { ...entry, start: 0.1 } : entry,
    )

    expect(refinementVerdict({ words, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'timing',
    })
  })

  it('refuses a word with no timing', () => {
    const words = conversation.map((entry, index) =>
      index === 2 ? { ...entry, start: null } : entry,
    )

    expect(refinementVerdict({ words, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'timing',
    })
  })

  it(`refuses a refined transcript under ${MIN_REFINED_UNIT_RATIO} of the live one`, () => {
    const short = sentence('Tiga hari', 0, 'speaker_0').concat(sentence('Ya', 1, 'speaker_1'))

    expect(refinementVerdict({ words: short, live, durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'too_short',
    })
  })

  it(`refuses more than ${MAX_REFINED_UNITS_PER_MINUTE} units a minute of recording`, () => {
    const many = Array.from({ length: 160 }, (_, index) => {
      const speaker = index % 2 ? 'speaker_0' : 'speaker_1'
      const at = index * 0.05
      return [space(at, at, speaker), word(`w${index}`, at, at + 0.04, speaker)]
    }).flat()
    const sparseLive = liveOf(many.slice(0, 260))

    // 160 units in 30 seconds is 320 a minute.
    expect(refinementVerdict({ words: many, live: sparseLive, durationSeconds: 30 })).toEqual({
      ok: false,
      reason: 'too_dense',
    })
    expect(refinementVerdict({ words: many, live: sparseLive, durationSeconds: 60 }).ok).toBe(true)
  })

  it.each([
    ['Bengali', 'আমার জ্বর'],
    ['Arabic', 'بخار ہے'],
    ['Devanagari', 'इन्नकी एन्ना'],
  ])('refuses %s script the live transcript did not have', (_script, text) => {
    // §20.13 finding 3: a recogniser under automatic language rewrote Tamil in
    // Devanagari. A script nobody spoke is a transcript nobody said.
    const words = [...conversation, space(5, 5, 'speaker_1'), ...sentence(text, 5, 'speaker_1')]

    expect(refinementVerdict({ words, live: liveOf(conversation), durationSeconds: 60 })).toEqual({
      ok: false,
      reason: 'new_script',
    })
  })

  it('accepts such a script when the live transcript had it too', () => {
    const words = [
      ...conversation,
      space(5, 5, 'speaker_1'),
      ...sentence('আমার জ্বর', 5, 'speaker_1'),
    ]

    expect(refinementVerdict({ words, live: liveOf(words), durationSeconds: 60 }).ok).toBe(true)
  })

  it('reads the live voices from settled speech only', () => {
    // A translation is not speech: counted, its seven words would push the
    // live side past what the refined one has to match.
    const withMarker: LiveToken[] = [
      ...live,
      { ...liveToken('', 9_000, null), endpoint: true },
      { ...liveToken(' satu dua tiga empat lima enam tujuh', 9_100, '3'), translated: true },
    ]

    expect(
      refinementVerdict({ words: conversation, live: withMarker, durationSeconds: 60 }).ok,
    ).toBe(true)
  })
})

describe('refinementCheckTexts', () => {
  it('sends the segment texts each recogniser cut, and nothing else', () => {
    const tokens = batchWordsToTokens([
      ...sentence('Any fever?', 0, 'speaker_0'),
      ...sentence('Ada batuk berdarah.', 2, 'speaker_1'),
    ])

    expect(refinementCheckTexts(tokens)).toEqual(['Any fever?', 'Ada batuk berdarah.'])
  })
})

describe('refinementTimeoutMs', () => {
  it('is thirty seconds plus fifteen a minute, between one and four minutes', () => {
    expect(refinementTimeoutMs(10)).toBe(60_000)
    expect(refinementTimeoutMs(120)).toBe(60_000)
    expect(refinementTimeoutMs(600)).toBe(180_000)
    expect(refinementTimeoutMs(1_800)).toBe(240_000)
  })
})
