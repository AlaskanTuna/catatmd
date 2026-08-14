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

/**
 * How Whisper is chunked, and the numbers the progress count is derived from.
 *
 * These live here rather than inline at the call site because the chunk count
 * has to be predicted on one side and consumed on the other, and two copies of
 * a windowing calculation is how a progress bar starts lying.
 */
export const CHUNK_LENGTH_S = 30
export const STRIDE_LENGTH_S = 5

/**
 * How many times the model will run over an audio of this length.
 *
 * Mirrors the pipeline's own windowing exactly (`_call_whisper`): a window of
 * `CHUNK_LENGTH_S`, overlapping by `STRIDE_LENGTH_S` at each end, so each step
 * advances `window - 2 * stride` rather than a full window. Getting this wrong
 * does not fail loudly, it produces a percentage that finishes early or stalls
 * near the end, which is worse than showing nothing.
 */
export function countChunks(samples: number, sampleRate = TARGET_SAMPLE_RATE): number {
  const window = sampleRate * CHUNK_LENGTH_S
  const jump = window - 2 * (sampleRate * STRIDE_LENGTH_S)
  if (samples <= window) return 1
  return Math.ceil((samples - window) / jump) + 1
}

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready' }
  /**
   * One chunk of audio finished transcribing. `done` counts completed chunks,
   * `total` is fixed for the recording, so `done / total` is real measured
   * progress rather than an animation.
   */
  | { type: 'transcribing'; done: number; total: number }
  /** `segments` empty means no usable timing; callers fall back to plain prose. */
  | { type: 'result'; text: string; segments: readonly TranscriptSegment[] }
  | { type: 'error'; message: string }
