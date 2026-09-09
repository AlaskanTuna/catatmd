import { doubleMetaphone } from 'double-metaphone'

/**
 * How close two drug names are, measured two ways because neither way alone
 * is enough on speech-recognition output.
 *
 * Phonetic alone misses a garbling that keeps the spelling and loses the
 * sound. Orthographic alone misses one that keeps the sound and loses the
 * spelling, which is the commoner failure: `cefuroxime` heard as
 * `sefuroxeem` scores 0.600 on edit distance and 1.000 phonetically.
 *
 * Measured on this lexicon before the bars below were chosen. The highest
 * phonetic score between any drug name and any ordinary consultation word
 * (Malay or English) was 0.500, and the highest orthographic score 0.400, so
 * both bars sit clear of the noise.
 *
 * Pure functions: no I/O, no clock, no randomness.
 */

/** Levenshtein distance. Two rows rather than a full matrix. */
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] as number)
          : 1 + Math.min(previous[j] as number, current[j - 1] as number, previous[j - 1] as number)
    }
    previous = current
  }

  return previous[b.length] as number
}

/** Edit distance normalised to 0..1, where 1 is identical. */
export const orthographicSimilarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest
}

/**
 * Double Metaphone agreement, 0..1.
 *
 * The algorithm emits a primary and an alternate code, so there are four
 * cross-pairs; any exact match means the two words sound the same. Where none
 * matches the result is graded by edit distance *between the codes*, not
 * between the words. A hard 0 or 1 would drop the one case that matters most:
 * `amoxicillin` against `amoxapine` shares `AMKS` and scores 0.714, which is
 * how a look-alike sound-alike pair reaches the doctor as a candidate at all.
 */
export const phoneticSimilarity = (a: string, b: string): number => {
  const [aPrimary, aAlternate] = doubleMetaphone(a)
  const [bPrimary, bAlternate] = doubleMetaphone(b)

  if (
    aPrimary === bPrimary ||
    aPrimary === bAlternate ||
    aAlternate === bPrimary ||
    aAlternate === bAlternate
  ) {
    return 1
  }

  return Math.max(
    orthographicSimilarity(aPrimary, bPrimary),
    orthographicSimilarity(aPrimary, bAlternate),
    orthographicSimilarity(aAlternate, bPrimary),
    orthographicSimilarity(aAlternate, bAlternate),
  )
}

/**
 * Measured, not tuned by taste. Each bar sits above the loudest noise (0.500
 * phonetic, 0.400 orthographic) and below the case it has to admit.
 *
 * `PHONETIC_BAR` is 0.70 because `amoxicillin` against `amoxapine` scores
 * 0.714, and D-001 requires that pair to reach the doctor as a candidate:
 * either the doctor said amoxapine and was heard right, or said amoxicillin
 * and was heard wrong, and only they can tell.
 */
export const PHONETIC_BAR = 0.7
export const ORTHOGRAPHIC_BAR = 0.8

export type Similarity = {
  readonly phonetic: number
  readonly orthographic: number
  /** The mean, used to rank admitted candidates, never to admit them. */
  readonly score: number
}

export const similarity = (a: string, b: string): Similarity => {
  const phonetic = phoneticSimilarity(a, b)
  const orthographic = orthographicSimilarity(a, b)
  return { phonetic, orthographic, score: (phonetic + orthographic) / 2 }
}

/**
 * Either measure alone is enough. A disjunction rather than a weighted sum,
 * because a convex sum is bounded by the larger of its parts, so a weighted
 * bar could never admit anything the two bars did not already admit.
 *
 * Ranking is the mean, which keeps the ordering honest: a true mishear such
 * as `sefuroxeem` for `cefuroxime` means 0.800, while the dangerous
 * `amoxapine` against `amoxicillin` means 0.584 and sorts below it.
 */
export const admits = ({ phonetic, orthographic }: Similarity): boolean =>
  phonetic >= PHONETIC_BAR || orthographic >= ORTHOGRAPHIC_BAR
