import { describe, expect, it } from 'vitest'
import { aggregate, characterErrorRate, normalise, wordErrorRate } from './wer.js'

/**
 * The scorer is a port, so these tests pin the ported behaviour rather than
 * describe a fresh design: a rate computed differently from the
 * `qwen3-asr-flash` rows in `evals/reports/` cannot be compared with them.
 *
 * Each function is given an input it must reject or handle, per the convention
 * `graders.test.ts` sets. Unit counts are asserted alongside rates because a
 * count is what catches a mangled encoding or a UTF-16 split; a rate on its own
 * can be right for the wrong reason.
 */

describe('normalise', () => {
  it('turns punctuation into spaces and collapses the result', () => {
    expect(normalise('Doktor, batuk  sudah!')).toBe('doktor batuk sudah')
  })

  it('folds fullwidth forms to ASCII, which is the NFKC half', () => {
    expect(normalise('ＡＢＣ')).toBe('abc')
  })

  it('reduces punctuation-only input to the empty string', () => {
    expect(normalise('...!!!')).toBe('')
  })
})

describe('wordErrorRate', () => {
  it('scores an identical pair as zero', () => {
    expect(wordErrorRate('batuk sudah empat hari', 'batuk sudah empat hari')).toEqual({
      rate: 0,
      edits: 0,
      units: 4,
    })
  })

  it('scores one substitution in four words as 0.25', () => {
    expect(wordErrorRate('batuk sudah empat hari', 'batuk sudah lima hari')).toMatchObject({
      rate: 0.25,
      edits: 1,
    })
  })

  it('counts a deletion as one edit', () => {
    expect(wordErrorRate('batuk sudah empat hari', 'batuk sudah hari')).toMatchObject({
      edits: 1,
      units: 4,
    })
  })

  it('counts an insertion as one edit', () => {
    expect(wordErrorRate('batuk sudah hari', 'batuk sudah empat hari')).toMatchObject({
      edits: 1,
      units: 3,
    })
  })

  // The one that matters most. ILMU returns flat, unpunctuated, lowercase prose
  // while the scripted ground truth is fully punctuated, so without this every
  // measured rate would be dominated by formatting rather than by recognition.
  it('ignores differences that are only case and punctuation', () => {
    expect(
      wordErrorRate('Doktor, batuk sudah empat hari lah.', 'doktor batuk sudah empat hari lah'),
    ).toMatchObject({ rate: 0, edits: 0 })
  })

  it('returns a null rate for an empty reference rather than dividing by zero', () => {
    expect(wordErrorRate('', 'anything at all')).toEqual({ rate: null, edits: 0, units: 0 })
  })

  // Golden case, computed by hand from the Python semantics. The pair is the
  // real measured devoicing error from `docs/trd.md` section 20.3: ILMU hears
  // "patut" for "batuk". One substitution across six words.
  it('scores the measured devoicing error at one word in six', () => {
    expect(
      wordErrorRate('Doktor, batuk sudah empat hari lah.', 'doktor patut sudah empat hari lah'),
    ).toEqual({ rate: 1 / 6, edits: 1, units: 6 })
  })
})

describe('characterErrorRate', () => {
  it('scores Mandarin by character, since it carries no word boundaries', () => {
    // units must be 6, not 18: a mis-decoded file would count UTF-8 bytes here.
    expect(characterErrorRate('病人今天咳嗽', '病人今天咳血')).toEqual({
      rate: 1 / 6,
      edits: 1,
      units: 6,
    })
  })

  it('counts code points rather than UTF-16 units', () => {
    const extensionB = String.fromCodePoint(0x20000)
    // Splitting on UTF-16 units would see three units here and a rate of 1/3.
    expect(characterErrorRate(`${extensionB}a`, `${extensionB}b`)).toEqual({
      rate: 0.5,
      edits: 1,
      units: 2,
    })
  })

  it('ignores the spaces that word scoring depends on', () => {
    expect(characterErrorRate('batuk sudah', 'batuksudah')).toMatchObject({ rate: 0, edits: 0 })
  })

  // The same golden pair. "batuk" against "patut" differs at two of the
  // twenty-eight characters once the spaces are removed.
  it('scores the measured devoicing error at two characters in twenty-eight', () => {
    expect(
      characterErrorRate(
        'Doktor, batuk sudah empat hari lah.',
        'doktor patut sudah empat hari lah',
      ),
    ).toEqual({ rate: 2 / 28, edits: 2, units: 28 })
  })
})

describe('aggregate', () => {
  it('weights by units instead of averaging the rates', () => {
    const combined = aggregate([
      { rate: 1, edits: 1, units: 1 },
      { rate: 1 / 9, edits: 1, units: 9 },
    ])
    // Averaging the two rates would give 0.5556, over-weighting the one-word
    // sample nine times over.
    expect(combined).toEqual({ rate: 0.2, edits: 2, units: 10 })
  })

  it('returns a null rate when there is nothing to aggregate', () => {
    expect(aggregate([])).toEqual({ rate: null, edits: 0, units: 0 })
  })
})
