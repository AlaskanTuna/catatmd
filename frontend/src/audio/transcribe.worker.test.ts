import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HEARTBEAT_TOKENS, type WorkerResponse } from './protocol.js'

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
 * messages. `tokensPerChunk` drives `streamer.put()` before each `end()`, the
 * way `generate()` calls it once per decoding step, which is what the alive
 * heartbeat rides on.
 */
let chunkRuns = 1
let tokensPerChunk = 0

const asr = vi.fn(
  async (
    _audio: unknown,
    options?: { streamer?: { put: (value: unknown) => void; end: () => void } },
  ) => {
    for (let i = 0; i < chunkRuns; i += 1) {
      for (let t = 0; t < tokensPerChunk; t += 1) options?.streamer?.put([[0]])
      options?.streamer?.end()
    }
    return { text: 'hello', chunks: [] } as unknown
  },
)

/** Download events the pipeline replays into `progress_callback` while loading. */
let progressEvents: unknown[] = []

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(
    async (
      _task: unknown,
      _model: unknown,
      options?: { progress_callback?: (event: unknown) => void },
    ) => {
      for (const event of progressEvents) options?.progress_callback?.(event)
      return asr
    },
  ),
  env: {},
  // The real one throws from both methods so subclasses must override, which
  // `ChunkCounter` does. A bare class is enough to stand in for that here.
  // Deliberately no `WhisperTextStreamer` or `TextStreamer` export: outside
  // Node those default `callback_function` to `console.log` of decoded text,
  // so a swap toward them should fail loudly here before it can ever log a
  // transcript.
  BaseStreamer: class {},
}))

let posted: WorkerResponse[]

beforeEach(async () => {
  posted = []
  chunkRuns = 1
  tokensPerChunk = 0
  progressEvents = []
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

describe('download progress', () => {
  it('forwards only the aggregate figure, never per-file bytes', async () => {
    // Per-file events drive a bar to 100 once per artefact and reset it for
    // the next. The aggregate event's denominator covers every expected file
    // from the first event, so it is the only one worth forwarding.
    progressEvents = [
      { status: 'progress', file: 'encoder.onnx', loaded: 10, total: 100 },
      { status: 'progress_total', loaded: 10, total: 500 },
      { status: 'progress', file: 'decoder.onnx', loaded: 90, total: 400 },
      { status: 'progress_total', loaded: 100, total: 500 },
      { status: 'done', file: 'encoder.onnx' },
    ]

    await transcribe()

    expect(posted.filter((m) => m.type === 'progress')).toEqual([
      { type: 'progress', loaded: 10, total: 500 },
      { type: 'progress', loaded: 100, total: 500 },
    ])
  })

  it('still posts when the host reports no sizes, as a zero-total heartbeat', async () => {
    // A mirror without content-length gives no denominator. The message still
    // matters: it rearms the caller's silence budget even when it cannot
    // render as a percentage.
    progressEvents = [{ status: 'progress_total', loaded: 42, total: 0 }]

    await transcribe()

    expect(posted.filter((m) => m.type === 'progress')).toEqual([
      { type: 'progress', loaded: 42, total: 0 },
    ])
  })
})

describe('liveness', () => {
  it('posts alive on the token cadence', async () => {
    tokensPerChunk = HEARTBEAT_TOKENS * 2 + 1

    await transcribe()

    expect(posted.filter((m) => m.type === 'alive')).toHaveLength(2)
  })

  it('posts no alive for a chunk under the heartbeat interval', async () => {
    tokensPerChunk = HEARTBEAT_TOKENS - 1

    await transcribe()

    expect(posted.filter((m) => m.type === 'alive')).toHaveLength(0)
  })

  it('never writes to the console while decoding', async () => {
    // `WhisperTextStreamer` and `TextStreamer` default `callback_function` to
    // `console.log` outside Node, which would print decoded consultation text.
    // AGENTS.md bans logging transcript bodies, so the streamer must stay a
    // `BaseStreamer` subclass that decodes nothing and logs nothing.
    const spies = (['log', 'info', 'warn', 'error'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    )
    tokensPerChunk = 20

    await transcribe()

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('the finishing signal', () => {
  it('is posted exactly once, after the last chunk tick and before the result', async () => {
    const { TARGET_SAMPLE_RATE, countChunks } = await import('./protocol.js')
    const audio = new Float32Array(TARGET_SAMPLE_RATE * 70)
    chunkRuns = countChunks(audio.length)

    await transcribe(audio)

    const types = posted.map((m) => m.type)
    expect(types.filter((t) => t === 'finishing')).toHaveLength(1)
    expect(types.indexOf('finishing')).toBeGreaterThan(types.lastIndexOf('transcribing'))
    expect(types.indexOf('finishing')).toBeLessThan(types.indexOf('result'))
  })

  it('is still posted once when the model runs more often than predicted', async () => {
    chunkRuns = 5

    await transcribe()

    expect(posted.filter((m) => m.type === 'finishing')).toHaveLength(1)
  })
})

describe('overlapping requests', () => {
  it('drops a second transcribe while one is in flight', async () => {
    // The shipped component disables its controls while busy, so this guards
    // against a future caller: two interleaved runs would weave two message
    // streams into one state machine.
    let release: () => void = () => {}
    asr.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ text: 'hello', chunks: [] })
        }),
    )

    const audio = () => new Float32Array(16)
    self.onmessage?.(new MessageEvent('message', { data: { type: 'transcribe', audio: audio() } }))
    self.onmessage?.(new MessageEvent('message', { data: { type: 'transcribe', audio: audio() } }))
    await vi.waitFor(() => expect(asr).toHaveBeenCalled())
    release()
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'result')).toBe(true))

    expect(asr).toHaveBeenCalledTimes(1)
    expect(posted.filter((m) => m.type === 'result')).toHaveLength(1)
  })
})
