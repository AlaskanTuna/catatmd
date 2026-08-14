import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerResponse } from './protocol.js'

/**
 * The worker's *message* contract, not its transcription quality.
 *
 * These pin the handshake the component depends on to tell "still loading the
 * model" apart from "transcribing". That distinction was silently broken:
 * `ready` was posted only for an explicit `load` request, nothing in the app
 * ever sends one, and so `AudioCapture`'s `transcribing` phase was unreachable
 * dead code. A long recording spent its entire run claiming to be downloading
 * a model it had already cached, and nothing failed, which is exactly the
 * shape of bug a type checker and a passing suite both wave through.
 */

/**
 * Stands in for the pipeline. `chunkRuns` is how many times it pretends the
 * model ran, which is what drives `streamer.end()` and therefore the progress
 * messages.
 */
let chunkRuns = 1

const asr = vi.fn(async (_audio: unknown, options?: { streamer?: { end: () => void } }) => {
  for (let i = 0; i < chunkRuns; i += 1) options?.streamer?.end()
  return { text: 'hello', chunks: [] } as unknown
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => asr),
  env: {},
  // The real one throws from both methods so subclasses must override, which
  // `ChunkCounter` does. A bare class is enough to stand in for that here.
  BaseStreamer: class {},
}))

let posted: WorkerResponse[]

beforeEach(async () => {
  posted = []
  chunkRuns = 1
  vi.spyOn(self, 'postMessage').mockImplementation(((message: WorkerResponse) => {
    posted.push(message)
  }) as typeof self.postMessage)

  vi.resetModules()
  await import('./transcribe.worker.js')
})

afterEach(() => {
  vi.restoreAllMocks()
  self.onmessage = null
})

/** Drives the worker the way the component does, and waits for it to settle. */
async function transcribe(audio = new Float32Array(16)) {
  self.onmessage?.(new MessageEvent('message', { data: { type: 'transcribe', audio } }))
  await vi.waitFor(() =>
    expect(posted.some((m) => m.type === 'result' || m.type === 'error')).toBe(true),
  )
}

describe('the transcribe path', () => {
  it('announces ready once the model is loaded', async () => {
    await transcribe()

    expect(posted.map((m) => m.type)).toContain('ready')
  })

  it('announces ready before the result, so the caller can leave the loading phase', async () => {
    // Ordering is the whole point. A `ready` posted alongside the result would
    // satisfy the test above and still leave the misleading copy on screen for
    // the entire transcription.
    //
    // Asserted by position rather than by comparing indexes. With the fix
    // reverted, `indexOf('ready')` is -1 and `-1 < 0` passes, so the obvious
    // form of this test is vacuous. That was not hypothetical: it is what the
    // first draft did, and deleting the fix left it green. Here, removing the
    // `ready` post makes the first message `transcribing` and this fails.
    await transcribe()

    expect(posted.at(0)?.type).toBe('ready')
    expect(posted.at(-1)?.type).toBe('result')
  })

  it('reports one progress message per chunk the model runs', async () => {
    const { TARGET_SAMPLE_RATE, countChunks } = await import('./protocol.js')
    const audio = new Float32Array(TARGET_SAMPLE_RATE * 70)
    const total = countChunks(audio.length)
    chunkRuns = total

    await transcribe(audio)

    const ticks = posted.filter((m) => m.type === 'transcribing')

    expect(ticks).toEqual(
      Array.from({ length: total }, (_, i) => ({ type: 'transcribing', done: i + 1, total })),
    )
  })

  it('never reports more chunks done than the total', async () => {
    // The total is a prediction of the pipeline's windowing. If it ever
    // under-counts, the bar should sit at 100% rather than report 3 of 2 and
    // render a width above full.
    chunkRuns = 5

    await transcribe()

    const ticks = posted.flatMap((m) => (m.type === 'transcribing' ? [m] : []))

    expect(ticks.every((t) => t.done <= t.total)).toBe(true)
    expect(ticks.at(-1)).toEqual({ type: 'transcribing', done: 1, total: 1 })
  })

  it('reports a failure as an error rather than a silent stall', async () => {
    asr.mockRejectedValueOnce(new Error('session failed'))

    await transcribe()

    expect(posted.at(-1)).toEqual({ type: 'error', message: 'session failed' })
  })
})
