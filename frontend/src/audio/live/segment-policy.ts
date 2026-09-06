/*
 * When to cut an ambient stream into one recognisable window, and nothing else.
 * Pure and DOM-free on purpose: the thresholds below are the part worth testing,
 * and the browser wiring that feeds them lives in `use-segment-recorder.ts`.
 */

export type SegmentBounds = {
  floorMs: number
  ceilingMs: number
  /** How long a pause must hold before it counts as an utterance boundary. */
  silenceHoldMs: number
}

/*
 * The window docs/trd.md 20.7 specifies, and configuration rather than
 * constants for a measured reason: 20.9 records that the floor was measured on
 * `qwen3-asr-flash` and "is not known to transfer to a different recogniser".
 * #264 is measuring it on ILMU at 8, 12 and 20 seconds. When that lands it
 * should move these numbers, not this file's shape.
 */
export const DEFAULT_SEGMENT_BOUNDS: SegmentBounds = {
  floorMs: 8_000,
  ceilingMs: 20_000,
  silenceHoldMs: 600,
}

/** Frame RMS below this reads as room tone rather than speech. */
export const DEFAULT_SILENCE_RMS = 0.02

export type SegmentState = {
  elapsedMs: number
  /** Consecutive silence at the end of the window, reset by any speech. */
  silentMs: number
  /** Total speech heard in the window, which never resets. */
  voicedMs: number
}

/*
 * A pause is only allowed to end a window once the floor has passed, because
 * the floor is the expensive threshold: cutting below it cost 23.5 points of
 * Malay word error against 1.5 at eight seconds (docs/trd.md 20.7). The ceiling
 * overrides everything, so a patient who does not pause still gets transcribed.
 */
export function shouldCut(state: SegmentState, bounds: SegmentBounds): boolean {
  if (state.elapsedMs >= bounds.ceilingMs) return true
  return state.elapsedMs >= bounds.floorMs && state.silentMs >= bounds.silenceHoldMs
}

/** A window nobody spoke in, which docs/trd.md 20.7 drops rather than sends. */
export function isSilentThroughout(state: SegmentState): boolean {
  return state.voicedMs === 0
}

/*
 * RMS of one `getByteTimeDomainData` frame, in which 128 is silence and the
 * ends of the byte range are full deflection. Matches how `InputMeter` already
 * reads the same analyser.
 */
export function rmsFromTimeDomain(frame: Uint8Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (const sample of frame) {
    const deviation = (sample - 128) / 128
    sum += deviation * deviation
  }
  return Math.sqrt(sum / frame.length)
}
