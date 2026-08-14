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

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready' }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
