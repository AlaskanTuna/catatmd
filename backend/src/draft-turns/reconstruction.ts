import type { DraftTurn } from '@shared/types'

/**
 * The verbatim guard: the model's turns are accepted only as boundaries and
 * speaker labels, never as text. Each turn's words are aligned one-for-one
 * against the words of the input the model saw, and the turn's text is then
 * re-sliced from the input itself, so what ships is provably the input's own
 * characters whatever the model returned.
 *
 * This is deliberately stronger than comparing strings. A model asked to
 * split an unpunctuated stream will often add punctuation or casing, which is
 * harmless only if it never reaches the output; re-slicing forgives that
 * drift in the comparison while structurally excluding it from the result.
 * Anything that changes the words themselves, a paraphrase, a dropped or
 * reordered word, a translation, a pseudonym token split in two, fails the
 * alignment and discards the whole draft (docs/trd.md §20.5).
 */

type Span = { start: number; end: number; canon: string }

const WORD = /\S+/g

/**
 * Lowercase, keeping only letters, digits, and the `[ ] _` that vault tokens
 * are built from, so `[PATIENT_1]` survives as one comparable word and a
 * mangled `[PATIENT 1]` becomes two and fails the alignment. An empty result
 * marks a punctuation-only token, which carries no words to align.
 */
const canonWord = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}[\]_]/gu, '')

/** Message is static: on this path a dynamic message could embed model output. */
export class ReconstructionError extends Error {
  constructor() {
    super('The drafted turns do not reconstruct the input')
    this.name = 'ReconstructionError'
  }
}

function spans(text: string): Span[] {
  return [...text.matchAll(WORD)]
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      canon: canonWord(match[0]),
    }))
    .filter((span) => span.canon !== '')
}

export function reconstructTurns(turns: readonly DraftTurn[], input: string): DraftTurn[] {
  const inputSpans = spans(input)

  const turnCanons = turns.map((turn) =>
    (turn.text.match(WORD) ?? []).map(canonWord).filter((canon) => canon !== ''),
  )
  if (turnCanons.some((words) => words.length === 0)) throw new ReconstructionError()

  const flat = turnCanons.flat()
  if (flat.length !== inputSpans.length) throw new ReconstructionError()
  for (const [index, canon] of flat.entries()) {
    if (canon !== inputSpans[index]?.canon) throw new ReconstructionError()
  }

  // Each turn covers the input up to the next turn's first word, so every
  // input character between the first word and the end lands in exactly one
  // turn rather than being dropped at a boundary the model chose.
  const rebuilt: DraftTurn[] = []
  let index = 0
  for (const [turnIndex, turn] of turns.entries()) {
    const first = inputSpans[index]
    index += turnCanons[turnIndex]?.length ?? 0
    const end = index < inputSpans.length ? inputSpans[index]?.start : input.length
    if (first === undefined || end === undefined) throw new ReconstructionError()
    rebuilt.push({ speaker: turn.speaker, text: input.slice(first.start, end).trimEnd() })
  }
  return rebuilt
}
