/**
 * Measured Malay ASR confusables (docs/trd.md §20.3, issue #193). Both
 * measured ASR arms harden the first consonant of Malay clinical words, so
 * the draft review list points at the likely intended word and lets the
 * doctor fix it in one tap. The table is capped at pairs the §20.3 token
 * table actually recorded, never phonetic speculation.
 *
 * Everyday words ("patut", "teman") are allowed here, unlike in
 * backend/src/redflags/triggers.ts, because a doctor reviews and applies
 * every hint, while a trigger acts without review. There is no context gate
 * either: the measured failure "patut sudah empat hari lah" contains no
 * other clinical word, so any cheap gate would hide exactly the case this
 * exists for. A wrong hint costs a glance; a hidden right one costs a wrong
 * transcript.
 */

export type ConfusableHint = {
  /** [start, end) offsets of the flagged token in the text it was found in. */
  start: number
  end: number
  found: string
  suggestion: string
}

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

const matchCase = (suggestion: string, found: string): string =>
  found.charAt(0) === found.charAt(0).toUpperCase()
    ? suggestion.charAt(0).toUpperCase() + suggestion.slice(1)
    : suggestion

/** Whole tokens only: "sepatutnya" never hints, only the bare word does. */
export function findConfusables(text: string): ConfusableHint[] {
  const hints: ConfusableHint[] = []
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const token = match[0]
    const suggestion = CONFUSABLES.get(token.toLowerCase())
    if (suggestion === undefined) continue
    hints.push({
      start: match.index,
      end: match.index + token.length,
      found: token,
      suggestion: matchCase(suggestion, token),
    })
  }
  return hints
}

/**
 * Replaces exactly the hinted token. Total on stale input: if the text under
 * the hint has changed, the text comes back untouched rather than corrupted.
 */
export function applyConfusable(text: string, hint: ConfusableHint): string {
  if (text.slice(hint.start, hint.end) !== hint.found) return text
  return `${text.slice(0, hint.start)}${hint.suggestion}${text.slice(hint.end)}`
}
