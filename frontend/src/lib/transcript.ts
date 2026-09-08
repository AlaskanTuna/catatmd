import type { TranscriptTurn } from '@shared/types'

/**
 * One parser for every input path (#2), moved out of ConsultationNew for #118.
 *
 * Fixture, paste, upload and record all land in the same textarea and go
 * through this one `Doctor:` / `Patient:` line parser. Keeping one parser is
 * what stops the paths drifting: a bug fixed for upload is fixed for all four,
 * and the doctor can always see and correct exactly what will be submitted.
 *
 * A line may carry an optional inline timestamp, `Doctor [0:04]: text` or
 * `Doctor [0:04-0:09]: text`, parsed into `offsetSeconds` and `endSeconds`.
 * It is how timing survives the textarea being the single editing surface:
 * `serialiseTurns` writes it, edits leave it visible and deletable, and this
 * parser reads it back.
 *
 * The end is what lets playback stop at the end of the sentence the doctor
 * clicked (#293). It is optional on its own, because a source can know where a
 * turn starts without knowing where it ends: Whisper never closes its final
 * segment.
 */
const TURN_LINE =
  /^\s*(doctor|patient)\s*(?:\[(\d+):([0-5]\d)(?:\s*-\s*(\d+):([0-5]\d))?\])?\s*:\s*(.+)$/i

export function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    const match = TURN_LINE.exec(line)
    if (match?.[1] && match[6]?.trim()) {
      const turn: TranscriptTurn = {
        speaker: match[1].toLowerCase() === 'doctor' ? 'doctor' : 'patient',
        text: match[6].trim(),
      }
      if (match[2] && match[3]) {
        turn.offsetSeconds = Number(match[2]) * 60 + Number(match[3])
        // Only ever alongside a start, and only when it does not precede it:
        // a hand-edited `[0:30-0:10]` is a typo, not an instruction to play
        // backwards, and `TranscriptTurnSchema` would reject the pair anyway.
        if (match[4] && match[5]) {
          const end = Number(match[4]) * 60 + Number(match[5])
          if (end >= turn.offsetSeconds) turn.endSeconds = end
        }
      }
      turns.push(turn)
      continue
    }
    // A continuation line belongs to the turn above it rather than being
    // dropped: pasted transcripts wrap, and silently losing a wrapped clause
    // would lose clinical content.
    const previous = turns.at(-1)
    if (previous && line.trim()) previous.text = `${previous.text} ${line.trim()}`
  }
  return turns
}

/** The inverse of `parseTranscript`, used by every path that pre-fills the textarea. */
export function serialiseTurns(turns: readonly TranscriptTurn[]): string {
  /*
   * The start floors and the end ceils, so a whole-second stamp never names a
   * window narrower than the audio it stands for. Rounding both the same way
   * would clip up to a second off one end, and the word it clips is the one at
   * the boundary the doctor is most likely to be checking.
   */
  const clock = (seconds: number): string =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

  return turns
    .map((turn) => {
      const label = turn.speaker === 'doctor' ? 'Doctor' : 'Patient'
      const offset = turn.offsetSeconds
      const end = turn.endSeconds
      const stamp =
        offset === undefined
          ? ''
          : end === undefined
            ? ` [${clock(Math.floor(offset))}]`
            : ` [${clock(Math.floor(offset))}-${clock(Math.ceil(end))}]`
      return `${label}${stamp}: ${turn.text}`
    })
    .join('\n')
}
