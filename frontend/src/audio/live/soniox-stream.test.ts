import type { LiveSession } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECT_TIMEOUT_MS,
  FINISH_TIMEOUT_MS,
  type LiveStreamFailure,
  openSonioxStream,
} from './soniox-stream.js'

/**
 * A driveable stand-in for the browser's socket.
 *
 * The real one cannot be exercised here, and the behaviour worth pinning is not
 * the transport: it is what this module does with an open, a message, a drop
 * and a stop, and that nothing the provider says can escape as text.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  sent: unknown[] = []
  closedWith: number | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(payload: unknown) {
    this.sent.push(payload)
  }

  close(code?: number) {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.closedWith = code
  }

  // ── Test drivers ───────────────────────────────────────────────────────────

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  message(payload: unknown) {
    this.onmessage?.({
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    } as MessageEvent)
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

const session: LiveSession = {
  provider: 'soniox',
  region: 'us',
  websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
  apiKey: 'temp-session-key',
  expiresAt: '2026-09-06T12:01:00Z',
  config: {
    model: 'stt-rt-v5',
    languageHints: ['ms', 'en', 'zh', 'ta'],
    languageIdentification: true,
    speakerDiarization: true,
    // Off, because it forces early finalisation and freezes speaker ids before
    // the diariser can settle them. See `liveSessionConfig` on the API.
    endpointDetection: false,
    context: {
      general: [
        { key: 'domain', value: 'Healthcare' },
        { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
      ],
    },
  },
}

let onOpen: ReturnType<typeof vi.fn>
let onTokens: ReturnType<typeof vi.fn>
let onFailure: ReturnType<typeof vi.fn>

const handlers = () => ({ onOpen, onTokens, onFailure })

const socket = () => {
  const instance = FakeWebSocket.instances[0]
  if (!instance) throw new Error('no socket was constructed')
  return instance
}

const failures = (): LiveStreamFailure[] => onFailure.mock.calls.map((call) => call[0])

const blob = (size = 8) => ({ size }) as Blob

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  onOpen = vi.fn()
  onTokens = vi.fn()
  onFailure = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connecting', () => {
  it('opens one socket at the address the session names', () => {
    openSonioxStream(session, handlers())

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket().url).toBe('wss://stt-rt.soniox.com/transcribe-websocket')
  })

  it('sends the recognition config as the first frame, and only then reports open', () => {
    const stream = openSonioxStream(session, handlers())
    expect(socket().sent).toEqual([])

    socket().open()

    expect(socket().sent).toHaveLength(1)
    expect(JSON.parse(String(socket().sent[0]))).toEqual({
      api_key: 'temp-session-key',
      model: 'stt-rt-v5',
      audio_format: 'auto',
      language_hints: ['ms', 'en', 'zh', 'ta'],
      enable_language_identification: true,
      enable_speaker_diarization: true,
      enable_endpoint_detection: false,
      // Forwarded exactly as the API composed it. This frame is the audio
      // egress, so the assertion is that nothing here is added client-side.
      context: {
        general: [
          { key: 'domain', value: 'Healthcare' },
          { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
        ],
      },
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(stream.state).toBe('streaming')
  })

  it('gives up if the socket never opens, rather than looking like it is listening', () => {
    openSonioxStream(session, handlers())

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)

    expect(failures()).toEqual(['connect_failed'])
    expect(socket().readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('treats a close before the open as a failure to connect', () => {
    openSonioxStream(session, handlers())

    socket().drop()

    expect(failures()).toEqual(['connect_failed'])
  })
})

describe('sending audio', () => {
  it('forwards a chunk once the socket is streaming', () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()
    const chunk = blob()

    stream.send(chunk)

    expect(socket().sent[1]).toBe(chunk)
  })

  it('drops a chunk that arrives before the socket is open', () => {
    const stream = openSonioxStream(session, handlers())

    stream.send(blob())

    expect(socket().sent).toEqual([])
  })

  it('drops a chunk after the session has ended', () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()
    stream.abort()

    stream.send(blob())

    expect(socket().sent).toHaveLength(1)
  })

  it('drops an empty chunk, which carries no audio', () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()

    stream.send(blob(0))

    expect(socket().sent).toHaveLength(1)
  })
})

describe('receiving tokens', () => {
  it('maps the wire shape, keeping speaker and language as opaque labels', () => {
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({
      tokens: [
        {
          text: 'Selamat',
          start_ms: 100,
          end_ms: 600,
          is_final: true,
          speaker: 1,
          language: 'ms',
          confidence: 0.42,
        },
        { text: ' pagi', start_ms: 600, end_ms: 900, is_final: false },
      ],
    })

    expect(onTokens.mock.calls[0]?.[0]).toEqual([
      {
        text: 'Selamat',
        startMs: 100,
        endMs: 600,
        isFinal: true,
        speaker: '1',
        language: 'ms',
        confidence: 0.42,
        endpoint: false,
      },
      {
        text: ' pagi',
        startMs: 600,
        endMs: 900,
        isFinal: false,
        speaker: null,
        language: null,
        // Absent on the wire, and `null` rather than 0 here: the recogniser
        // said nothing, which is not the same as saying it was unsure.
        confidence: null,
        endpoint: false,
      },
    ])
  })

  it('refuses a confidence outside the vendor range without ending the session', () => {
    // A live consultation must not die because one token carried a value the
    // contract does not allow. It becomes an unknown, and the stream continues.
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({
      tokens: [{ text: 'demam', is_final: true, confidence: 1.4 }],
    })

    expect(onFailure).not.toHaveBeenCalled()
    expect(onTokens.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ text: 'demam', confidence: null }),
    ])
  })

  it('turns a control word into a boundary that carries no text', () => {
    // A caller that ignored `endpoint` still could not render the marker,
    // because the text is emptied here.
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({ tokens: [{ text: '<end>', is_final: true }, { text: '<fin>' }] })

    const mapped = onTokens.mock.calls[0]?.[0] as { text: string; endpoint: boolean }[]
    expect(mapped.every((token) => token.endpoint)).toBe(true)
    expect(mapped.every((token) => token.text === '')).toBe(true)
  })

  it('says nothing when a message carries no tokens', () => {
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({ tokens: [] })

    expect(onTokens).not.toHaveBeenCalled()
  })
})

describe('finishing', () => {
  it('sends the end frame and resolves when the provider acknowledges it', async () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()

    const drained = stream.finish()
    expect(socket().sent[1]).toBe('')
    expect(stream.state).toBe('draining')

    socket().message({ tokens: [], finished: true })

    await expect(drained).resolves.toEqual({ finished: true })
    expect(stream.state).toBe('closed')
    expect(socket().closedWith).toBe(1000)
  })

  it('still delivers the last words that arrive during the drain', async () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()
    const drained = stream.finish()

    socket().message({ tokens: [{ text: ' terima kasih', is_final: true }] })
    socket().message({ tokens: [], finished: true })
    await drained

    expect(onTokens).toHaveBeenCalledTimes(1)
  })

  it('gives up waiting rather than hanging after a stop', async () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()

    const drained = stream.finish()
    vi.advanceTimersByTime(FINISH_TIMEOUT_MS)

    // The settled text is delivered anyway; `finished: false` is how the caller
    // knows the tail may be short.
    await expect(drained).resolves.toEqual({ finished: false })
    expect(failures()).toEqual([])
  })

  it('resolves a pending drain when the socket drops, and raises no alarm', async () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()

    const drained = stream.finish()
    socket().drop()

    await expect(drained).resolves.toEqual({ finished: false })
    // The caller asked to stop and already learns the tail may be short from
    // `finished: false`. Reporting a lost connection as well would put a false
    // alarm on screen after a consultation that ended normally, and invites a
    // caller that treats a failure as terminal into delivering twice.
    expect(failures()).toEqual([])
  })
})

describe('failures', () => {
  it('reports a refused session without carrying the provider text anywhere', () => {
    const MARKER = 'MARKER_PROVIDER_TEXT_4417 invalid api key sk-live-abc'
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({
      tokens: [],
      error_code: 401,
      error_type: MARKER,
      error_message: MARKER,
    })

    expect(failures()).toEqual(['rejected'])
    // The schema omits `error_message`, so Zod strips it and there is nothing
    // to leak by accident.
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(MARKER)
    expect(JSON.stringify(onTokens.mock.calls)).not.toContain(MARKER)
  })

  it('reports a drop mid-consultation exactly once, and ignores what follows', () => {
    openSonioxStream(session, handlers())
    socket().open()

    socket().drop()
    socket().drop()
    socket().message({ tokens: [{ text: 'late', is_final: true }] })

    expect(failures()).toEqual(['closed'])
    expect(onTokens).not.toHaveBeenCalled()
  })

  it('refuses a message that is not the contract', () => {
    openSonioxStream(session, handlers())
    socket().open()

    socket().message('not json at all')

    expect(failures()).toEqual(['invalid_message'])
  })

  it('refuses a message whose tokens do not match the contract', () => {
    openSonioxStream(session, handlers())
    socket().open()

    socket().message({ tokens: [{ text: 42 }] })

    expect(failures()).toEqual(['invalid_message'])
  })
})

describe('abort', () => {
  it('drops the session silently, which is what an unmount needs', () => {
    const stream = openSonioxStream(session, handlers())
    socket().open()

    stream.abort()

    expect(stream.state).toBe('closed')
    expect(socket().readyState).toBe(FakeWebSocket.CLOSED)
    // No end frame: an abandoned session is not a stop, and nobody is waiting
    // for its transcript.
    expect(socket().sent).toHaveLength(1)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('leaves no timer behind', () => {
    const stream = openSonioxStream(session, handlers())

    stream.abort()

    expect(vi.getTimerCount()).toBe(0)
  })
})
