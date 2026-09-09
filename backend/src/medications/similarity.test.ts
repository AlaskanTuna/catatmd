import { describe, expect, it } from 'vitest'
import {
  admits,
  ORTHOGRAPHIC_BAR,
  orthographicSimilarity,
  PHONETIC_BAR,
  phoneticSimilarity,
  similarity,
} from './similarity.js'

/**
 * Why both measures exist (issue #311).
 *
 * Each of the two cases below is missed by one measure on its own and caught
 * by the pair. They were found by running the real library over the lexicon,
 * not chosen from memory, and the codes are quoted so a reader can check
 * them without running anything.
 *
 * The thresholds are pinned in three separate ways on purpose. A behavioural
 * test written as `>= PHONETIC_BAR` would stay green while the bar moved, so
 * the behavioural tests name string pairs and no constants at all, and the
 * constants are asserted against their literals separately. Retuning is then
 * a visible diff in a safety test rather than a silent change.
 */

describe('neither measure is sufficient alone', () => {
  it('catches a garbling that keeps the sound and loses the spelling', () => {
    // cefuroxime -> sefuroxeem. A soft c heard as s, and "ime" spelled "eem".
    // Both are SFRKSM, so they sound identical, but six edits over ten
    // characters puts edit distance well under any usable bar.
    expect(phoneticSimilarity('cefuroxime', 'sefuroxeem')).toBeCloseTo(1, 3)
    expect(orthographicSimilarity('cefuroxime', 'sefuroxeem')).toBeCloseTo(0.6, 3)

    expect(orthographicSimilarity('cefuroxime', 'sefuroxeem')).toBeLessThan(ORTHOGRAPHIC_BAR)
    expect(admits(similarity('cefuroxime', 'sefuroxeem'))).toBe(true)
  })

  it('catches a garbling that keeps the spelling and loses the sound', () => {
    // cefuroxime -> cefuroime, one dropped x. Phoneme deletion is the
    // commonest recogniser error, and it is the one case where Double
    // Metaphone moves further than the spelling does: SFRKSM against SFRM,
    // two code edits over six, while the words are nine tenths identical.
    expect(phoneticSimilarity('cefuroxime', 'cefuroime')).toBeCloseTo(0.667, 3)
    expect(orthographicSimilarity('cefuroxime', 'cefuroime')).toBeCloseTo(0.9, 3)

    expect(phoneticSimilarity('cefuroxime', 'cefuroime')).toBeLessThan(PHONETIC_BAR)
    expect(admits(similarity('cefuroxime', 'cefuroime'))).toBe(true)
  })

  it('still refuses a pair that neither measure likes', () => {
    // The bars are not simply low. An ordinary Malay consultation word gets
    // nowhere near a drug name on either measure.
    expect(phoneticSimilarity('paracetamol', 'perlu')).toBeLessThan(PHONETIC_BAR)
    expect(orthographicSimilarity('paracetamol', 'perlu')).toBeLessThan(ORTHOGRAPHIC_BAR)
    expect(admits(similarity('paracetamol', 'perlu'))).toBe(false)
  })
})

describe('the thresholds themselves', () => {
  it('sit where the measurements put them', () => {
    // Changing either of these changes which drug names reach a doctor.
    expect(PHONETIC_BAR).toBe(0.7)
    expect(ORTHOGRAPHIC_BAR).toBe(0.8)
  })

  it('clears the loudest noise measured on this lexicon', () => {
    // Highest phonetic score between any drug name and any ordinary
    // consultation word was 0.500, highest orthographic 0.400.
    expect(PHONETIC_BAR).toBeGreaterThan(0.5)
    expect(ORTHOGRAPHIC_BAR).toBeGreaterThan(0.4)
  })

  it('admits the look-alike sound-alike pair the boundary decision names', () => {
    // 0.714, so the phonetic bar cannot rise above 0.71 without silently
    // dropping the amoxicillin/amoxapine proposal that D-001 requires.
    expect(phoneticSimilarity('amoxicillin', 'amoxapine')).toBeCloseTo(0.714, 3)
    expect(admits(similarity('amoxicillin', 'amoxapine'))).toBe(true)
  })
})

describe('ranking', () => {
  it('sorts a true mishear above a different drug that merely sounds alike', () => {
    // Both are offered. The ordering is what makes the safer one land first.
    const mishear = similarity('cefuroxime', 'sefuroxeem').score
    const lookAlike = similarity('amoxicillin', 'amoxapine').score

    expect(mishear).toBeGreaterThan(lookAlike)
  })
})

describe('orthographicSimilarity', () => {
  it('is 1 for identical strings and 0 for a total mismatch', () => {
    expect(orthographicSimilarity('amoxicillin', 'amoxicillin')).toBe(1)
    expect(orthographicSimilarity('abc', 'xyz')).toBe(0)
    expect(orthographicSimilarity('', '')).toBe(1)
  })
})
