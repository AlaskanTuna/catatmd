import type { Transcript } from '@shared/types'

/**
 * Measured Malay ASR confusables (docs/trd.md §20.3, issue #193).
 *
 * Both ASR arms that have been measured harden the first consonant of Malay
 * clinical words: "batuk" comes back as "patut", "demam" as "teman", "denggi"
 * as "tenggi". The table is capped at pairs the §20.3 token table actually
 * recorded, never phonetic speculation.
 *
 * **A third recorded source now exists and is not among them.** Ambient capture
 * (#268) streams to a different recogniser whose error family nobody here has
 * measured, and this table still applies to it. That is deliberate rather than
 * an oversight: expansion is additive, so on a provider it was not measured
 * against the worst it can cost is a flag the doctor dismisses, and it can
 * never hide one. What it does not do is prove these triggers fire on that
 * provider's output at all, which stays unmeasured (§20.10).
 *
 * **This used to be a review-time hint in the UI**, offered on a list the doctor
 * confirmed before the transcript existed. That list was removed for the
 * real-time workflow, and with it the only coverage for four of these pairs:
 * `triggers.ts` deliberately does not widen for "teman", "tenggi", "pengkat" or
 * "kekak", and named the hints as what carried them. So the same table now runs
 * here, deterministically, with no doctor in the loop.
 *
 * **Recorded transcripts only.** A typed transcript has no ASR between the
 * doctor and the text, so "teman" there is the everyday word for a companion
 * and expanding it would raise a fever flag on a sentence about someone's
 * friend. The engine's own reason for refusing to widen is exactly that
 * over-fire, and it is only acceptable where a mishear is actually possible.
 *
 * The accepted cost on a recording is real and one-directional: "pergi dengan
 * teman" now raises a fever flag the doctor dismisses. A spurious flag costs one
 * dismissal; the missed one it replaces cost an urgent trigger on a Malay UTI
 * consultation.
 */
const CONFUSABLES: ReadonlyMap<string, string> = new Map([
  ['patut', 'batuk'],
  ['patuk', 'batuk'],
  ['teman', 'demam'],
  ['tenggi', 'denggi'],
  ['tanggi', 'denggi'],
  ['sempuk', 'semput'],
  ['pengkat', 'bengkak'],
  ['penkak', 'bengkak'],
  ['kekak', 'tekak'],
  ['tongso', 'tonsil'],
  ['tongsel', 'tonsil'],
])

/** Whole tokens only: "sepatutnya" is never expanded, only the bare word is. */
const TOKEN = /[\p{L}]+/gu

/**
 * A turn's text with every measured mishear replaced, plus the index map back.
 *
 * The map is what keeps the evidence trace honest. Two pairs change length
 * ("penkak" to "bengkak", "tongsel" to "tonsil"), so an offset in the expanded
 * text is not an offset in the original, and a flag that quoted the expansion
 * would show the doctor a word nobody said. `origin[i]` is the index in the
 * original text that expanded character `i` came from, so a matched span can be
 * cut from the original and quoted verbatim.
 */
export type Expansion = { text: string; origin: number[] }

export const expandMishears = (text: string): Expansion | null => {
  let out = ''
  const origin: number[] = []
  let cursor = 0
  let changed = false

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index
    const word = match[0]
    const replacement = CONFUSABLES.get(word.toLowerCase())

    for (let i = cursor; i < start; i++) {
      out += text[i]
      origin.push(i)
    }

    if (replacement === undefined) {
      for (let i = 0; i < word.length; i++) {
        out += word[i]
        origin.push(start + i)
      }
    } else {
      changed = true
      const cased =
        word.charAt(0) === word.charAt(0).toUpperCase()
          ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
          : replacement
      /*
       * Character `i` of the replacement points at character `i` of the word it
       * replaced, clamped to that word's last character when the replacement is
       * the longer of the two ("penkak" becomes "bengkak"). Clamping keeps the
       * map monotonic, so a span cut from the first and last mapped indexes is
       * the whole original token rather than a fragment of it.
       */
      for (const [i, character] of [...cased].entries()) {
        out += character
        origin.push(start + Math.min(i, word.length - 1))
      }
    }
    cursor = start + word.length
  }

  for (let i = cursor; i < text.length; i++) {
    out += text[i]
    origin.push(i)
  }

  return changed ? { text: out, origin } : null
}

/**
 * Whether this transcript's words passed through speech recognition, and so
 * whether a measured mishear is possible in them at all.
 */
export const isRecorded = (transcript: Transcript): boolean =>
  transcript.source === 'asr_local' ||
  transcript.source === 'asr_hosted' ||
  transcript.source === 'asr_live'

/**
 * The original span a match on the expanded text corresponds to.
 *
 * Cut from the source rather than returned from the expansion, so the flag
 * quotes what the transcript actually says. A doctor reading "teman dua hari"
 * in the evidence trace can see why the flag fired and judge it; one reading
 * "demam dua hari" would be reading a sentence that is not in the record.
 */
export const originalSpan = (
  source: string,
  expansion: Expansion,
  start: number,
  length: number,
): string => {
  const first = expansion.origin[start]
  const last = expansion.origin[start + length - 1]
  if (first === undefined || last === undefined) return source
  return source.slice(first, last + 1)
}
