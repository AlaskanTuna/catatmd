import type { ProfileId } from '../clinical-profiles/types.js'
import { lexiconFor, MEDICATION_LEXICON } from './lexicon.js'
import { admits, type Similarity, similarity } from './similarity.js'
import { SIG_STOPWORDS } from './vocabulary.js'

/**
 * Offers spelling candidates for drug names in a dictated phrase.
 *
 * **Nothing here rewrites anything.** A candidate names what was heard and
 * what it might be, and the doctor picks. `MedicationCandidate` has no field
 * that can hold corrected text and this module exports no function that
 * applies one, which is the structural form of the rule in `docs/decisions.md`
 * D-001: "a candidate is offered; the doctor accepts it".
 *
 * Pure functions: no I/O, no clock, no randomness.
 */

/** At most this many proposals per span, so a doctor reads a list, not a page. */
const MAX_CANDIDATES_PER_SPAN = 3

/** Below this, a token is an abbreviation and every drug name is far from it. */
const MIN_TOKEN_LENGTH = 4

/** A garbled name can arrive split across words, so windows span up to three. */
const MAX_WINDOW_TOKENS = 3

export type MedicationCandidate = {
  readonly lexiconId: string
  /** The proposal. Never written back over `heard`. */
  readonly generic: string
  /** Exactly what the doctor said, cut from the untouched input. */
  readonly heard: string
  readonly start: number
  readonly end: number
  readonly score: number
}

/**
 * Lowercased, punctuation dropped, whitespace collapsed, carrying an index
 * map back to the source. Same shape and same purpose as `Expansion` in
 * `redflags/mishears.ts:64`: match against the normalised text, quote from
 * the original.
 *
 * `origin[i]` is the index in `source` that produced normalised character
 * `i`. One entry is pushed per *output* character, inside the lowercase loop,
 * because `toLowerCase` is not one-to-one for every code point and a
 * length-changing fold would otherwise desynchronise the map.
 */
export type Normalised = { readonly text: string; readonly origin: readonly number[] }

const WORD = /[\p{L}\p{N}]/u

export const normalise = (source: string): Normalised => {
  let text = ''
  const origin: number[] = []
  let pendingSeparator = false

  for (let i = 0; i < source.length; i++) {
    const character = source[i] as string

    if (!WORD.test(character)) {
      pendingSeparator = true
      continue
    }

    if (pendingSeparator && text.length > 0) {
      text += ' '
      origin.push(i)
    }
    pendingSeparator = false

    for (const folded of character.toLowerCase()) {
      text += folded
      origin.push(i)
    }
  }

  return { text, origin }
}

/**
 * Fails closed. `mishears.ts:141` returns the whole source when an index is
 * out of range, which is a degraded evidence quote there but here would be a
 * candidate claiming the doctor said the entire dictation.
 */
const spanOf = (
  normalised: Normalised,
  start: number,
  length: number,
): { start: number; end: number } | null => {
  const first = normalised.origin[start]
  const last = normalised.origin[start + length - 1]
  if (first === undefined || last === undefined) return null
  return { start: first, end: last + 1 }
}

type Token = { readonly text: string; readonly start: number; readonly end: number }

const tokenise = (text: string): Token[] =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))

/**
 * Sound is compared with the spaces removed, spelling with them kept. Word
 * boundaries are exactly what a recogniser invents, so `a zithro my sin` has
 * to reach `azithromycin` phonetically; keeping the spaces on the
 * orthographic side is what stops that leniency spreading to spelling.
 */
const bestSimilarity = (window: string, names: readonly string[]): Similarity =>
  names
    .map((raw) => {
      // The name goes through the same normalisation as the window. Comparing
      // a normalised window against a raw name charged `amoxicillin-clavulanate`
      // an edit for its own hyphen, which was enough to drop it below the
      // plain `amoxicillin` it contains.
      const name = normalise(raw).text
      const phonetic = similarity(window.replaceAll(' ', ''), name.replaceAll(' ', ''))
      const orthographic = similarity(window, name)
      return {
        phonetic: phonetic.phonetic,
        orthographic: orthographic.orthographic,
        score: (phonetic.phonetic + orthographic.orthographic) / 2,
      }
    })
    .reduce((best, next) => (next.score > best.score ? next : best), {
      phonetic: 0,
      orthographic: 0,
      score: 0,
    })

export const matchMedication = (
  text: string,
  profileId?: ProfileId,
): readonly MedicationCandidate[] => {
  const entries = profileId === undefined ? MEDICATION_LEXICON : lexiconFor(profileId)
  const normalised = normalise(text)
  const tokens = tokenise(normalised.text)

  const found: MedicationCandidate[] = []

  for (let i = 0; i < tokens.length; i++) {
    for (let size = 1; size <= MAX_WINDOW_TOKENS && i + size <= tokens.length; size++) {
      const first = tokens[i] as Token
      const last = tokens[i + size - 1] as Token

      // A single word the sig vocabulary owns is never a drug name. Longer
      // windows are allowed through: a split name can straddle one.
      if (size === 1 && (SIG_STOPWORDS.has(first.text) || first.text.length < MIN_TOKEN_LENGTH)) {
        continue
      }

      const window = normalised.text.slice(first.start, last.end)
      const span = spanOf(normalised, first.start, last.end - first.start)
      if (span === null) continue

      for (const entry of entries) {
        const measured = bestSimilarity(window, [entry.generic, ...entry.synonyms])
        if (!admits(measured)) continue

        found.push({
          lexiconId: entry.id,
          generic: entry.generic,
          heard: text.slice(span.start, span.end),
          start: span.start,
          end: span.end,
          score: measured.score,
        })
      }
    }
  }

  // Deterministic: score, then span length, then id, never insertion order.
  // Length matters ahead of id because a combination drug contains a single
  // agent that scores identically on the shorter span. Without it,
  // `amoxicillin-clavulanate` proposes `amoxicillin` first, which is a
  // different antibiotic with a different spectrum.
  found.sort(
    (a, b) =>
      b.score - a.score ||
      b.end - b.start - (a.end - a.start) ||
      a.lexiconId.localeCompare(b.lexiconId),
  )

  const kept: MedicationCandidate[] = []
  for (const candidate of found) {
    const overlapping = kept.filter(
      ({ start, end }) => candidate.start < end && start < candidate.end,
    )
    if (overlapping.length >= MAX_CANDIDATES_PER_SPAN) continue
    if (overlapping.some(({ lexiconId }) => lexiconId === candidate.lexiconId)) continue
    kept.push(candidate)
  }

  return kept
}
