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
 */
export type LiveToken = {
  text: string
  startMs: number
  endMs: number
  isFinal: boolean
  speaker: string | null
  language: string | null
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
 * Groups settled tokens into the segments the rest of the app already speaks.
 *
 * A group closes on an endpoint marker, on a change of speaker, or on a pause
 * longer than `SEGMENT_GAP_MS`. Tokens carry their own leading spaces and
 * Chinese tokens carry none, so they are joined with nothing rather than with a
 * space: inserting one would put gaps inside Chinese words.
 */
export function tokensToSegments(final: readonly LiveToken[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let group: LiveToken[] = []

  const close = () => {
    if (group.length === 0) return
    const text = tidy(group.map((token) => token.text).join(''))
    const first = group[0]
    const last = group[group.length - 1]
    // A group of pure whitespace is dropped rather than emitted: an empty
    // segment would fail the caller's own reconstruction check.
    if (text && first && last) {
      segments.push({ text, start: first.startMs / 1_000, end: last.endMs / 1_000 })
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

/** The unsettled tail, shown muted beneath the settled text. */
export function interimText(interim: readonly LiveToken[]): string {
  return tidy(
    interim
      .filter((token) => !token.endpoint)
      .map((token) => token.text)
      .join(''),
  )
}
