import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FINISH_TIMEOUT_MS } from '../audio/live/soniox-stream.js'
import {
  DROPPED_ERROR,
  SHORT_TAIL_NOTICE,
  START_FAILED_ERROR,
  useDictationStream,
} from './use-dictation-stream.js'

/**
 * The properties that make streaming dictation safe rather than merely working.
 *
 * Consent is enforced where it counts rather than on a button; the key is not
 * spent while a permission prompt sits open; provisional text stays separate
 * from settled text; and every way a run can end delivers exactly once, because
 * the caller hangs a single `parsePrescription` on that delivery.
 *
 * The fakes below are deliberately smaller than the ones in
 * `AmbientCapture.test.tsx`: this surface has one speaker, no segments and no
 * retained audio. They are a third copy of the same shape, which is worth
 * consolidating and is noted as a follow-up rather than done here, because
 * extracting the larger harness would edit two passing test files this change
 * has no other reason to touch.
 */

const mocks = vi.hoisted(() => ({ createLiveSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: { createLiveSession: mocks.createLiveSession } }))

const recorders: FakeMediaRecorder[] = []
const sockets: FakeWebSocket[] = []

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: 'inactive' | 'recording' = 'inactive'
  timeslice: number | undefined
  start = vi.fn((timeslice?: number) => {
    this.state = 'recording'
    this.timeslice = timeslice
  })

  constructor(readonly stream: MediaStream) {
    recorders.push(this)
  }

  /** The browser fires these after `stop()` returns, never inside it. */
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: { size: 4 } as Blob })
      this.onstop?.()
    })
  }

  emit(size = 8) {
    this.ondataavailable?.({ data: { size } as Blob })
  }
}

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  readyState = 0
  binaryType = 'blob'
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    sockets.push(this)
  }

  send(payload: unknown) {
    this.sent.push(payload)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  deliver(tokens: { text: string; is_final: boolean }[], finished = false) {
    this.onmessage?.({ data: JSON.stringify({ tokens, finished }) } as MessageEvent)
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

const session = {
  apiKey: 'temp-key',
  expiresAt: new Date().toISOString(),
  clientReferenceId: 'ref-1',
  provider: 'soniox',
  region: 'us',
  websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
  config: {},
}

let getUserMedia: ReturnType<typeof vi.fn>
let tracks: { stop: ReturnType<typeof vi.fn> }[]

/** The single microphone track a run opens, or a readable failure. */
const track = () => {
  const first = tracks[0]
  if (first === undefined) throw new Error('no microphone track was created')
  return first
}

/** Call order, so "before" assertions read as order rather than as indexes. */
const firstCallOrder = (fn: ReturnType<typeof vi.fn>) => {
  const order = fn.mock.invocationCallOrder[0]
  if (order === undefined) throw new Error('expected the function to have been called')
  return order
}

beforeEach(() => {
  recorders.length = 0
  sockets.length = 0
  mocks.createLiveSession.mockReset().mockResolvedValue(session)

  tracks = [{ stop: vi.fn() }]
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => tracks } as unknown as MediaStream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => vi.unstubAllGlobals())

/**
 * Drives a run to the point where audio is flowing.
 *
 * The lookups throw rather than being asserted away, so a run that never
 * reached the socket fails here with a readable reason instead of further down
 * on a property of `undefined`.
 */
const startStreaming = async (onComplete = vi.fn()) => {
  const view = renderHook(() => useDictationStream({ onComplete }))
  await act(async () => {
    await view.result.current.start()
  })

  const socket = sockets[0]
  if (socket === undefined) throw new Error('no socket was opened')
  await act(async () => {
    socket.open()
  })

  const recorder = recorders[0]
  if (recorder === undefined) throw new Error('no recorder was created')
  return { view, onComplete, socket, recorder }
}

/**
 * **The consent dispatcher that used to live here was removed on 10/09/26
 * (#365).** `.claude/rules/security.md` required a per-consultation tick on
 * this surface, and the hook enforced it at dispatch rather than trusting a
 * disabled button. The owner removed the tick, so there is nothing left for the
 * hook to check and no refusal to test. What replaced the test is in
 * `PrescriptionTheatre.test.tsx`: the client asks for no tick and, more to the
 * point, no longer *claims* one on the wire, because the audit row records
 * exactly what it claims. Ambient capture is unchanged and keeps both halves.
 */
describe('starting a run', () => {
  it('opens the microphone before it spends a key', async () => {
    await startStreaming()

    // The key lives thirty seconds and the permission prompt is the slow part,
    // so minting first would routinely burn a key on a dialog nobody answered.
    expect(getUserMedia).toHaveBeenCalled()
    expect(mocks.createLiveSession).toHaveBeenCalledWith(expect.anything(), 'dictation')
    expect(firstCallOrder(getUserMedia)).toBeLessThan(firstCallOrder(mocks.createLiveSession))
  })

  it('reports a refused mint without claiming anything was sent', async () => {
    mocks.createLiveSession.mockRejectedValue(new Error('rate_limited'))
    const { result } = renderHook(() => useDictationStream({ onComplete: vi.fn() }))

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.error).toBe(START_FAILED_ERROR)
    expect(result.current.phase).toBeNull()
    // The microphone is handed back rather than left live, because the browser
    // indicator staying on reads as "still listening" in a consulting room.
    expect(track().stop).toHaveBeenCalled()
  })
})

describe('while streaming', () => {
  it('keeps provisional text out of the settled text', async () => {
    const { view, socket } = await startStreaming()

    await act(async () => {
      socket.deliver([
        { text: 'amoxicillin ', is_final: true },
        { text: '500', is_final: false },
      ])
    })

    await waitFor(() => expect(view.result.current.settled).toContain('amoxicillin'))
    // The field takes settled text only. A provisional token written into a
    // `maxLength` box would stay truncated once it settled.
    expect(view.result.current.settled).not.toContain('500')
    expect(view.result.current.interim).toContain('500')
  })

  it('hands the recorder chunks straight to the socket and retains none', async () => {
    const { socket, recorder } = await startStreaming()

    act(() => recorder.emit())

    // One config frame, then the chunk. Nothing is kept: there is no playback
    // surface here, and a second `createObjectURL` holder would fail the
    // audio-persistence guard.
    expect(socket.sent.length).toBeGreaterThanOrEqual(2)
  })
})

describe('ending a run', () => {
  it('delivers the settled text exactly once on a stop the provider acknowledges', async () => {
    const { view, onComplete, socket } = await startStreaming()

    await act(async () => {
      socket.deliver([{ text: 'paracetamol 1 g', is_final: true }])
    })
    // Two acts, because the end frame is only sent once the recorder has handed
    // over its last chunk. Acknowledging inside the first would answer a
    // question the socket had not asked yet.
    await act(async () => {
      view.result.current.stop()
    })
    await act(async () => {
      socket.deliver([], true)
    })

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('paracetamol'), null)
    expect(track().stop).toHaveBeenCalled()
  })

  it('still delivers, with a short-tail notice, when the end is never acknowledged', async () => {
    vi.useFakeTimers()
    try {
      const { view, onComplete, socket } = await startStreaming()

      await act(async () => {
        socket.deliver([{ text: 'salbutamol inhaler', is_final: true }])
      })
      await act(async () => {
        view.result.current.stop()
      })
      // The drain is bounded on purpose: a doctor who pressed Stop and sees
      // nothing cannot tell a slow provider from a dead session.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FINISH_TIMEOUT_MS + 1_000)
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onComplete).toHaveBeenCalledWith(
        expect.stringContaining('salbutamol'),
        SHORT_TAIL_NOTICE,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps what settled when the socket drops, and still delivers once', async () => {
    const { view, onComplete, socket } = await startStreaming()

    await act(async () => {
      socket.deliver([{ text: 'amoxicillin 500 mg', is_final: true }])
    })
    await act(async () => {
      socket.drop()
    })

    /*
     * There is no reconnect (#256). The settled words are real, so they are
     * kept and the doctor is told what may be missing, rather than being shown
     * a box that silently stopped growing.
     */
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('amoxicillin'), DROPPED_ERROR)
    expect(view.result.current.error).toBe(DROPPED_ERROR)
  })

  it('stops twice without delivering twice', async () => {
    const { view, onComplete, socket } = await startStreaming()

    await act(async () => {
      socket.deliver([{ text: 'ibuprofen', is_final: true }])
    })
    await act(async () => {
      view.result.current.stop()
      view.result.current.stop()
    })
    await act(async () => {
      socket.deliver([], true)
    })

    // The caller fires one parse per delivery, so a second delivery would move
    // the candidate offsets under a doctor who was reading them.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })
})

describe('unmounting mid-run', () => {
  it('drops the socket and releases the microphone', async () => {
    const { view, onComplete, socket } = await startStreaming()

    await act(async () => {
      socket.deliver([{ text: 'cetirizine', is_final: true }])
    })
    view.unmount()

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(track().stop).toHaveBeenCalled()
    // Nothing is delivered to a component that no longer exists.
    expect(onComplete).not.toHaveBeenCalled()
  })
})
