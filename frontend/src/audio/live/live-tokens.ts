import type { TextRange } from '@shared/types'
import type { TranscriptSegment } from '../protocol.js'

/*
 * What a stream of recognition tokens becomes on screen, and nothing else.
 * Pure and DOM-free on purpose, like `segment-policy.ts` beside it: the
 * grouping rules below are the part worth testing, and the socket wiring that
 * feeds them lives in `soniox-stream.ts`.
 *
 * `TranscriptSegment` is imported as a **type**. Importing a value from the
 * worker's module graph pulls the inference library into the main bundle;
 * `protocol.ts` records the 458 kB to 982 kB measurement that proves it.
 */

/**
 * One recognition token, mapped off the vendor's wire shape.
 *
 * `endpoint` marks an utterance boundary rather than speech. The recogniser
 * emits it as a token with a control-word text, and it must never reach the
 * screen: a doctor reading the live pane would see a stray marker in the middle
 * of a consultation.
 *
 * `confidence` is `null` when the recogniser said nothing about it, which is
 * different from saying it was unsure. Every reader below must test for `null`
 * before comparing, so a stream that carries no confidence produces no cues at
 * all rather than marking every word.
 */
export type LiveToken = {
  text: string
  startMs: number
  endMs: number
  isFinal: boolean
  speaker: string | null
  language: string | null
  confidence: number | null
  endpoint: boolean
}

/**
 * The running transcript, split by how settled it is.
 *
 * `final` only grows: the vendor states a final token is sent once and never
 * repeated, so appending is safe and nothing already on screen is retracted.
 * `interim` is replaced wholesale on every message, because provisional tokens
 * are re-sent in full and change until they settle. Accumulating them instead
 * of replacing them is the obvious bug here, and it produces text that
 * stutters and duplicates as the speaker talks.
 */
export type LiveTranscript = {
  final: readonly LiveToken[]
  interim: readonly LiveToken[]
}

export const EMPTY_LIVE_TRANSCRIPT: LiveTranscript = { final: [], interim: [] }

/**
 * A segment that still knows who was speaking.
 *
 * The recogniser diarises (`speakerDiarization: true` in
 * `backend/src/lib/asr/soniox.ts`) and every token arrives with a speaker, but
 * `tokensToSegments` used that only to decide where to cut and then dropped it.
 * Carrying it is what lets the live view read as a conversation rather than one
 * unbroken block of prose.
 *
 * **It is a speaker, never a role.** The provider says "1" and "2"; it does not
 * know which of them is the doctor. Rendering a guess as "Doctor" would be a
 * clinical claim, and this codebase treats a wrong speaker label as a safety
 * problem rather than a cosmetic one: `asserts()` in
 * `backend/src/redflags/triggers.ts` only reads a question-denial pair when a
 * human has confirmed the labels, precisely because a mislabelled pair can
 * suppress a real escalation trigger. Roles are assigned after Stop, by the
 * existing labelling pass, and reviewed there.
 *
 * `uncertain` marks where the recogniser doubted its own words, as character
 * ranges into this segment's `text` and never as a score for the whole segment:
 * a minimum or a mean tells a doctor that something here is shaky without
 * telling them which word to re-read, which is the only part they can act on.
 * Absent when no token carried a confidence at all.
 *
 * A superset of `TranscriptSegment`, so it is accepted anywhere one is.
 */
export type LiveSegment = TranscriptSegment & {
  speaker: string | null
  uncertain?: readonly TextRange[]
}

/**
 * A silence long enough to read as a new utterance when the recogniser has not
 * said so itself.
 *
 * A backstop rather than the primary boundary: endpoint detection and speaker
 * changes do most of the work. It exists because a segment is the unit the
 * draft-label pass reasons over, and one unbroken block for a whole
 * consultation would give it nothing to work with. It errs long for the reason
 * `segment-policy.ts` gives: a boundary missed is merely a longer line, and a
 * boundary invented splits a sentence.
 */
export const SEGMENT_GAP_MS = 1_500

/**
 * How close two tokens must sit to read as halves of one word.
 *
 * Paired with the script test in `continuesWord`, and both halves are load
 * bearing: text alone would swallow a genuine handoff the recogniser happened
 * not to prefix with a space, and timing alone would merge two people talking
 * over each other. Two speakers cannot swap mid-word with no gap at all, so
 * the pair together only ever describes a diarisation glitch.
 */
const MID_WORD_CONTIGUITY_MS = 200

/**
 * Below this, a token is offered to the doctor as a word worth re-reading.
 *
 * **No measurement in this repo backs this number.** Nothing here has scored
 * Soniox's confidence against a ground-truth transcript in any language, so
 * this is a starting value chosen to mark the visibly shaky words in the
 * captures seen so far and nothing more. docs/trd.md §20.10 already records the
 * provider as unmeasured; this is one more inference on the same pile, and it
 * is stated rather than softened.
 *
 * What settles it is a labelled sample: the threshold that catches most real
 * errors without underlining correct speech. Until then, the cost of it being
 * wrong is bounded by what the cue does, which is nothing except ask a doctor
 * to look. Nothing is gated on it, and the number lives here alone so moving it
 * is a one-line diff rather than a hunt.
 */
export const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.6

/**
 * Whether a cut between these two tokens would land inside a word.
 *
 * The recogniser emits subword units, so "Ya" arrives as "Y" then "a", and its
 * real-time diarisation is documented to show "temporary speaker switches that
 * stabilize as more context is available". When such a switch falls between
 * the halves of a word, the speaker rule below would cut there and put one
 * word across two lines. It is not only ugly: `segmentsToDraft` in
 * `../draft-turns.ts` reads a segment boundary as its primary evidence of a
 * real speaker handoff, so an invented boundary becomes an invented turn.
 *
 * Scoped to Latin script on purpose. Tokens carry their own leading spaces, so
 * a space is what marks a word boundary; Chinese tokens carry none and are
 * each a word of their own, which is why testing for whitespace alone would
 * stop Chinese cutting at all.
 */
const continuesWord = (previous: LiveToken, next: LiveToken): boolean =>
  next.startMs - previous.endMs <= MID_WORD_CONTIGUITY_MS &&
  /[\p{Script=Latin}\p{N}]$/u.test(previous.text) &&
  /^[\p{Script=Latin}\p{N}]/u.test(next.text)

/**
 * Who a group belongs to, measured by how long each speaker held it.
 *
 * Deliberately not the first token. A group may now contain a speaker change
 * that was suppressed for falling inside a word, and a single mis-diarised
 * subword at the head of a turn would otherwise relabel the entire turn, which
 * is exactly how a patient's answer came to be attributed to the doctor.
 *
 * Weighted by duration rather than by token count, so one long word does not
 * lose to several short ones. `null` when no token carried a speaker at all,
 * which is how an undiarised stream stays undiarised rather than gaining a
 * label nothing earned.
 */
function dominantSpeaker(group: readonly LiveToken[]): string | null {
  const held = new Map<string, number>()
  for (const token of group) {
    if (token.speaker === null) continue
    // Floored at one, so a token the recogniser gave no duration still counts
    // for something rather than weighing nothing at all.
    const ms = Math.max(1, token.endMs - token.startMs)
    held.set(token.speaker, (held.get(token.speaker) ?? 0) + ms)
  }

  let dominant: string | null = null
  let longest = 0
  for (const [speaker, ms] of held) {
    if (ms > longest) {
      longest = ms
      dominant = speaker
    }
  }
  return dominant
}

export function absorb(transcript: LiveTranscript, tokens: readonly LiveToken[]): LiveTranscript {
  const settled = tokens.filter((token) => token.isFinal)
  return {
    final: settled.length > 0 ? [...transcript.final, ...settled] : transcript.final,
    interim: tokens.filter((token) => !token.isFinal),
  }
}

/** Whitespace normalisation only. The words themselves are never touched. */
const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The string `tidy` would produce, built alongside where each token landed in
 * it.
 *
 * **Two passes cannot do this.** `tidy` collapses whitespace runs and trims the
 * ends, so a position in the joined tokens is not a position in the tidied
 * text, and the shift is unrecorded. It is also invisible when it goes wrong:
 * Soniox tokens carry their own leading spaces, so a segment cut on a speaker
 * change starts with one, and every offset computed on the raw join lands one
 * character early. The highlight appears on the neighbouring word and nothing
 * throws.
 *
 * So the text and the spans are built in a single walk. A token that
 * contributed nothing but whitespace gets `null` rather than an empty range,
 * because an empty range is a position and this token has none. Separators sit
 * outside every span: a span starts at the first character the token actually
 * emitted.
 *
 * This must stay byte-for-byte what `tidy` returns, because `tokensToText`
 * feeds `segmentsToDraft`, which refuses to label anything that does not
 * reconstruct exactly.
 */
function joinTokens(group: readonly LiveToken[]): {
  text: string
  spans: readonly (TextRange | null)[]
} {
  const spans: (TextRange | null)[] = []
  let text = ''
  let pendingSpace = false

  for (const token of group) {
    let start: number | null = null
    for (const character of token.text) {
      if (/\s/u.test(character)) {
        // Whitespace before the first word is dropped, which is the `trim`.
        // Anything later is held rather than written, so a run collapses to one
        // space and a trailing run is never emitted at all.
        if (text !== '') pendingSpace = true
        continue
      }
      if (pendingSpace) {
        text += ' '
        pendingSpace = false
      }
      if (start === null) start = text.length
      text += character
    }
    spans.push(start === null ? null : { start, end: text.length })
  }

  return { text, spans }
}

/**
 * The spans of a group the recogniser was unsure of, merged into ranges.
 *
 * A token with no confidence is skipped rather than counted as low, so a stream
 * that reports none produces no ranges and the field stays absent.
 *
 * Neighbours are merged across the single space between them, so "sakit tekak"
 * with both words below the threshold reads as one thing to check rather than
 * two. The result is therefore already ordered and non-overlapping, which is
 * what `TranscriptTurnSchema` asserts and what lets a renderer walk it once.
 */
function uncertainRanges(
  group: readonly LiveToken[],
  spans: readonly (TextRange | null)[],
): TextRange[] | undefined {
  const ranges: TextRange[] = []

  for (const [index, token] of group.entries()) {
    const span = spans[index]
    if (!span) continue
    if (token.confidence === null || token.confidence >= UNCERTAIN_CONFIDENCE_THRESHOLD) continue

    const previous = ranges[ranges.length - 1]
    if (previous && span.start <= previous.end + 1) {
      ranges[ranges.length - 1] = { start: previous.start, end: span.end }
      continue
    }
    ranges.push(span)
  }

  return ranges.length > 0 ? ranges : undefined
}

/**
 * Groups settled tokens into the segments the rest of the app already speaks.
 *
 * A group closes on an endpoint marker, on a change of speaker, or on a pause
 * longer than `SEGMENT_GAP_MS`. Tokens carry their own leading spaces and
 * Chinese tokens carry none, so they are joined with nothing rather than with a
 * space: inserting one would put gaps inside Chinese words.
 */
export function tokensToSegments(final: readonly LiveToken[]): LiveSegment[] {
  const segments: LiveSegment[] = []
  let group: LiveToken[] = []

  const close = () => {
    if (group.length === 0) return
    const { text, spans } = joinTokens(group)
    const first = group[0]
    const last = group[group.length - 1]
    // A group of pure whitespace is dropped rather than emitted: an empty
    // segment would fail the caller's own reconstruction check.
    if (text && first && last) {
      const uncertain = uncertainRanges(group, spans)
      // A group is cut on speaker change *except* inside a word, so it can hold
      // a suppressed switch and the first token is not representative of it.
      segments.push({
        text,
        start: first.startMs / 1_000,
        end: last.endMs / 1_000,
        speaker: dominantSpeaker(group),
        ...(uncertain === undefined ? {} : { uncertain }),
      })
    }
    group = []
  }

  for (const token of final) {
    if (token.endpoint) {
      close()
      continue
    }
    const previous = group[group.length - 1]
    if (
      previous &&
      !continuesWord(previous, token) &&
      (token.speaker !== previous.speaker || token.startMs - previous.endMs > SEGMENT_GAP_MS)
    ) {
      close()
    }
    group.push(token)
  }
  close()

  return segments
}

/**
 * The transcript text, derived from the segments rather than from the tokens.
 *
 * Deliberately not an independent join. `segmentsToDraft` in `../draft-turns.ts`
 * refuses to label anything unless the segments reconstruct the text exactly,
 * and two separate joins would drift apart on whitespace and silently drop the
 * caller to unlabelled prose.
 */
export function tokensToText(final: readonly LiveToken[]): string {
  return tokensToSegments(final)
    .map((segment) => segment.text)
    .join(' ')
}

/**
 * Who is speaking the unsettled tail, so it can be shown inside the turn it
 * belongs to rather than as a floating line beneath the conversation.
 *
 * Whoever held most of the tail, for the same reason `close` weighs a group
 * rather than reading its first token: a mis-diarised opening subword would
 * otherwise put the chip on the wrong speaker for the whole unsettled line.
 */
export function interimSpeaker(interim: readonly LiveToken[]): string | null {
  return dominantSpeaker(interim.filter((token) => !token.endpoint))
}

/** The unsettled tail, shown muted beneath the settled text. */
export function interimText(interim: readonly LiveToken[]): string {
  return tidy(
    interim
      .filter((token) => !token.endpoint)
      .map((token) => token.text)
      .join(''),
  )
}
