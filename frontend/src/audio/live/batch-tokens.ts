import type { BatchWord } from './elevenlabs-batch.js'
import { type LiveToken, speakerNumber, tokensToSegments, tokensToText } from './live-tokens.js'

/*
 * What a refined transcript becomes, and what it must pass before it replaces
 * the live one (#436, docs/trd.md §20.14). Pure and DOM-free, like
 * `live-tokens.ts` beside it.
 *
 * **One role mechanism.** The vendor's words are mapped onto the live path's
 * own `LiveToken`, so `tokensToSegments`, `segmentsToDraft`, the labelling pass
 * and `voteRolesBySpeaker` run on a refined transcript exactly as they run on a
 * live one. Nothing here asks the vendor who is the doctor.
 *
 * **Every check fails toward the live transcript.** A refined transcript the
 * doctor never sees costs them nothing they did not have before; a wrong one
 * that replaced a right one is the failure this file exists to stop.
 */

/**
 * The share of words that must carry a speaker. The figure from the
 * pre-registered rule in §20.13, which batch `scribe_v2` passed at 99.9%.
 */
export const MIN_SPEAKER_COVERAGE = 0.95

/**
 * The refined transcript must hold at least this share of the live one's units.
 * **Provisional until the measurement gate** (§20.14): a starting value meant
 * to catch a truncated or empty response, not set from any measurement of how
 * far the two recognisers' lengths drift apart.
 */
export const MIN_REFINED_UNIT_RATIO = 0.8

/**
 * The most units a minute of recording may carry, as a check against invented
 * text. **Provisional until the measurement gate**, and deliberately loose:
 * conversational speech runs well under it, but each Chinese character is a
 * unit, so a fast Mandarin exchange sits closer to it than English does.
 */
export const MAX_REFINED_UNITS_PER_MINUTE = 300

/**
 * How long refinement may take before the live transcript is used:
 * `min(240 s, max(60 s, 30 s + 15 s × minutes))`. **Provisional until the
 * measurement gate.** §20.13 measured 5.6 to 5.7 s of wait per minute of audio,
 * on files of at most 40 s, so the per-minute term carries a wide margin over
 * a figure nothing has yet measured on a long recording.
 */
const REFINEMENT_TIMEOUT_BASE_MS = 30_000
const REFINEMENT_TIMEOUT_PER_MINUTE_MS = 15_000
const REFINEMENT_TIMEOUT_FLOOR_MS = 60_000
const REFINEMENT_TIMEOUT_CEILING_MS = 240_000

export function refinementTimeoutMs(durationSeconds: number): number {
  const scaled =
    REFINEMENT_TIMEOUT_BASE_MS + (REFINEMENT_TIMEOUT_PER_MINUTE_MS * durationSeconds) / 60
  return Math.min(REFINEMENT_TIMEOUT_CEILING_MS, Math.max(REFINEMENT_TIMEOUT_FLOOR_MS, scaled))
}

/** `speaker_0` is shown as speaker 1, as the live path numbers voices from one. */
const VENDOR_SPEAKER = /^speaker_(\d{1,3})$/

const speakerOf = (raw: string | null | undefined): string | null => {
  const match = raw ? VENDOR_SPEAKER.exec(raw) : null
  return match?.[1] === undefined ? null : String(Number(match[1]) + 1)
}

/** Seconds to milliseconds, keeping an absent time absent for the timing row. */
const ms = (seconds: number | null | undefined): number =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds * 1_000) : Number.NaN

/**
 * The vendor's words as live tokens.
 *
 * - **A `spacing` element is folded into the next word**, which keeps its own
 *   timing. Live tokens carry their own leading space, so the joins downstream
 *   are unchanged, and the next word's start, not the spacing's, is what keeps
 *   a long pause visible to the 1500 ms segment backstop.
 * - **`speaker_N` becomes `"N+1"`.** Anything else is an unknown speaker,
 *   never a guess.
 * - **`confidence: null`**, because the response carries none this reads. So a
 *   refined transcript shows no uncertainty underlines, a stated cost.
 * - **Audio events are dropped**, so a cough is never written in as a word.
 */
export function batchWordsToTokens(words: readonly BatchWord[]): LiveToken[] {
  const tokens: LiveToken[] = []
  let pending = ''
  for (const entry of words) {
    if (entry.type === 'audio_event') continue
    if (entry.type === 'spacing') {
      pending += entry.text
      continue
    }
    tokens.push({
      text: pending + entry.text,
      startMs: ms(entry.start),
      endMs: ms(entry.end),
      isFinal: true,
      speaker: speakerOf(entry.speaker_id),
      language: null,
      confidence: null,
      endpoint: false,
    })
    pending = ''
  }
  return tokens
}

const HAN = /\p{Script=Han}/gu
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

/**
 * How much was said, comparably across languages: a word in a spaced script,
 * a character in Chinese, which writes no spaces.
 */
export function units(text: string): number {
  const han = text.match(HAN)?.length ?? 0
  const rest = text
    .replace(HAN, ' ')
    .split(/\s+/u)
    .filter((piece) => HAS_LETTER_OR_NUMBER.test(piece)).length
  return han + rest
}

/**
 * Scripts a recogniser has been measured writing when nobody spoke them.
 * §20.13 finding 3: Tamil returned in Devanagari under automatic language. The
 * gate's `SCRIPT` detector tokenises all three, so a refined transcript in one
 * of them would also arrive at the doctor unreadable to every model.
 */
const FOREIGN_SCRIPTS: readonly RegExp[] = [
  /\p{Script=Bengali}/u,
  /\p{Script=Arabic}/u,
  /\p{Script=Devanagari}/u,
]

export type RefinementFailure =
  | 'no_words'
  | 'speakers_missing'
  | 'speaker_count'
  | 'timing'
  | 'too_short'
  | 'too_dense'
  | 'new_script'

export type RefinementVerdict =
  | { ok: true; tokens: LiveToken[] }
  | { ok: false; reason: RefinementFailure }

/** Voices the live transcript heard, by number, so a reconnect is not a new voice. */
function liveVoices(live: readonly LiveToken[]): number {
  const voices = new Set<string>()
  for (const token of live) {
    if (token.translated === true || token.endpoint || token.speaker === null) continue
    if (token.text.trim() === '') continue
    voices.add(speakerNumber(token.speaker))
  }
  return voices.size
}

/**
 * Whether a refined transcript may replace the live one, short of the server
 * red-flag check, which the caller runs afterwards.
 *
 * The rows, in order. Two more sit outside this function: the vendor replied
 * 2xx with a body the wire schema parsed, which `transcribeRecording` decides
 * before there are any words to judge, and the refinement check finds no lost
 * rule hit, which only the server can run.
 *
 * 1. At least one word.
 * 2. At least `MIN_SPEAKER_COVERAGE` of words carry a speaker.
 * 3. At least `min(2, live voices)` speakers, and never more than two.
 * 4. Every word timed, and starts never run backwards.
 * 5. At least `MIN_REFINED_UNIT_RATIO` of the live transcript's units.
 * 6. At most `MAX_REFINED_UNITS_PER_MINUTE` units a minute of recording.
 * 7. No Bengali, Arabic or Devanagari script the live text lacked.
 */
export function refinementVerdict({
  words,
  live,
  durationSeconds,
}: {
  words: readonly BatchWord[]
  live: readonly LiveToken[]
  durationSeconds: number
}): RefinementVerdict {
  const tokens = batchWordsToTokens(words).filter((token) => token.text.trim() !== '')
  if (tokens.length === 0) return { ok: false, reason: 'no_words' }

  const voiced = tokens.filter((token) => token.speaker !== null)
  if (voiced.length < MIN_SPEAKER_COVERAGE * tokens.length) {
    return { ok: false, reason: 'speakers_missing' }
  }

  const voices = new Set(voiced.map((token) => token.speaker)).size
  if (voices > 2 || voices < Math.min(2, liveVoices(live))) {
    return { ok: false, reason: 'speaker_count' }
  }

  let previous = Number.NEGATIVE_INFINITY
  for (const token of tokens) {
    if (!Number.isFinite(token.startMs) || !Number.isFinite(token.endMs)) {
      return { ok: false, reason: 'timing' }
    }
    if (token.startMs < previous) return { ok: false, reason: 'timing' }
    previous = token.startMs
  }

  const refinedText = tokensToText(tokens)
  const liveText = tokensToText(live)
  const refinedUnits = units(refinedText)
  if (refinedUnits < MIN_REFINED_UNIT_RATIO * units(liveText)) {
    return { ok: false, reason: 'too_short' }
  }

  const minutes = Math.max(durationSeconds, 1) / 60
  if (refinedUnits > MAX_REFINED_UNITS_PER_MINUTE * minutes) {
    return { ok: false, reason: 'too_dense' }
  }

  for (const script of FOREIGN_SCRIPTS) {
    if (script.test(refinedText) && !script.test(liveText)) {
      return { ok: false, reason: 'new_script' }
    }
  }

  return { ok: true, tokens }
}

/**
 * What the server's red-flag check reads for one side: the segment texts the
 * recogniser cut, and nothing else. No speaker travels, because the server
 * sets every field that could weaken the engine itself.
 */
export function refinementCheckTexts(tokens: readonly LiveToken[]): string[] {
  return tokensToSegments(tokens).map((segment) => segment.text)
}
