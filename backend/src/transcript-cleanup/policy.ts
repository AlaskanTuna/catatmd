import type { MishearProposal, RedFlag, Transcript } from '@shared/types'

/**
 * What a model edit has to survive before a doctor is ever shown it (#309).
 *
 * **Every control this feature has is in this file**, and none of them is the
 * prompt. `.claude/rules/security.md`: "The control is the response schema, not
 * the prompt wording ... Prompt-level defenses fail silently and do not count as
 * controls." The model-facing schema in `./index.ts` is the first half of that;
 * these rules are the second.
 *
 * Everything here is a pure function over values the caller already has, so the
 * whole policy is testable without a provider, and every rule is a separate
 * test rather than an argument.
 */

/** One correction as the model may express it: two strings and no position. */
export type CleanupEdit = { original: string; replacement: string }

export type PolicyResult = {
  proposals: MishearProposal[]
  /**
   * How many edits were dropped. A count for the audit row, never the words:
   * a dropped edit is still transcript-derived text.
   */
  dropped: number
}

/**
 * The longest `original` an edit may anchor on.
 *
 * A word-level correction is what §20.9 admitted; a long anchor is a sentence
 * rewrite wearing a word's clothes. Sized to hold the longest plausible two-word
 * Malay clinical phrase ("cirit-birit" is 11, "hidung tersumbat" is 16) with
 * room to spare, and nothing like a clause.
 */
const MAX_ORIGINAL_CHARACTERS = 32

/**
 * What a replacement may be made of.
 *
 * Letters and combining marks, plus the apostrophe and hyphen that appear inside
 * real words ("cirit-birit"). One or two words, never more. No digits, because a
 * dose or a temperature is not a mishear this pass may touch; no brackets, which
 * is also what stops a rehydrated vault token being proposed as a word.
 */
const REPLACEMENT = /^\p{L}[\p{L}\p{M}'’-]*(?: \p{L}[\p{L}\p{M}'’-]*)?$/u

/** Words, for the delta bound. Whitespace-separated runs, nothing cleverer. */
const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length

/** Every index at which `needle` occurs in `haystack`, left to right. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  if (needle === '') return found
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    found.push(at)
    at = haystack.indexOf(needle, at + 1)
  }
  return found
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd

/**
 * The spans a fired rule flag matched, per turn, which no model edit may touch.
 *
 * **This is the most important function in the feature.** `evaluateRedFlags`
 * runs over whatever transcript is stored, so a doctor accepting a model edit to
 * a word a rule matched makes the flag stop firing on re-analysis. AGENTS.md:
 * "Do not let the LLM suppress, downgrade, or filter a deterministic red-flag
 * hit." `mergeRedFlags` is untouched and the doctor is the actor, so the
 * invariant is not breached in letter; running the engine here and refusing to
 * offer the edit at all is what keeps it from being one click away.
 *
 * **A flag whose evidence cannot be located protects the whole transcript.** A
 * `RedFlag` carries quoted text and no position (`RedFlagSchema`: `evidence` is
 * a bare string, and `evidenceLink` is audio timing that may never influence a
 * flag), so an evidence span that does not appear in any turn is a span this
 * function cannot reason about. Dropping every model edit is the only answer
 * that cannot be wrong in the dangerous direction.
 */
export function protectedSpans(
  transcript: Transcript,
  ruleFlags: readonly RedFlag[],
): Map<number, [number, number][]> | 'all' {
  const spans = new Map<number, [number, number][]>()

  for (const flag of ruleFlags) {
    const evidence = flag.evidence.trim()
    if (evidence === '') continue

    let located = false
    for (const [turnIndex, turn] of transcript.turns.entries()) {
      for (const at of occurrences(turn.text, evidence)) {
        located = true
        const forTurn = spans.get(turnIndex) ?? []
        forTurn.push([at, at + evidence.length])
        spans.set(turnIndex, forTurn)
      }
    }

    if (!located) return 'all'
  }

  return spans
}

/**
 * Where the recogniser said it was unsure, which is the only place a model edit
 * may land.
 *
 * The confidence gate from PR #322. Without it this pass would be free to
 * rewrite words nothing ever doubted, which is the unconstrained correction
 * arXiv 2407.21414 measured as degrading a transcript rather than improving it.
 * A turn carrying no ranges therefore accepts no model edits at all, including
 * every typed, pasted and relayed transcript, where no confidence exists.
 */
const uncertainIn = (transcript: Transcript, turnIndex: number): readonly [number, number][] =>
  (transcript.turns[turnIndex]?.uncertain ?? []).map((range) => [range.start, range.end] as const)

/**
 * Turns model edits into proposals, dropping silently and counting.
 *
 * Silently because there is nothing useful to say to a doctor about an edit that
 * failed a bound: the alternative is a surface reporting on a model's rejected
 * guesses, which is noise about a process they did not ask to watch. The count
 * reaches the audit row so the drop rate is observable without the words being.
 *
 * `source: 'model'` is stamped here rather than accepted from anywhere, which is
 * the same move `makeSuggestionsAndRedFlagsSchema` makes to stop a model red
 * flag impersonating a rule hit.
 */
export function applyEditPolicy(
  edits: readonly CleanupEdit[],
  transcript: Transcript,
  ruleFlags: readonly RedFlag[],
): PolicyResult {
  const protectedByTurn = protectedSpans(transcript, ruleFlags)
  if (protectedByTurn === 'all') return { proposals: [], dropped: edits.length }

  const proposals: MishearProposal[] = []
  let dropped = 0

  for (const edit of edits) {
    const original = edit.original
    const replacement = edit.replacement

    const wellFormed =
      original !== '' &&
      original.length <= MAX_ORIGINAL_CHARACTERS &&
      original !== replacement &&
      REPLACEMENT.test(replacement) &&
      Math.abs(words(replacement) - words(original)) <= 1

    if (!wellFormed) {
      dropped += 1
      continue
    }

    /*
     * The anchor has to be unique across the whole transcript, not merely within
     * a turn. The model supplies no position, so a word occurring twice leaves
     * nothing to say which one it meant, and correcting the wrong one edits a
     * sentence nobody chose.
     */
    const sites = transcript.turns.flatMap((turn, turnIndex) =>
      occurrences(turn.text, original).map((start) => ({ turnIndex, start })),
    )
    const site = sites.length === 1 ? sites[0] : undefined
    if (site === undefined) {
      dropped += 1
      continue
    }

    const end = site.start + original.length
    const inUncertain = uncertainIn(transcript, site.turnIndex).some(([from, to]) =>
      overlaps(site.start, end, from, to),
    )
    const onFlag = (protectedByTurn.get(site.turnIndex) ?? []).some(([from, to]) =>
      overlaps(site.start, end, from, to),
    )

    if (!inUncertain || onFlag) {
      dropped += 1
      continue
    }

    proposals.push({
      turnIndex: site.turnIndex,
      start: site.start,
      original,
      suggested: replacement,
      source: 'model',
    })
  }

  return { proposals, dropped }
}
