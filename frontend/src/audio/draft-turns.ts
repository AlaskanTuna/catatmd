import type { TranscriptTurn } from '@shared/types'
import type { TranscriptSegment } from './protocol.js'

/**
 * Draft speaker labels from Whisper segment boundaries and punctuation (#118).
 *
 * There is no voice information here: Whisper cannot tell the voices apart,
 * so this reads its segmentation and question marks. The output is a draft
 * the doctor reviews line by line and explicitly applies, never a claim about
 * who actually spoke. That is a safety property, not politeness: a mislabelled
 * doctor-question / patient-denial pair can suppress a red flag the engine
 * would otherwise raise (issue #70), which is why nothing here reaches the
 * transcript until the doctor applies it.
 *
 * One line per Whisper segment, measured rather than assumed (docs/trd.md
 * §20.2): segment timestamps are contiguous partitions that absorb silence,
 * so no inter-segment gap survives to split on, and the boundaries themselves
 * are the split signal. On the reference recording they recovered 10 of 11
 * true speaker handoffs, at the cost of a few extra splits, which downstream
 * handles (two same-speaker turns are fine; a merged two-speaker line is the
 * case the doctor must edit as text).
 */

export type DraftLine = {
  id: string
  speaker: TranscriptTurn['speaker']
  text: string
  offsetSeconds?: number
}

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

/**
 * Guessed speakers, one pass, four ordered rules:
 *   1. the consultation opens with the doctor
 *   2. the line after a question is the patient answering
 *   3. a line that asks a question is the doctor. This re-anchors the
 *      alternation at every question, so a wrong guess propagates only to the
 *      next question instead of to the end of the consultation.
 *   4. otherwise speakers alternate
 * Rule 2 before rule 3, so a reply that itself ends questioning ("Yes, since
 * this morning?") stays the patient's. The known-wrong case is a patient
 * asking their own question, which rule 3 hands to the doctor. Measured at
 * 9 of 17 lines right on the reference recording (docs/trd.md §20.2), which
 * is why these are toggles in a review list, not text already in the
 * transcript.
 */
export function segmentsToDraft(
  segments: readonly TranscriptSegment[],
  fullText: string,
  options: { withOffsets: boolean } = { withOffsets: true },
): DraftLine[] {
  if (!usable(segments, fullText)) return []

  const lines: DraftLine[] = []
  for (const [index, segment] of segments.entries()) {
    const text = normalise(segment.text)
    if (!text) continue
    const previous = lines.at(-1)
    let speaker: TranscriptTurn['speaker']
    if (previous === undefined) speaker = 'doctor'
    else if (endsWithQuestion(previous.text)) speaker = 'patient'
    else if (endsWithQuestion(text)) speaker = 'doctor'
    else speaker = previous.speaker === 'doctor' ? 'patient' : 'doctor'

    const line: DraftLine = { id: `seg-${index}`, speaker, text }
    if (options.withOffsets) line.offsetSeconds = segment.start
    lines.push(line)
  }
  return lines
}

/** Strips draft ids so the applied result is exactly what the transcript stores. */
export function draftToTurns(draft: readonly DraftLine[]): TranscriptTurn[] {
  return draft.map((line) => {
    const turn: TranscriptTurn = { speaker: line.speaker, text: line.text }
    if (line.offsetSeconds !== undefined) turn.offsetSeconds = line.offsetSeconds
    return turn
  })
}
