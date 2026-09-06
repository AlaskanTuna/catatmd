/**
 * Word and character error rates for the ASR harness (`docs/trd.md` §20.9).
 *
 * A port of the scorer behind `evals/reports/fleurs-qwen3-asr-flash-2026-09-05.md`,
 * kept deliberately faithful: a rate computed under different normalisation cannot
 * be compared with the rows already published for `qwen3-asr-flash`, and comparing
 * them is the reason this exists. Normalisation is NFKC, lowercased, punctuation
 * stripped, exactly as that report states.
 *
 * Pure and offline, so unlike `asr-ab.ts` this belongs in `bun run test`.
 */

/**
 * `\p{L}\p{N}_` is Python's Unicode `\w` for Latin and Han. The two diverge only
 * on combining marks, which is Tamil, and Tamil is unsupported on every in-region
 * provider.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export interface ErrorRate {
  /** Edits over reference units, or `null` when the reference has no units. */
  rate: number | null
  edits: number
  units: number
}

/**
 * Levenshtein over two token arrays, two rows at a time.
 *
 * `Uint32Array` keeps the two rows fixed-size and cheap. `noUncheckedIndexedAccess`
 * types even a typed-array read as possibly undefined and Biome forbids `!`, so
 * the `?? 0` fallbacks stand in for a cast. Every index below is provably inside
 * its row, so none of them can actually be taken.
 */
function levenshtein(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = new Uint32Array(b.length + 1)
  let current = new Uint32Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    const left = a[i - 1]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left === b[j - 1] ? 0 : 1)
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution)
    }
    const finished = previous
    previous = current
    current = finished
  }
  return previous[b.length] ?? 0
}

/** Empty after normalisation is `[]`, matching Python's `str.split()`, not `['']`. */
const words = (text: string): string[] => (text === '' ? [] : text.split(' '))

/** Spaces removed first: Mandarin has no word boundaries. Code points, not units. */
const characters = (text: string): string[] => [...text.replaceAll(' ', '')]

function score(
  reference: string,
  hypothesis: string,
  split: (text: string) => string[],
): ErrorRate {
  const referenceUnits = split(normalise(reference))
  if (referenceUnits.length === 0) return { rate: null, edits: 0, units: 0 }

  const edits = levenshtein(referenceUnits, split(normalise(hypothesis)))
  return { rate: edits / referenceUnits.length, edits, units: referenceUnits.length }
}

export const wordErrorRate = (reference: string, hypothesis: string): ErrorRate =>
  score(reference, hypothesis, words)

export const characterErrorRate = (reference: string, hypothesis: string): ErrorRate =>
  score(reference, hypothesis, characters)

/**
 * Total edits over total units, never the mean of the rates. The two agree only
 * when every reference is the same length, so averaging rates silently
 * over-weights short samples.
 */
export function aggregate(rates: readonly ErrorRate[]): ErrorRate {
  let edits = 0
  let units = 0
  for (const rate of rates) {
    edits += rate.edits
    units += rate.units
  }
  return { rate: units === 0 ? null : edits / units, edits, units }
}
