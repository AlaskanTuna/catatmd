import { LIVE_DELTA_LOOKBACK_SEGMENTS, type RedFlag, type TranscriptTurn } from '@shared/types'
import { draftToTurns, segmentsToDraft } from '../draft-turns.js'
import type { TranscriptSegment } from '../protocol.js'

/*
 * Turning a growing live transcript into bounded windows, and merging what
 * comes back so nothing already on screen is retracted (#219).
 *
 * Pure and DOM-free like `live-tokens.ts` beside it. `TranscriptSegment` is a
 * **type** import and `draft-turns.js` carries only type imports of its own, so
 * nothing here drags the inference library into the main bundle; see
 * `protocol.ts` for the measurement behind that rule.
 */

/**
 * The segments that will not change again.
 *
 * `tokensToSegments` closes the trailing group at the end of every pass, so the
 * last segment it returns is provisional: the next token may extend it rather
 * than start a new one. Treating it as open costs one segment of latency and is
 * the safe direction, because a window built on a segment that later grows
 * would analyse text the doctor never finished saying.
 */
export function closedSegments(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  return segments.slice(0, -1)
}

/**
 * The window to send: everything closed but not yet sent, plus the lookback.
 *
 * The lookback repeats `LIVE_DELTA_LOOKBACK_SEGMENTS` already-sent segments,
 * which is the one place this design knowingly resends. It is a clinical
 * requirement rather than a hedge: see the constant's own comment and
 * `backend/src/redflags/live-window.test.ts`, which fails without it.
 */
export function deltaFor(
  closed: readonly TranscriptSegment[],
  committed: number,
): TranscriptSegment[] {
  if (closed.length <= committed) return []
  return closed.slice(Math.max(0, committed - LIVE_DELTA_LOOKBACK_SEGMENTS))
}

/**
 * Segments to the turn shape the API speaks.
 *
 * Reuses the shipped labelling path rather than a second one. `segmentsToDraft`
 * refuses to label unless the segments reconstruct the text exactly, so the
 * text is joined from those same segments, exactly as `tokensToText` does.
 */
export function segmentsToDelta(segments: readonly TranscriptSegment[]): TranscriptTurn[] {
  const text = segments.map((segment) => segment.text).join(' ')
  return draftToTurns(segmentsToDraft(segments, text, { withOffsets: true }))
}

/*
 * There is deliberately no fact-merging here. The API returns state that is
 * already folded (`foldFacts` in `backend/src/analysis/live.ts`) and the client
 * hands it straight back on the next cycle, so a second implementation would be
 * dead code today and a drift risk tomorrow, on a rule that decides whether an
 * established finding can disappear from the screen.
 */

/**
 * Insert-only merge on `id`.
 *
 * Two reasons a flag can arrive twice: the lookback resends a segment, and the
 * Finish pass re-raises everything the live pass already showed. Neither is a
 * reason to remove one, so this only ever grows.
 *
 * Note where this does *not* live. `mergeRedFlags` on the API stays a pure
 * concat with no filter, dedupe or sort, because that function is the safety
 * invariant; de-duplicating for display is the caller's job and belongs here.
 */
export function mergeFlags(shown: readonly RedFlag[], incoming: readonly RedFlag[]): RedFlag[] {
  const byId = new Map(shown.map((flag) => [flag.id, flag]))
  for (const flag of incoming) {
    if (!byId.has(flag.id)) byId.set(flag.id, flag)
  }
  return [...byId.values()]
}

/**
 * The render-path guard: refuse anything that is not an extension of what the
 * doctor has already read.
 *
 * Belt and braces behind the server's own monotone fold. docs/trd.md §20.8.1
 * measures full rewriting at 13.8 Normalized Erasure against zero for a forced
 * prefix, and a doctor reading mid-sentence should never watch a line vanish,
 * so a payload that would retract one is dropped rather than rendered.
 */
export function appendOnly(previous: readonly string[], incoming: readonly string[]): string[] {
  if (incoming.length < previous.length) return [...previous]
  const extends_ = previous.every((line, index) => incoming[index] === line)
  return extends_ ? [...incoming] : [...previous]
}
