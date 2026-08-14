/**
 * The worker's message contract, deliberately in its own module.
 *
 * **Nothing here may import `@huggingface/transformers`.** The component needs
 * `TARGET_SAMPLE_RATE` and these types, and importing a *value* from the worker
 * module would pull the worker's import graph into the main bundle with it. It
 * measurably did: the main chunk went from 458 kB to 982 kB, meaning every
 * visitor downloaded the inference library whether or not they ever opened the
 * record tab. Types alone would have been erased, the constant is what dragged
 * it in, and that is an easy mistake to repeat.
 */

/**
 * Whisper's fixed input rate. The caller resamples to this before posting;
 * feeding it anything else does not error, it silently transcribes the wrong
 * pitch and tempo.
 */
export const TARGET_SAMPLE_RATE = 16_000

export type WorkerRequest = { type: 'load' } | { type: 'transcribe'; audio: Float32Array }

/**
 * One Whisper segment. `end` is null when Whisper never closed the final one.
 * Timestamps are contiguous partitions rather than speech extents; silence is
 * absorbed into the earlier segment (docs/trd.md §20.2), so consumers must not
 * expect gaps between segments.
 */
export type TranscriptSegment = { text: string; start: number; end: number | null }

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready' }
  /** `segments` empty means no usable timing; callers fall back to plain prose. */
  | { type: 'result'; text: string; segments: readonly TranscriptSegment[] }
  | { type: 'error'; message: string }
