import type { TranscriptTurn } from '@shared/types'
import type { TranscriptSegment } from './protocol.js'

/**
 * Draft speaker labels from Whisper segment boundaries and sentence content
 * (#118; revised after the segment-level rules measured 9 of 17 lines on the
 * reference recording, docs/trd.md §20.2).
 *
 * There is still no voice information here: Whisper cannot tell the voices
 * apart, so this reads its segmentation and what each sentence says. The
 * output is a draft the doctor reviews line by line and explicitly applies,
 * never a claim about who actually spoke. That is a safety property, not
 * politeness: a mislabelled doctor-question / patient-denial pair can
 * suppress a red flag the engine would otherwise raise (issue #70), which is
 * why nothing here reaches the transcript until the doctor applies it.
 *
 * Two measured v1 failure modes drive this shape (docs/trd.md §20.2):
 * a speaker handoff inside one segment was invisible while labels were per
 * segment, so segments are now split at sentence boundaries and every
 * sentence is scored on its own; and blind alternation flipped labels on
 * same-speaker continuations, so a sentence with no content signal now stays
 * with the previous speaker instead of alternating away from it.
 *
 * Segment boundaries stay the primary split signal: on the reference
 * recording they recovered 10 of 11 true speaker handoffs. Sentence splitting
 * only adds the split v1 could not make, inside a segment.
 */

export type DraftLine = {
  id: string
  speaker: TranscriptTurn['speaker']
  text: string
  offsetSeconds?: number
  /** Where this line's audio ends, when the segment it came from was closed. */
  endSeconds?: number
  /**
   * Set when the server labelled the rest of the transcript but not this span,
   * so `speaker` is a placeholder rather than a guess with anything behind it.
   * The review list marks these instead of showing them as drafted.
   */
  undrafted?: boolean
}

type Speaker = TranscriptTurn['speaker']

const endsWithQuestion = (text: string): boolean => /\?\s*$/.test(text.trim())

const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Segments are advisory, text is authoritative: if the segments do not
 * faithfully reconstruct the transcription they claim to describe, the caller
 * falls back to unlabelled prose rather than risking drafted labels over
 * silently reordered or dropped clinical content.
 */
function usable(segments: readonly TranscriptSegment[], fullText: string): boolean {
  if (segments.length === 0) return false
  let previousStart = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    if (!Number.isFinite(segment.start) || segment.start < previousStart) return false
    if (segment.end !== null && !Number.isFinite(segment.end)) return false
    previousStart = segment.start
  }
  return normalise(segments.map((s) => s.text).join(' ')) === normalise(fullText)
}

const SENTENCE_BOUNDARY = /([.!?]+)\s+(?=[A-Z0-9"'])/g
const ABBREVIATION = /\b(?:dr|mr|mrs|ms|e\.g|i\.e|etc|vs)\.$/i

/**
 * The same text-is-authoritative stance as `usable()`, one level down: a
 * boundary after a title Whisper writes ("Dr.") is not a split, and if the
 * pieces do not reconstruct the input exactly, the split is discarded and the
 * sentence stays whole rather than risking reshaped clinical content.
 */
function splitSentences(text: string): string[] {
  const pieces: string[] = []
  let start = 0
  for (const match of text.matchAll(SENTENCE_BOUNDARY)) {
    const end = match.index + (match[1]?.length ?? 0)
    if (ABBREVIATION.test(text.slice(start, end))) continue
    pieces.push(text.slice(start, end).trim())
    start = end
  }
  pieces.push(text.slice(start).trim())
  const kept = pieces.filter(Boolean)
  return normalise(kept.join(' ')) === text ? kept : [text]
}

/*
 * Content signals, not a language model: small pattern tables over what a GP
 * sentence says. Doctor patterns are speech directed at the patient
 * (questions, instructions, examination); patient patterns are first-person
 * experience and addressing the doctor. The tables are English-only, so
 * heavy code-switching degrades v2 toward the context rules below; that
 * limit is recorded in docs/trd.md §20.2 rather than hidden.
 */
const DOCTOR_PATTERNS: readonly RegExp[] = [
  /\b(?:what brings you|how are you|how long (?:have|has)|how about|what about|any (?:fever|chills|pain|cough|phlegm|blood|rash|runny nose|sore throat|allerg|difficulty|shortness|vomiting|nausea|other)\w*|have you|do you|are you|did you|were you|when did|does it|is there any)\b/i,
  /\b(?:let me|i(?:'ll| will) (?:prescribe|give|write|refer|order|check|listen)|i (?:recommend|suggest)|you should|you need to|take (?:this|these|the|it|one|two)|open your|say ah|breathe|deep breath|come back|see me if)\b/i,
  /\byour (?:throat|tonsils|lungs|chest|breathing|temperature|blood pressure|heart|ears?|nose)\b/i,
]

const PATIENT_PATTERNS: readonly RegExp[] = [
  // Vocative "doctor", leading or trailing. Not "dr", which is a written
  // title ("Dr. Tan"), and not "the/a doctor", which is a reference.
  /^(?:doctor|doc)\b[,.!?\s]/i,
  /(?<!\b(?:the|a))[\s,](?:doctor|doc)[.!?]*$/i,
  /\b(?:i(?:'ve| have)(?: been| got| had)?|i (?:feel|felt|keep|kept|noticed|started|took|ate|drank|slept|vomited|coughed)|i (?:can't|cannot|couldn't|didn't|don't|haven't)|i(?:'m| am| was)(?: still)?(?: not)? (?:cough|vomit|feel|having|getting|hurt|dizzy|tired|breathless|worried)\w*)\b/i,
  // Asking about one's own care. "can I" is deliberately absent: a doctor
  // says "can I take a look", so it is not a patient signal.
  /\b(?:do|does|should|will|would|am|must)\s+i\b|\bi (?:should|need to|have to)\b/i,
  /\bmy (?:throat|chest|head|nose|ears?|eyes?|stomach|tummy|neck|back|body|voice|cough|fever|phlegm|wife|husband|son|daughter|mother|father|kids?|children)\b/i,
  /\bit (?:hurts|hurt|started|comes and goes)\b/i,
]

const matches = (patterns: readonly RegExp[], text: string): number =>
  patterns.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0)

/**
 * Content first, context only on a tie, and the context rules keep v1's
 * ordering rationale: the answer to a question outranks a sentence's own
 * trailing question mark, so "Yes, since this morning?" stays the patient's;
 * a content-free question falls to the doctor as the last resort; and a
 * sentence with no signal at all continues the previous speaker, replacing
 * v1's alternation, whose flips on same-speaker continuations were its
 * largest measured failure mode.
 */
function classify(
  sentence: string,
  previous: { speaker: Speaker; text: string } | undefined,
): Speaker {
  const doctor = matches(DOCTOR_PATTERNS, sentence)
  const patient = matches(PATIENT_PATTERNS, sentence)
  if (doctor !== patient) return doctor > patient ? 'doctor' : 'patient'
  if (previous === undefined) return 'doctor'
  if (endsWithQuestion(previous.text)) return previous.speaker === 'doctor' ? 'patient' : 'doctor'
  if (endsWithQuestion(sentence)) return 'doctor'
  return previous.speaker
}

/**
 * The same rules applied to prose alone, for a transcript that arrives with no
 * timing and no server-drafted labels.
 *
 * That is the hosted path whenever the labelling pass does not return: the
 * relay sends no segments, so `segmentsToDraft` refuses at its first line, and
 * the doctor was left holding an unlabelled block that `parseTranscript` reads
 * as zero turns. Start Consultation is disabled on exactly that condition, so
 * the documented "falls back to the unlabelled prose" was in practice a dead
 * end: the recording succeeded, was billed, and could not be used.
 *
 * A guess the doctor corrects is the right floor here, because it is already
 * what the labelled path produces. Both drafts land in the same review step
 * with the same per-line flip and swap-all, and neither is a claim about who
 * spoke until the doctor applies it.
 *
 * No offsets, ever. Prose carries no timing, and inventing one would assert a
 * wrong time in the evidence trace, which is the rule the split-line branch of
 * `segmentsToDraft` already follows.
 */
export function proseToDraft(fullText: string): DraftLine[] {
  const text = normalise(fullText)
  if (text === '') return []

  const lines: DraftLine[] = []
  let previous: { speaker: Speaker; text: string } | undefined
  for (const sentence of splitSentences(text)) {
    const speaker = classify(sentence, previous)
    previous = { speaker, text: sentence }
    const last = lines.at(-1)
    if (last && last.speaker === speaker) last.text = `${last.text} ${sentence}`
    else lines.push({ id: `prose-${lines.length}`, speaker, text: sentence })
  }
  return lines
}

export function segmentsToDraft(
  segments: readonly TranscriptSegment[],
  fullText: string,
  options: { withOffsets: boolean } = { withOffsets: true },
): DraftLine[] {
  if (!usable(segments, fullText)) return []

  const lines: DraftLine[] = []
  let previous: { speaker: Speaker; text: string } | undefined
  for (const [index, segment] of segments.entries()) {
    const text = normalise(segment.text)
    if (!text) continue

    // Consecutive same-speaker sentences merge back into one line, so the
    // split costs a review line only where the guessed speaker changes.
    const groups: { speaker: Speaker; text: string }[] = []
    for (const sentence of splitSentences(text)) {
      const speaker = classify(sentence, previous)
      previous = { speaker, text: sentence }
      const last = groups.at(-1)
      if (last && last.speaker === speaker) last.text = `${last.text} ${sentence}`
      else groups.push({ speaker, text: sentence })
    }

    for (const [part, group] of groups.entries()) {
      const line: DraftLine = {
        id: part === 0 ? `seg-${index}` : `seg-${index}-${part}`,
        speaker: group.speaker,
        text: group.text,
      }
      // Only the line that opens a segment carries its start time: a split
      // line's true offset inside the segment is unknown, and a fabricated
      // one would assert a wrong time in the evidence trace.
      //
      // The end time rides on the same condition and adds one of its own.
      // Whisper leaves the final segment open (`end` null), and a segment that
      // never closed cannot say where its audio stops; playback falls back to
      // running to the end of the recording, which is true, rather than to a
      // guessed duration, which would not be.
      if (options.withOffsets && part === 0) {
        line.offsetSeconds = segment.start
        if (segment.end !== null) line.endSeconds = segment.end
      }
      lines.push(line)
    }
  }
  return lines
}

/** Strips draft ids so the applied result is exactly what the transcript stores. */
export function draftToTurns(draft: readonly DraftLine[]): TranscriptTurn[] {
  return draft.map((line) => {
    const turn: TranscriptTurn = { speaker: line.speaker, text: line.text }
    if (line.offsetSeconds !== undefined) turn.offsetSeconds = line.offsetSeconds
    // Never without a start. An end alone cannot be seeked to, and the pair is
    // what `TranscriptTurnSchema` orders against.
    if (line.offsetSeconds !== undefined && line.endSeconds !== undefined) {
      turn.endSeconds = line.endSeconds
    }
    return turn
  })
}

/**
 * Puts the timing a live capture already measured back onto the turns the
 * labelling pass drafted (#293).
 *
 * The ambient path has both halves and was throwing one away. Soniox reports a
 * start and end per token, which `tokensToSegments` groups into segments; the
 * labelling pass then re-splits the same words into better turns and returns
 * text alone. Preferring those labels meant discarding real measured timing,
 * so the settled transcript carried none and nothing could be played back.
 *
 * The two agree on the words, because the labelling pass re-slices every turn
 * from its input rather than rewriting it (`backend/src/draft-turns/`), so a
 * forward scan over the concatenated segments locates each turn in order. A
 * turn takes the start of the first segment it touches and the end of the last.
 *
 * **A turn that cannot be located gets no timing at all.** That is the same
 * rule `segmentsToDraft` applies to split lines, and it matters more here: a
 * wrong offset would play the doctor a different sentence from the one they
 * clicked, which either casts doubt on a correct transcription or confirms an
 * incorrect one.
 */
export function timeDraftLines(
  lines: readonly DraftLine[],
  segments: readonly TranscriptSegment[],
): DraftLine[] {
  if (segments.length === 0) return [...lines]

  // One haystack, plus the segment each character belongs to. Built once:
  // per-line rescanning would be quadratic on a long consultation.
  let haystack = ''
  const owner: number[] = []
  for (const [index, segment] of segments.entries()) {
    const text = normalise(segment.text)
    if (text === '') continue
    if (haystack !== '') {
      haystack += ' '
      owner.push(index)
    }
    haystack += text
    for (let i = 0; i < text.length; i += 1) owner.push(index)
  }
  const hay = haystack.toLowerCase()

  let cursor = 0
  return lines.map((line) => {
    const needle = normalise(line.text).toLowerCase()
    if (needle === '') return line
    const at = hay.indexOf(needle, cursor)
    if (at === -1) return line
    cursor = at + needle.length

    const first = segments[owner[at] ?? -1]
    const last = segments[owner[cursor - 1] ?? -1]
    if (first === undefined || last === undefined) return line

    const timed: DraftLine = { ...line, offsetSeconds: first.start }
    if (last.end !== null) timed.endSeconds = last.end
    return timed
  })
}
