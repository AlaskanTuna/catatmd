import type { TranscriptTurn } from '@shared/types'

/**
 * One parser for every input path (#2), moved out of ConsultationNew for #118.
 *
 * Fixture, paste, upload and record all land in the same textarea and go
 * through this one `Doctor:` / `Patient:` line parser. Keeping one parser is
 * what stops the paths drifting: a bug fixed for upload is fixed for all four,
 * and the doctor can always see and correct exactly what will be submitted.
 *
 * A line may carry an optional inline timestamp, `Doctor [0:04]: text`,
 * parsed into `offsetSeconds`. It is how timing survives the textarea being
 * the single editing surface: `serialiseTurns` writes it, edits leave it
 * visible and deletable, and this parser reads it back.
 */
const TURN_LINE = /^\s*(doctor|patient)\s*(?:\[(\d+):([0-5]\d)\])?\s*:\s*(.+)$/i

export function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    const match = TURN_LINE.exec(line)
    if (match?.[1] && match[4]?.trim()) {
      const turn: TranscriptTurn = {
        speaker: match[1].toLowerCase() === 'doctor' ? 'doctor' : 'patient',
        text: match[4].trim(),
      }
      if (match[2] && match[3]) {
        turn.offsetSeconds = Number(match[2]) * 60 + Number(match[3])
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
  return turns
    .map((turn) => {
      const label = turn.speaker === 'doctor' ? 'Doctor' : 'Patient'
      const offset = turn.offsetSeconds
      const stamp =
        offset === undefined
          ? ''
          : ` [${Math.floor(offset / 60)}:${String(Math.floor(offset % 60)).padStart(2, '0')}]`
      return `${label}${stamp}: ${turn.text}`
    })
    .join('\n')
}
