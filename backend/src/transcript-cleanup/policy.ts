import { applyMishearProposal, type MishearProposal, type Transcript } from '@shared/types'
import { ALL_REDFLAG_TRIGGERS, evaluateRedFlags } from '../redflags/index.js'

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
 * dose or a temperature is not a mishear this pass may touch.
 *
 * **This is not what stops a negation flip.** `tak`, `tidak` and `tiada` are all
 * ordinary one-word letter strings and pass here; the differential check below
 * is what refuses them, and it refuses them for what they do rather than for
 * how they are spelled.
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

/** The rule ids a transcript raises, evaluated over every trigger there is. */
function firedIds(transcript: Transcript): Set<string> {
  return new Set(
    evaluateRedFlags(transcript, ALL_REDFLAG_TRIGGERS).map((flag) => flag.ruleId ?? flag.id),
  )
}

/**
 * Whether accepting this proposal would take a red flag away.
 *
 * **This is the safety control of the whole feature, and it is differential
 * rather than positional for a reason that took a review to find.** The obvious
 * design protects the evidence span of each fired flag and refuses edits that
 * overlap it. That is not enough, because whether a match becomes a flag depends
 * on text *outside* the span it matched: `isNegated` reads sixty characters
 * before it, `isSafetyNetting` a hundred and twenty, and `asserts` and
 * `findDeniedAbility` read the neighbouring turn entirely.
 *
 * The case that killed the positional version: a patient turn reading "Ada batuk
 * berdarah" raises `haemoptysis` on "batuk berdarah". An edit changing "Ada" to
 * "Tiada" is one word, letters only, zero word delta, and does not touch the
 * protected span, so every positional bound admits it. `tiada` is a Malay
 * negator, so on re-analysis `isNegated` reads it and the emergency flag is
 * gone.
 *
 * So the question asked here is the one that actually matters: run the engine
 * over the transcript this proposal would produce, and refuse it if any rule
 * that fired before does not fire after. `evaluateRedFlags` is pure, which is
 * what makes asking affordable.
 *
 * **Each proposal is judged alone, and that is sufficient.** Two accepted
 * corrections could in principle combine to remove a flag neither removes by
 * itself, but the client refetches proposals against the stored text after every
 * accept, so the second correction is re-judged against a transcript that
 * already contains the first.
 */
function wouldSuppress(
  transcript: Transcript,
  proposal: MishearProposal,
  before: Set<string>,
): boolean {
  if (before.size === 0) return false
  const after = firedIds(applyMishearProposal(transcript, proposal))
  for (const id of before) if (!after.has(id)) return true
  return false
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
 * **The trigger set is not a parameter.** It was one, taking the caller's
 * clinical profile, and that was a hole: `profile.redFlagTriggers` is a filtered
 * slice, the two shipped profiles share one trigger out of twelve, and the
 * profile came from the request body. A caller naming the other profile shrank
 * the protected set. Nothing ties a consultation to the profile it was analysed
 * under, so the only safe answer is every trigger, chosen here where a caller
 * cannot reach it.
 *
 * `source: 'model'` is stamped here rather than accepted from anywhere, which is
 * the same move `makeSuggestionsAndRedFlagsSchema` makes to stop a model red
 * flag impersonating a rule hit.
 */
export function applyEditPolicy(
  edits: readonly CleanupEdit[],
  transcript: Transcript,
): PolicyResult {
  const before = firedIds(transcript)

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
    if (!inUncertain) {
      dropped += 1
      continue
    }

    const proposal: MishearProposal = {
      turnIndex: site.turnIndex,
      start: site.start,
      original,
      suggested: replacement,
      source: 'model',
    }

    // Last, because it is the only rule that costs a pass of the engine.
    if (wouldSuppress(transcript, proposal, before)) {
      dropped += 1
      continue
    }

    proposals.push(proposal)
  }

  return { proposals, dropped }
}
