/*
 * When to cut an ambient stream into one recognisable window, and nothing else.
 * Pure and DOM-free on purpose: the thresholds below are the part worth testing,
 * and the browser wiring that feeds them lives in `use-segment-recorder.ts`.
 */

export type SegmentBounds = {
  floorMs: number
  ceilingMs: number
  /**
   * How long a pause must hold before it counts as an utterance boundary.
   *
   * This is the boundary-quality knob, and it errs long deliberately, because
   * the two ways of being wrong are not symmetric. Too long merely defers the
   * cut to the ceiling, and docs/trd.md 20.7 measures longer windows as the
   * cheaper direction. Too short reintroduces the short-window penalty the
   * floor exists to avoid.
   */
  silenceHoldMs: number
}

/*
 * The window docs/trd.md 20.7 specifies, held as configuration rather than
 * constants for a measured reason: 20.9 records that the floor was measured on
 * `qwen3-asr-flash` and "is not known to transfer to a different recogniser".
 * A measurement against the provider actually in use should move these numbers
 * or confirm them, without touching this file's shape.
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
 * A pause may only end a window once the floor has passed, because short
 * windows are the expensive direction: a batch recogniser called once per chunk
 * starts cold each time and loses the surrounding speech it disambiguates with.
 *
 * How expensive is provider-specific, which is the whole reason the floor is a
 * parameter. docs/trd.md 20.7 measured a cliff below it on `qwen3-asr-flash`,
 * and 20.9 records that the result "is not known to transfer to a different
 * recogniser". Do not read that cliff as this system's penalty.
 *
 * The ceiling overrides everything, so a patient who never pauses, or a room
 * whose noise floor hides every pause, still gets transcribed.
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
