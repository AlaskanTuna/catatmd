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

const asr = vi.fn(async () => ({ text: 'hello', chunks: [] }) as unknown)

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => asr),
  env: {},
}))

let posted: WorkerResponse[]

beforeEach(async () => {
  posted = []
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
async function transcribe() {
  self.onmessage?.(
    new MessageEvent('message', { data: { type: 'transcribe', audio: new Float32Array(16) } }),
  )
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
    // Asserted as an exact sequence rather than by comparing indexes. With the
    // fix reverted, `indexOf('ready')` is -1 and `-1 < 0` passes, so the
    // obvious form of this test is vacuous. That was not hypothetical: it is
    // what the first draft did, and deleting the fix left it green.
    await transcribe()

    expect(posted.map((m) => m.type)).toEqual(['ready', 'result'])
  })

  it('reports a failure as an error rather than a silent stall', async () => {
    asr.mockRejectedValueOnce(new Error('session failed'))

    await transcribe()

    expect(posted.at(-1)).toEqual({ type: 'error', message: 'session failed' })
  })
})
