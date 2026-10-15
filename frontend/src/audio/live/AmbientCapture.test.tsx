import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api.js'
import { AmbientCapture, TIMESLICE_MS } from './AmbientCapture.js'
import { FINISH_TIMEOUT_MS } from './soniox-stream.js'

const liveAsrConfig = vi.hoisted(() => vi.fn())
const createLiveSession = vi.hoisted(() => vi.fn())
const draftHostedTurns = vi.hoisted(() => vi.fn())
const createBatchSession = vi.hoisted(() => vi.fn())
const refinementCheck = vi.hoisted(() => vi.fn())
const transcribeRecording = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api.js')>('../../lib/api.js')
  return {
    ApiError: actual.ApiError,
    api: {
      liveAsrConfig,
      createLiveSession,
      draftHostedTurns,
      createBatchSession,
      refinementCheck,
    },
  }
})

// The upload itself is pinned by `elevenlabs-batch.test.ts`; here it is the
// seam the component drives.
vi.mock('./elevenlabs-batch.js', () => ({ transcribeRecording }))

vi.mock('react-hot-toast', () => ({ default: toast }))

/** Every recorder the component builds, so tests can drive it. */
const recorders: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: 'inactive' | 'recording' = 'inactive'
  readonly stream: MediaStream
  readonly options: unknown
  start = vi.fn((timeslice?: number) => {
    this.state = 'recording'
    this.timeslice = timeslice
  })
  timeslice: number | undefined

  constructor(stream: MediaStream, options?: unknown) {
    this.stream = stream
    this.options = options
    recorders.push(this)
  }

  /** The browser fires these after stop() returns, never inside it. */
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['tail']) })
      this.onstop?.()
    })
  }

  /** Test driver: one timeslice chunk. */
  emit(size = 8) {
    this.ondataavailable?.({ data: { size } as Blob })
  }
}

/** Every socket the stream client builds, so tests can drive the provider. */
const sockets: FakeWebSocket[] = []

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
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

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 8,
      getByteTimeDomainData: () => {},
      connect: () => {},
      disconnect: () => {},
    }
  }
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} }
  }
  close = vi.fn(async () => {})
}

const session = {
  provider: 'soniox' as const,
  region: 'us' as const,
  websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
  apiKey: 'temp-session-key',
  expiresAt: '2026-09-06T12:01:00Z',
  config: {
    model: 'stt-rt-v5',
    languageHints: ['ms', 'en', 'zh', 'ta'],
    languageIdentification: true,
    speakerDiarization: true,
    endpointDetection: false,
    context: {
      general: [
        { key: 'domain', value: 'Healthcare' },
        { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
      ],
    },
  },
}

const config = {
  provider: session.provider,
  region: session.region,
  websocketUrl: session.websocketUrl,
  config: session.config,
}

const BATCH_SESSION = {
  provider: 'elevenlabs' as const,
  uploadUrl: 'https://api.elevenlabs.io/v1/speech-to-text' as const,
  token: 'single-use-batch-token',
  config: {
    modelId: 'scribe_v2' as const,
    diarize: true as const,
    numSpeakers: 2 as const,
    timestampsGranularity: 'word' as const,
    tagAudioEvents: false as const,
    keyterms: ['batuk'],
  },
}

/** The vendor's words for a sentence, with spacing elements between them. */
function vendorSentence(text: string, startAt: number, speaker: string) {
  const out: { text: string; start: number; end: number; type: string; speaker_id: string }[] = []
  let at = startAt
  for (const [index, piece] of text.split(' ').entries()) {
    if (index > 0) out.push({ text: ' ', start: at, end: at, type: 'spacing', speaker_id: speaker })
    out.push({ text: piece, start: at, end: at + 0.3, type: 'word', speaker_id: speaker })
    at += 0.4
  }
  return out
}

/*
 * The refined reading of the consultation the refinement tests stream. The
 * live socket hears the negation flip §20.13 measured on Soniox ("Tak ada
 * batuk" for "Ada batuk sikit"); the batch pass hears what was said.
 */
const REFINED_WORDS = [
  ...vendorSentence('Ada batuk sikit doktor.', 0, 'speaker_1'),
  ...vendorSentence('Berapa lama sudah batuk?', 4, 'speaker_0'),
]

let getUserMedia: () => Promise<MediaStream>
let tracks: { stop: ReturnType<typeof vi.fn> }[]
let gumCalls: unknown[]

beforeEach(() => {
  vi.useFakeTimers()
  recorders.length = 0
  sockets.length = 0
  liveAsrConfig.mockReset().mockResolvedValue(config)
  createLiveSession.mockReset().mockResolvedValue(session)
  // Rejects promptly by default: labelling is a bonus on top of a transcript
  // already in hand, so a test that does not care must not wait out a hang.
  draftHostedTurns.mockReset().mockRejectedValue(new Error('not configured'))
  // Refinement is offered only when the config says so, and no test outside
  // its own block turns that on, so these answer only when asked.
  createBatchSession.mockReset().mockResolvedValue(BATCH_SESSION)
  transcribeRecording.mockReset().mockResolvedValue({ ok: true, sent: true, words: REFINED_WORDS })
  refinementCheck.mockReset().mockResolvedValue([])
  toast.mockReset()
  FakeMediaRecorder.isTypeSupported.mockReset().mockReturnValue(true)
  tracks = [{ stop: vi.fn() }]
  gumCalls = []
  getUserMedia = async () => ({ getTracks: () => tracks }) as unknown as MediaStream
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: (constraints: unknown) => {
        gumCalls.push(constraints)
        return getUserMedia()
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  // cleanup() must run while the fake clock is installed: unmount clears timer
  // handles, and clearing fake handles with the real function leaks them.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Fake timers hold macrotasks but not microtasks; this drains the awaits. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  })
}

type AmbientProps = Parameters<typeof AmbientCapture>[0]

function renderAmbient(deviceId: string | null = null, extra: Partial<AmbientProps> = {}) {
  const onTranscript = vi.fn()
  const onSwitchToManual = vi.fn()
  const onLiveChange = vi.fn()
  const onLiveSegments = vi.fn()
  const view = render(
    <AmbientCapture
      onTranscript={onTranscript}
      onSwitchToManual={onSwitchToManual}
      onLiveChange={onLiveChange}
      onLiveSegments={onLiveSegments}
      deviceId={deviceId}
      {...extra}
    />,
  )
  return { onTranscript, onSwitchToManual, onLiveChange, onLiveSegments, ...view }
}

const tick = () => screen.getByRole('checkbox', { name: /agreed/i }) as HTMLInputElement

const startButton = () =>
  screen.getByRole('button', { name: /start ambient/i }) as HTMLButtonElement

const socket = () => {
  const instance = sockets[0]
  if (!instance) throw new Error('no socket was opened')
  return instance
}

const recorder = () => {
  const instance = recorders[0]
  if (!instance) throw new Error('no recorder was built')
  return instance
}

/** Ticks consent and starts a session that is open and streaming. */
async function startSession(deviceId: string | null = null, extra: Partial<AmbientProps> = {}) {
  const view = renderAmbient(deviceId, extra)
  await settle()
  await act(async () => tick().click())
  await act(async () => startButton().click())
  await settle()
  await act(async () => socket().open())
  await settle()
  return view
}

describe('availability', () => {
  it('offers a way back to Press To Record when no provider is configured', async () => {
    liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'nope'))
    const { onSwitchToManual } = renderAmbient()
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/not available on this deployment/i)
    // The whole point of #254: a stored ambient mode must never dead-end the
    // Record tab, so the way out is one click and it is on this screen.
    await act(async () => screen.getByRole('button', { name: /press to record/i }).click())
    expect(onSwitchToManual).toHaveBeenCalledTimes(1)

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /start ambient/i })).toBeNull()
  })

  /*
   * The signal the Record tab acts on by writing the consultation's mode
   * (#378), so it has to mean what it says. Only a real `asr_unavailable`
   * counts: a bare 503 is also what a cold start through the `/api` rewrite
   * returns, and flipping a doctor's deliberate choice on one of those would
   * be a transient outage making a permanent claim.
   */
  it('reports unavailability on asr_unavailable, and not on a bare 503', async () => {
    const onUnavailable = vi.fn()

    liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'nope'))
    renderAmbient(null, { onUnavailable })
    await settle()
    expect(onUnavailable).toHaveBeenCalledTimes(1)

    cleanup()
    onUnavailable.mockClear()

    liveAsrConfig.mockRejectedValue(new ApiError(503, 'unknown', 'cold start'))
    renderAmbient(null, { onUnavailable })
    await settle()

    expect(onUnavailable).not.toHaveBeenCalled()
    // And it stays retryable, rather than dead-ending on a false diagnosis.
    expect(screen.getByRole('alert').textContent).toMatch(/could not be reached/i)
    expect(screen.getByRole('button', { name: /check again/i })).toBeTruthy()
  })

  it('offers a retry when the check itself failed', async () => {
    liveAsrConfig.mockRejectedValue(new Error('offline'))
    renderAmbient()
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/could not be reached/i)
    liveAsrConfig.mockResolvedValue(config)
    await act(async () => screen.getByRole('button', { name: /check again/i }).click())
    await settle()

    expect(screen.getByRole('checkbox', { name: /agreed/i })).toBeTruthy()
  })

  it('offers nothing to start while the check is still running', () => {
    liveAsrConfig.mockReturnValue(new Promise(() => {}))
    renderAmbient()

    expect(screen.queryByRole('button', { name: /start ambient/i })).toBeNull()
  })
})

describe('the idle explainer', () => {
  it('shows the mode, title-cases the idle status, and keeps the speaker-label tip portalled', async () => {
    renderAmbient()
    await settle()

    expect(screen.getByText('Not Listening')).toBeTruthy()
    const summary = screen.getByText('Ambient Capture transcribes the consultation as it happens.')
    expect(summary).toBeTruthy()

    // The language-tuning helper is gone.
    expect(screen.queryByText(/Other languages are untested here/i)).toBeNull()
    expect(screen.queryByText(/tuned for/i)).toBeNull()

    const tipTrigger = screen.getByRole('button', { name: /about speaker labels/i })
    await act(async () => tipTrigger.click())

    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toMatch(/Speaker labels are automatic\. Check them before submitting\./)
    expect(tip.textContent).not.toMatch(
      /GPU|CDN|model weights|segment timing|voice model|Other languages are untested here/i,
    )

    /*
     * The transcript column scrolls from `lg` up, and `overflow-y: auto` drags
     * `overflow-x` to `auto` with it, so an in-flow panel is cut off on the
     * right and the doctor read "so check th" (#289). Portalled to the body,
     * nothing above it can clip it. jsdom cannot see the clipping itself, so
     * this pins the mechanism that avoids it.
     */
    expect(tip.parentElement).toBe(document.body)
  })

  it('keeps the consent gate directly after the idle summary', async () => {
    renderAmbient()
    await settle()

    const summary = screen.getByText('Ambient Capture transcribes the consultation as it happens.')
    const gate = summary.parentElement?.nextElementSibling
    expect(gate).toBeTruthy()
    expect(within(gate as HTMLElement).getByRole('checkbox', { name: /agreed/i })).toBeTruthy()

    // The tick is now the whole of the gate, so it must be the whole of what
    // sits between the summary and the button it enables. A paragraph
    // reappearing here is the removed disclosure coming back.
    expect(gate?.textContent).toMatch(/^\s*This patient has agreed/)
  })
})

describe('consent', () => {
  /*
   * The inverse of the test that stood here until 10/09/26, which asserted the
   * panel named Soniox, the United States, and that our server never holds the
   * audio. The owner removed that paragraph (`docs/decisions.md` D-004), so
   * this pins the new state as tightly as the old one was pinned: the tick is
   * what this surface asks, and it asks it without naming a recipient.
   *
   * Kept as an assertion rather than deleted because the loss is the point. A
   * reader restoring the sentence has to delete a test that says why it went.
   */
  it('asks for agreement without naming the processor or the region', async () => {
    renderAmbient()
    await settle()

    expect(screen.getByRole('checkbox', { name: /agreed/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /recorded and transcribed/i })).toBeTruthy()

    expect(document.body.textContent).not.toMatch(/Soniox/)
    expect(document.body.textContent).not.toMatch(/United States/)
    expect(document.body.textContent).not.toMatch(/leaves this device/i)
  })

  it('does not list tuned or untested languages in the idle panel', async () => {
    renderAmbient()
    await settle()

    expect(screen.queryByText(/Other languages are untested here/i)).toBeNull()
    expect(screen.queryByText(/tuned for/i)).toBeNull()
  })

  it('mints nothing until this patient has agreed', async () => {
    renderAmbient()
    await settle()

    expect(startButton().disabled).toBe(true)
    await act(async () => startButton().click())
    await settle()

    expect(createLiveSession).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(0)
  })

  it('never remembers the agreement, so the next patient is asked again', async () => {
    const first = renderAmbient()
    await settle()
    await act(async () => tick().click())
    expect(tick().checked).toBe(true)

    first.unmount()
    renderAmbient()
    await settle()

    expect(tick().checked).toBe(false)
  })

  it('writes nothing to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderAmbient()
    await settle()
    await act(async () => tick().click())

    expect(setItem).not.toHaveBeenCalled()
  })

  it('cannot be changed once a session is running', async () => {
    await startSession()

    expect(tick().disabled).toBe(true)
  })
})

describe('starting', () => {
  it('opens the microphone before spending a key, and records only once connected', async () => {
    renderAmbient()
    await settle()
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()

    // The permission prompt can sit for a long time and the key lives about a
    // minute, so the order matters.
    expect(gumCalls).toHaveLength(1)
    expect(createLiveSession).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(recorders).toHaveLength(0)

    await act(async () => socket().open())
    await settle()

    expect(recorders).toHaveLength(1)
    expect(recorder().start).toHaveBeenCalledWith(TIMESLICE_MS)
  })

  it('captures with the voice-call processing off, as dictation needs', async () => {
    await startSession()

    expect(gumCalls[0]).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  })

  it('records from the microphone the doctor chose', async () => {
    /*
     * Found by QA on 07/09/26, not by review. On a Windows machine with a
     * screen-capture tool installed, `audio: true` selected that tool's virtual
     * device over the real array: the meter read Silent, the socket stayed
     * open, and nothing reached the recogniser. The Audio dialog's Microphone
     * select was already there and was simply not wired to this path.
     */
    await startSession('realtek-array-id')

    expect(gumCalls[0]).toEqual({
      audio: {
        deviceId: { exact: 'realtek-array-id' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  })

  it('falls back to the recorder default where opus is unsupported', async () => {
    FakeMediaRecorder.isTypeSupported.mockReturnValue(false)
    await startSession()

    expect(recorder().options).toBeUndefined()
  })

  it('says nothing was sent when the microphone is refused', async () => {
    getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }
    renderAmbient()
    await settle()
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/no microphone/i)
    expect(createLiveSession).not.toHaveBeenCalled()
  })

  it('releases the microphone when the key cannot be minted', async () => {
    createLiveSession.mockRejectedValue(new ApiError(502, 'asr_failed', 'nope'))
    renderAmbient()
    await settle()
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/could not start/i)
    expect(screen.getByRole('alert').textContent).toMatch(/nothing was sent/i)
    expect(tracks[0]?.stop).toHaveBeenCalled()
    expect(sockets).toHaveLength(0)
  })

  it('releases the microphone when the socket never opens', async () => {
    renderAmbient()
    await settle()
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()

    await act(async () => socket().drop())
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/could not start/i)
    expect(tracks[0]?.stop).toHaveBeenCalled()
  })
})

describe('listening', () => {
  it('does not offer manual pause controls', async () => {
    await startSession()

    expect(screen.queryByRole('button', { name: /pause recording/i })).toBeNull()
  })

  it('forwards every chunk the recorder produces', async () => {
    await startSession()

    await act(async () => {
      recorder().emit()
      recorder().emit()
    })

    // One config frame plus two chunks.
    expect(socket().sent).toHaveLength(3)
  })

  it('shows settled text and replaces the unsettled tail as it changes', async () => {
    await startSession()

    await act(async () =>
      socket().message({
        tokens: [
          { text: 'Selamat pagi', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 },
          { text: ' bat', start_ms: 900, end_ms: 1100, is_final: false, speaker: 1 },
        ],
      }),
    )
    expect(screen.getByText('Selamat pagi')).toBeTruthy()
    expect(screen.getByText('bat')).toBeTruthy()

    await act(async () =>
      socket().message({
        tokens: [{ text: ' batuk', start_ms: 900, end_ms: 1300, is_final: false, speaker: 1 }],
      }),
    )

    expect(screen.getByText('batuk')).toBeTruthy()
    expect(screen.queryByText('bat')).toBeNull()
  })

  it('reports settled segments to the live panes, and never interim ones', async () => {
    const { onLiveSegments } = await startSession()
    onLiveSegments.mockClear()

    // Interim only. The panes must not see words the patient has not finished.
    await act(async () =>
      socket().message({
        tokens: [{ text: 'bat', start_ms: 0, end_ms: 300, is_final: false, speaker: 1 }],
      }),
    )
    expect(onLiveSegments).not.toHaveBeenCalled()

    await act(async () =>
      socket().message({
        tokens: [
          { text: 'Selamat pagi', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 },
          { text: ' batu', start_ms: 900, end_ms: 1100, is_final: false, speaker: 1 },
        ],
      }),
    )

    const reported = onLiveSegments.mock.calls.at(-1)?.[0] as { text: string }[]
    expect(reported.map((segment) => segment.text)).toEqual(['Selamat pagi'])
  })

  it('never renders a control marker', async () => {
    const { container } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [
          { text: 'Good morning', start_ms: 0, end_ms: 500, is_final: true, speaker: 1 },
          { text: '<end>', start_ms: 500, end_ms: 500, is_final: true, speaker: 1 },
        ],
      }),
    )

    expect(container.textContent).not.toContain('<end>')
  })

  it('reports that it is live, so a settings save cannot unmount it', async () => {
    const { onLiveChange } = await startSession()

    expect(onLiveChange).toHaveBeenCalledWith(true)
  })
})

describe('stopping', () => {
  it('drains the provider, releases the microphone, and delivers a labelled transcript', async () => {
    draftHostedTurns.mockResolvedValue([
      { speaker: 'doctor', text: 'What brings you in' },
      { speaker: 'patient', text: 'I have a cough' },
    ])
    const { onTranscript, onLiveChange } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [
          { text: 'What brings you in', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 },
          { text: 'I have a cough', start_ms: 4_000, end_ms: 5_000, is_final: true, speaker: 2 },
        ],
      }),
    )

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
    await settle()

    // The recorder's final chunk is forwarded, and only then is the stream
    // ended. Reversing that order asks the provider to finish audio it was
    // never given, and losing the tail loses the end of the consultation.
    const sent = socket().sent
    expect(sent.at(-1)).toBe('')
    expect(sent.at(-2)).toBeInstanceOf(Blob)
    expect(tracks[0]?.stop).toHaveBeenCalled()
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0]).toMatchObject({
      source: 'asr_live',
      text: 'What brings you in I have a cough',
      draftTurns: [
        { speaker: 'doctor', text: 'What brings you in' },
        { speaker: 'patient', text: 'I have a cough' },
      ],
    })
    expect(onTranscript.mock.calls[0]?.[0].segments).toHaveLength(2)
  })

  it('delivers the transcript unlabelled when the labelling pass fails', async () => {
    const { onTranscript } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [{ text: 'Selamat pagi', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 }],
      }),
    )
    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
    await settle()

    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0].draftTurns).toBeUndefined()
    expect(onTranscript.mock.calls[0]?.[0].text).toBe('Selamat pagi')
    // A failed bonus is not an error the doctor has to read.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('delivers nothing when nobody spoke', async () => {
    const { onTranscript } = await startSession()

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
    await settle()

    expect(onTranscript).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /start ambient/i })).toBeTruthy()
  })
})

/*
 * A dropped connection (#256). The socket is reopened on a fresh key while a
 * second recorder queues the audio, so a wifi blip costs the words around the
 * drop rather than the rest of the consultation.
 */
describe('a dropped connection', () => {
  const said = (text: string, start: number, end: number, speaker: number) => ({
    text,
    start_ms: start,
    end_ms: end,
    is_final: true,
    speaker,
  })

  const stopAndFinish = async (live: FakeWebSocket | undefined) => {
    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    if (live) await act(async () => live.message({ tokens: [], finished: true }))
    await stopped
    await settle()
  }

  it('reconnects on its own and keeps transcribing into the same consultation', async () => {
    const { onTranscript } = await startSession()
    await act(async () => socket().message({ tokens: [said('I have had a cough', 0, 900, 2)] }))
    await act(async () => vi.advanceTimersByTime(5_000))

    await act(async () => socket().drop())
    await settle()

    expect(screen.getByText(/connection lost, reconnecting/i).getAttribute('role')).toBe('status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(tracks[0]?.stop).not.toHaveBeenCalled()
    expect(createLiveSession).toHaveBeenCalledTimes(2)

    // Audio spoken while the socket was down is queued, then sent in order.
    const transport = recorders[1]
    if (!transport) throw new Error('no transport recorder')
    await act(async () => {
      transport.emit(5)
      transport.emit(6)
    })
    const reopened = sockets[1]
    if (!reopened) throw new Error('no second socket')
    await act(async () => reopened.open())
    await settle()
    expect(reopened.sent.slice(1).map((chunk) => (chunk as Blob).size)).toEqual([5, 6])
    expect(screen.queryByText(/reconnecting/i)).toBeNull()

    await act(async () => reopened.message({ tokens: [said(' for three days', 0, 900, 1)] }))
    await stopAndFinish(reopened)

    expect(onTranscript).toHaveBeenCalledTimes(1)
    const delivered = onTranscript.mock.calls[0]?.[0]
    expect(delivered.text).toBe('I have had a cough for three days')
    // The second socket's clock restarts at zero, so its words are moved to
    // where they fell in the consultation.
    const later = delivered.segments.find((s: { text: string }) => s.text.includes('three days'))
    expect(later.start).toBeGreaterThanOrEqual(5)
    // Speaker 1 on the new socket is not assumed to be speaker 1 on the old.
    const voices = new Set(delivered.segments.map((s: { speaker: string }) => s.speaker))
    expect(voices.size).toBe(2)
    expect([...voices]).not.toContain('1')
  })

  it("still hears the reopened socket's last words while a stop drains", async () => {
    const { onTranscript } = await startSession()
    await act(async () => socket().drop())
    await settle()
    const reopened = sockets[1]
    if (!reopened) throw new Error('no second socket')
    await act(async () => reopened.open())
    await settle()

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () =>
      reopened.message({ tokens: [said('Come back on Monday.', 0, 900, 1)], finished: true }),
    )
    await stopped
    await settle()

    expect(onTranscript.mock.calls[0]?.[0].text).toBe('Come back on Monday.')
  })

  it('keeps one recorder running for the playback copy, across the drop', async () => {
    await startSession()
    await act(async () => socket().drop())
    await settle()

    expect(recorder().state).toBe('recording')
    expect(recorders[1]?.state).toBe('recording')
  })

  it('names the reconnected speaker by number, marked as reconnected', async () => {
    await startSession()
    await act(async () => socket().drop())
    await settle()
    const reopened = sockets[1]
    if (!reopened) throw new Error('no second socket')
    await act(async () => reopened.open())
    await act(async () => reopened.message({ tokens: [said('Any fever?', 0, 900, 1)] }))

    expect(screen.getByText('Speaker 1 (reconnected)')).toBeTruthy()
  })

  it('gives up, keeps what was transcribed and says capture stopped when it cannot reconnect', async () => {
    createLiveSession.mockResolvedValueOnce(session).mockRejectedValue(new Error('offline'))
    const { onTranscript } = await startSession()
    await act(async () =>
      socket().message({
        tokens: [
          said('I have had a cough', 0, 900, 2),
          { text: ' for th', start_ms: 900, end_ms: 1100, is_final: false, speaker: 2 },
        ],
      }),
    )
    await act(async () => socket().drop())
    await settle()
    for (let i = 0; i < 5; i += 1) {
      await act(async () => vi.advanceTimersByTime(5_000))
      await settle()
    }

    expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
    expect(tracks[0]?.stop).toHaveBeenCalled()
    expect(recorders.every((r) => r.state === 'inactive')).toBe(true)
    // Settled text is a true record of the consultation; the unsettled tail is
    // not, so it goes.
    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0].text).toBe('I have had a cough')
  })

  it('delivers what it has when the doctor stops while it is reconnecting', async () => {
    const { onTranscript } = await startSession()
    await act(async () => socket().message({ tokens: [said('Take one tablet', 0, 900, 1)] }))
    await act(async () => socket().drop())
    await settle()

    await stopAndFinish(undefined)

    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0].text).toBe('Take one tablet')
    expect(screen.getByRole('alert').textContent).toMatch(/not transcribed/i)
    expect(sockets.every((s) => s.readyState === FakeWebSocket.CLOSED)).toBe(true)
    expect(tracks[0]?.stop).toHaveBeenCalled()
  })

  it('never revives a reconnect the doctor stopped, inside the next consultation', async () => {
    createLiveSession
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(session)
    await startSession()
    await act(async () => socket().drop())
    await settle()
    // The first retry failed, so the loop is waiting out its next delay.
    await stopAndFinish(undefined)
    if (!tick().checked) await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()
    expect(sockets).toHaveLength(2)
    const minted = createLiveSession.mock.calls.length

    for (let i = 0; i < 3; i += 1) {
      await act(async () => vi.advanceTimersByTime(5_000))
      await settle()
    }

    expect(createLiveSession.mock.calls.length).toBe(minted)
  })

  it('does not reconnect past the session cap', async () => {
    createLiveSession.mockResolvedValue({ ...session, maxSessionSeconds: 60 })
    await startSession()
    await act(async () => vi.advanceTimersByTime(61_000))
    await act(async () => socket().drop())
    await settle()

    expect(createLiveSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
  })

  it('does not reconnect a session the provider refused', async () => {
    await startSession()
    await act(async () => socket().message({ tokens: [], error_code: 401 }))
    await settle()

    expect(createLiveSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
  })

  it('delivers nothing when the drop happened before anyone spoke and it cannot reconnect', async () => {
    createLiveSession.mockResolvedValueOnce(session).mockRejectedValue(new Error('offline'))
    const { onTranscript } = await startSession()

    await act(async () => socket().drop())
    await settle()
    for (let i = 0; i < 5; i += 1) {
      await act(async () => vi.advanceTimersByTime(5_000))
      await settle()
    }

    expect(onTranscript).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
  })
})

describe('a stop the provider never acknowledges', () => {
  it('delivers the transcript and says the tail may be short', async () => {
    // The stream client manufactures `finished: false` rather than pretending
    // the drain succeeded. Discarding it would hand the doctor a transcript
    // that looks complete and is not, and the tail of a consultation is where
    // the plan usually is.
    const { onTranscript } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [{ text: 'Take one tablet', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 }],
      }),
    )

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    // No `finished` reply: the drain times out.
    await act(async () => {
      vi.advanceTimersByTime(FINISH_TIMEOUT_MS)
    })
    await stopped
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/last few words may be missing/i)
    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0].text).toBe('Take one tablet')
  })

  it('says nothing when the provider does acknowledge it', async () => {
    const { onTranscript } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [{ text: 'Take one tablet', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 }],
      }),
    )
    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
    await settle()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(onTranscript).toHaveBeenCalledTimes(1)
  })
})

describe('a drop during the stop drain', () => {
  it('delivers the transcript once, not twice', async () => {
    // Stop awaits the provider's acknowledgement. If the socket dies inside
    // that wait, both the failure path and the stop path hold a settled
    // transcript, and delivering from both would append the consultation to
    // itself.
    const { onTranscript } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [{ text: 'Selamat pagi', start_ms: 0, end_ms: 900, is_final: true, speaker: 1 }],
      }),
    )

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().drop())
    await stopped
    await settle()

    expect(onTranscript).toHaveBeenCalledTimes(1)
  })
})

describe('unmounting mid-session', () => {
  it('leaves no microphone open, no socket, and no timer', async () => {
    const { onTranscript, onLiveChange, unmount } = await startSession()

    unmount()

    expect(tracks[0]?.stop).toHaveBeenCalled()
    expect(socket().readyState).toBe(FakeWebSocket.CLOSED)
    expect(recorder().state).toBe('inactive')
    // A stop the doctor did not ask for delivers nothing, matching the rule
    // AudioCapture already follows.
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

/**
 * The theatre (#287).
 *
 * The transcript used to be read through whatever height was left under the
 * review page's hero card, which `docs/DESIGN.md` bounds at
 * `calc(100vh-26rem)`. It now opens into its own dialog, and the safety panel
 * goes with it rather than staying behind on a page nobody can see.
 */
describe('the conversation theatre', () => {
  const theatre = () => document.querySelector('dialog')
  const speakerNote = () => screen.queryAllByText(/Speakers are numbered while recording/)

  const props = (onChange = vi.fn()) => ({
    conversationExpanded: true,
    onConversationExpandedChange: onChange,
    prompter: <p>Ask about TB contact history.</p>,
    patientName: 'Rahman bin Abdullah',
  })

  it('opens once the room is being heard, and brings the safety panel with it', async () => {
    await startSession(null, props())

    const dialog = theatre()
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.textContent).toContain('Rahman bin Abdullah')
    // The prompter is inside the dialog, not stranded on the page behind it.
    // A red flag the doctor cannot see is the failure this layout exists to
    // avoid, and it is the reason the panel travels rather than staying put.
    expect(dialog?.textContent).toContain('Ask about TB contact history.')
  })

  it('stays shut until there is something to show', async () => {
    renderAmbient(null, props())
    await settle()

    expect(theatre()?.hasAttribute('open')).toBe(false)
    expect(theatre()?.textContent).toBe('')
  })

  it('mounts exactly one conversation, never two', async () => {
    await startSession(null, props())

    // Both copies carry this line, so counting it counts the panes. Two would
    // read as two conversations to a screen reader, and the hidden one would
    // scroll to follow speech nobody is looking at.
    expect(speakerNote()).toHaveLength(1)
    expect(theatre()?.textContent).toContain('Speakers are numbered while recording')
  })

  it('docks without stopping the session', async () => {
    const onChange = vi.fn()
    const { onLiveChange } = await startSession(null, props(onChange))

    await act(async () => {
      screen.getByRole('button', { name: 'Dock the conversation' }).click()
    })

    expect(onChange).toHaveBeenCalledWith(false)
    // Docking is a view change. The socket is still open, which is what makes
    // Escape a safe way out of a modal covering a live consultation.
    expect(onLiveChange).not.toHaveBeenCalledWith(false)
  })

  it('keeps the short form in the title bar and names no processor there', async () => {
    await startSession(null, props())

    // The owner asked for the short form here. This test used to hold the
    // other half too, that the disclosure survived elsewhere on the page; that
    // paragraph was removed on 10/09/26 (`docs/decisions.md` D-004). What is
    // still worth pinning is that a title bar the doctor reads mid-consultation
    // did not become the residency disclosure by default once the gate stopped
    // being one.
    expect(theatre()?.textContent).toContain('Ambient scribe')
    expect(theatre()?.textContent).not.toMatch(/Soniox/)
  })
})

/*
 * Two-way translation (#393). Synthetic throughout: the Bengali is a question
 * and a one-word answer, the adjacency `findDeniedAbility` reads.
 */
describe('translation', () => {
  const translatedConfig = { ...config, availableTranslations: ['bn', 'ur'] }
  const translatedSession = {
    ...session,
    config: {
      ...session.config,
      languageHints: ['bn', 'en', 'ms'],
      speakerDiarization: false,
      endpointDetection: true,
      translation: { type: 'two_way', languageA: 'bn', languageB: 'en' },
    },
  }

  const UNREADABLE = /[ঀ-৿؀-ۿऀ-ॿ]/u

  const doctorAsks = [
    {
      text: 'Can you swallow?',
      start_ms: 0,
      end_ms: 900,
      is_final: true,
      language: 'en',
      translation_status: 'original',
    },
    {
      text: 'আপনি কি গিলতে পারেন?',
      is_final: true,
      language: 'bn',
      translation_status: 'translation',
      source_language: 'en',
    },
    { text: '<end>', is_final: true },
  ]
  const patientDenies = [
    {
      text: 'না।',
      start_ms: 2_000,
      end_ms: 2_400,
      is_final: true,
      language: 'bn',
      translation_status: 'original',
    },
    {
      text: 'No.',
      is_final: true,
      language: 'en',
      translation_status: 'translation',
      source_language: 'bn',
    },
    { text: '<end>', is_final: true },
  ]

  async function choose(name: string) {
    await act(async () => screen.getByRole('button', { name: "Patient's language" }).click())
    await act(async () => screen.getByRole('option', { name }).click())
  }

  async function startTranslated() {
    liveAsrConfig.mockResolvedValue(translatedConfig)
    createLiveSession.mockResolvedValue(translatedSession)
    const view = renderAmbient()
    await settle()
    await choose('Bengali (Translated)')
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()
    await act(async () => socket().open())
    await settle()
    return view
  }

  it('offers a language only when the API advertises one', async () => {
    renderAmbient()
    await settle()
    expect(screen.queryByRole('button', { name: "Patient's language" })).toBeNull()

    cleanup()
    liveAsrConfig.mockResolvedValue(translatedConfig)
    renderAmbient()
    await settle()
    await act(async () => screen.getByRole('button', { name: "Patient's language" }).click())
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Auto-Detect',
      'Bengali (Translated)',
      'Urdu (Translated)',
    ])
  })

  it('says what auto-detect covers until a translated language is chosen', async () => {
    liveAsrConfig.mockResolvedValue(translatedConfig)
    renderAmbient()
    await settle()
    expect(screen.getByText(/detects english, malay, mandarin and tamil/i)).toBeTruthy()
    expect(screen.getByText(/cantonese is not supported/i)).toBeTruthy()

    await choose('Urdu (Translated)')

    expect(screen.queryByText(/detects english, malay, mandarin and tamil/i)).toBeNull()
    expect(screen.getByText(/translations are machine-generated/i)).toBeTruthy()
  })

  it('asks for the agreement again, in words that name translation, when the language changes', async () => {
    liveAsrConfig.mockResolvedValue(translatedConfig)
    renderAmbient()
    await settle()
    await act(async () => tick().click())
    expect(tick().checked).toBe(true)

    await choose('Bengali (Translated)')

    expect(tick().checked).toBe(false)
    expect(screen.getByRole('checkbox', { name: /machine-translated/i })).toBeTruthy()
  })

  it('asks the API for the chosen pair', async () => {
    await startTranslated()
    expect(createLiveSession).toHaveBeenCalledWith(expect.anything(), 'ambient', true, 'bn')
  })

  it('refuses a session the API minted without translation, before any audio is sent', async () => {
    liveAsrConfig.mockResolvedValue(translatedConfig)
    createLiveSession.mockResolvedValue(session)
    renderAmbient()
    await settle()
    await choose('Bengali (Translated)')
    await act(async () => tick().click())
    await act(async () => startButton().click())
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/translation is not available/i)
    expect(sockets).toHaveLength(0)
    expect(tracks[0]?.stop).toHaveBeenCalled()
  })

  it('feeds the live panes English only, each line carrying the role its language settled', async () => {
    const { onLiveSegments } = await startTranslated()

    await act(async () => socket().message({ tokens: doctorAsks }))
    await act(async () => socket().message({ tokens: patientDenies }))

    const latest = onLiveSegments.mock.calls.at(-1)?.[0]
    expect(latest).toMatchObject([
      { text: 'Can you swallow?', role: 'doctor' },
      { text: 'No.', role: 'patient' },
    ])
    expect(JSON.stringify(onLiveSegments.mock.calls)).not.toMatch(UNREADABLE)
  })

  it('shows each line in the words it was spoken, with its translation beneath', async () => {
    await startTranslated()

    await act(async () => socket().message({ tokens: doctorAsks }))
    await act(async () => socket().message({ tokens: patientDenies }))

    expect(screen.getByText('Can you swallow?')).toBeTruthy()
    const translation = screen.getByText('আপনি কি গিলতে পারেন?')
    expect(translation.getAttribute('lang')).toBe('bn')
    expect(screen.getByText('না।').closest('[lang]')?.getAttribute('lang')).toBe('bn')
    expect(screen.getByText('Bengali')).toBeTruthy()
    expect(screen.getByText(/translations are machine-generated/i)).toBeTruthy()
  })

  it('never lets a turn run across a reconnect (#256)', async () => {
    const { onTranscript } = await startTranslated()
    // The doctor's words settle, then the socket drops before their translation.
    await act(async () => socket().message({ tokens: [doctorAsks[0]] }))
    await act(async () => socket().drop())
    await settle()
    const reopened = sockets[1]
    if (!reopened) throw new Error('no second socket')
    await act(async () => reopened.open())
    await settle()
    await act(async () =>
      reopened.message({
        tokens: [
          {
            text: 'Does it hurt?',
            start_ms: 0,
            end_ms: 900,
            is_final: true,
            language: 'en',
            translation_status: 'original',
          },
          {
            text: 'ব্যথা হয়?',
            is_final: true,
            language: 'bn',
            translation_status: 'translation',
            source_language: 'en',
          },
          { text: '<end>', is_final: true },
        ],
      }),
    )

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => reopened.message({ tokens: [], finished: true }))
    await stopped
    await settle()

    const delivered = onTranscript.mock.calls[0]?.[0]
    expect(delivered.draftTurns.map((turn: { text: string }) => turn.text)).toEqual([
      'Can you swallow?',
      'Does it hurt?',
    ])
    expect(delivered.otherLanguages[1]).toMatchObject({ text: 'ব্যথা হয়?' })
    expect(delivered.otherLanguages[0]?.text).not.toBe('ব্যথা হয়?')
  })

  it('delivers the pairs with the roles its languages settled, and no labelling pass', async () => {
    const { onTranscript } = await startTranslated()

    await act(async () => socket().message({ tokens: doctorAsks }))
    await act(async () => socket().message({ tokens: patientDenies }))

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
    await settle()

    expect(draftHostedTurns).not.toHaveBeenCalled()
    expect(onTranscript).toHaveBeenCalledTimes(1)
    const delivered = onTranscript.mock.calls[0]?.[0]
    expect(delivered).toMatchObject({
      source: 'asr_live',
      text: 'Can you swallow? No.',
      translation: 'bn',
      draftTurns: [
        { speaker: 'doctor', text: 'Can you swallow?' },
        { speaker: 'patient', text: 'No.' },
      ],
      otherLanguages: [
        { language: 'bn', text: 'আপনি কি গিলতে পারেন?', spoken: false },
        { language: 'bn', text: 'না।', spoken: true },
      ],
    })
    expect(delivered.text).not.toMatch(UNREADABLE)
  })
})

/*
 * Refinement after Stop (#436, docs/trd.md §20.14). The finished recording is
 * re-transcribed in one batch pass and that transcript replaces the live one,
 * but only when every check passes; any failure keeps the live transcript and
 * says so.
 */
describe('refining the transcript after Stop', () => {
  const refinedConfig = { ...config, batchRefinement: true }

  const heard = (text: string, start: number, end: number, speaker: number) => ({
    text,
    start_ms: start,
    end_ms: end,
    is_final: true,
    speaker,
  })

  /** What the live socket heard, including the negation flip. */
  const LIVE_TOKENS = [
    heard('Tak ada batuk doktor.', 0, 1_500, 2),
    heard(' Berapa lama sudah batuk?', 4_000, 5_500, 1),
  ]

  const LIVE_TEXT = 'Tak ada batuk doktor. Berapa lama sudah batuk?'
  const REFINED_TEXT = 'Ada batuk sikit doktor. Berapa lama sudah batuk?'

  async function startRefinable(extra: Partial<AmbientProps> = {}) {
    liveAsrConfig.mockResolvedValue(refinedConfig)
    const view = await startSession(null, extra)
    await act(async () => socket().message({ tokens: LIVE_TOKENS }))
    // A minute of consultation, so the density row has a minute to judge.
    await act(async () => vi.advanceTimersByTime(60_000))
    return view
  }

  /**
   * Presses Stop and, unless told not to, lets the provider acknowledge,
   * leaving refinement to run.
   */
  async function pressStop({ acknowledged = true }: { acknowledged?: boolean } = {}) {
    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    if (acknowledged) await act(async () => socket().message({ tokens: [], finished: true }))
    await stopped
  }

  async function drain() {
    for (let i = 0; i < 6; i += 1) await settle()
  }

  /** An upload that only ever ends when its signal fires. */
  const hangingUpload = () =>
    transcribeRecording.mockImplementation(
      (_session: unknown, _recording: Blob, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () =>
            resolve({ ok: false, reason: 'aborted', sent: true }),
          )
        }),
    )

  const delivered = (onTranscript: ReturnType<typeof vi.fn>) => {
    expect(onTranscript).toHaveBeenCalledTimes(1)
    return onTranscript.mock.calls[0]?.[0]
  }

  it('uses the refined transcript when every check passes', async () => {
    const { onTranscript } = await startRefinable()

    await pressStop()
    await drain()

    const result = delivered(onTranscript)
    expect(result.text).toBe(REFINED_TEXT)
    expect(result.source).toBe('asr_live')
    expect(result.batchTranscription).toEqual({ used: true })
    // Roles come from the same vote as the live path: the voices travel on the
    // segments, numbered from one.
    expect(result.segments.map((s: { speaker: string }) => s.speaker)).toEqual(['2', '1'])
    expect(toast).not.toHaveBeenCalled()
  })

  it('mints for the recording it holds, with its duration', async () => {
    await startRefinable()

    await pressStop()
    await drain()

    expect(createBatchSession).toHaveBeenCalledTimes(1)
    const [signal, durationSeconds] = createBatchSession.mock.calls[0] ?? []
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(durationSeconds).toBeGreaterThanOrEqual(60)
    expect(durationSeconds).toBeLessThan(65)
  })

  it('uploads the recording once, and keeps the same one for playback', async () => {
    const { onTranscript } = await startRefinable()

    await pressStop()
    await drain()

    expect(transcribeRecording).toHaveBeenCalledTimes(1)
    const [sentSession, recording] = transcribeRecording.mock.calls[0] ?? []
    expect(sentSession).toEqual(BATCH_SESSION)
    expect(recording).toBeInstanceOf(Blob)
    expect(delivered(onTranscript).audio).toBe(recording)
  })

  it('asks the rules engine about both readings before using the refined one', async () => {
    await startRefinable()

    await pressStop()
    await drain()

    expect(refinementCheck).toHaveBeenCalledWith(
      ['Tak ada batuk doktor.', 'Berapa lama sudah batuk?'],
      ['Ada batuk sikit doktor.', 'Berapa lama sudah batuk?'],
      expect.any(AbortSignal),
    )
  })

  it('labels the refined text, not the live one', async () => {
    await startRefinable()

    await pressStop()
    await drain()

    expect(draftHostedTurns).toHaveBeenCalledWith(REFINED_TEXT, expect.any(AbortSignal))
  })

  it('says it is refining, and offers the live transcript instead, naming no vendor', async () => {
    hangingUpload()
    await startRefinable()

    await pressStop()
    await settle()

    expect(screen.getByText('Refining the transcript')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use Live Transcript' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ElevenLabs|Soniox|scribe_v2/i)
  })

  it('holds the live latch until the transcript is delivered', async () => {
    // Consultation Settings stay locked and the leave-page guard holds while
    // the recording is being refined, exactly as while it is being heard.
    hangingUpload()
    const { onLiveChange, onTranscript } = await startRefinable()

    await pressStop()
    await settle()

    expect(onLiveChange).not.toHaveBeenCalledWith(false)
    expect(onTranscript).not.toHaveBeenCalled()

    await act(async () => screen.getByRole('button', { name: 'Use Live Transcript' }).click())
    await drain()

    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
  })

  describe('every failure keeps the live transcript, and says so', () => {
    const expectLiveWithNotice = (onTranscript: ReturnType<typeof vi.fn>) => {
      const result = delivered(onTranscript)
      expect(result.text).toBe(LIVE_TEXT)
      const notice = /could not be refined/i
      expect(screen.getByRole('status').textContent).toMatch(notice)
      // The panel unmounts once the transcript saves, so the notice also goes
      // where it outlives the panel.
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(notice), expect.anything())
      expect(String(toast.mock.calls[0]?.[0])).not.toMatch(/ElevenLabs/i)
      expect(screen.getByRole('status').textContent).not.toMatch(/ElevenLabs|Soniox/i)
      // Raised once the transcript is handed over, so it outlives the panel.
      expect(toast.mock.invocationCallOrder[0]).toBeGreaterThan(
        onTranscript.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      )
      return result
    }

    it('when the token cannot be minted, recording no upload', async () => {
      createBatchSession.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'nope'))
      const { onTranscript } = await startRefinable()

      await pressStop()
      await drain()

      const result = expectLiveWithNotice(onTranscript)
      // Nothing left the device, so nothing is recorded as uploaded.
      expect(result.batchTranscription).toBeUndefined()
      expect(transcribeRecording).not.toHaveBeenCalled()
    })

    it.each(['rejected', 'rate_limited', 'unavailable', 'invalid_response'])(
      'when the upload fails as %s, recording the upload as unused',
      async (reason) => {
        transcribeRecording.mockResolvedValue({ ok: false, reason, sent: true })
        const { onTranscript } = await startRefinable()

        await pressStop()
        await drain()

        // The audio left whether or not a transcript came back.
        expect(expectLiveWithNotice(onTranscript).batchTranscription).toEqual({ used: false })
        expect(refinementCheck).not.toHaveBeenCalled()
      },
    )

    it('when the upload was refused before sending, recording no upload', async () => {
      transcribeRecording.mockResolvedValue({ ok: false, reason: 'refused', sent: false })
      const { onTranscript } = await startRefinable()

      await pressStop()
      await drain()

      expect(expectLiveWithNotice(onTranscript).batchTranscription).toBeUndefined()
    })

    it('when the refined transcript fails a sanity row', async () => {
      // One voice where the live socket heard two: the merge §20.13 measured.
      transcribeRecording.mockResolvedValue({
        ok: true,
        sent: true,
        words: REFINED_WORDS.map((entry) => ({ ...entry, speaker_id: 'speaker_0' })),
      })
      const { onTranscript } = await startRefinable()

      await pressStop()
      await drain()

      expect(expectLiveWithNotice(onTranscript).batchTranscription).toEqual({ used: false })
      expect(refinementCheck).not.toHaveBeenCalled()
    })

    it('when the refined transcript would lose a red flag', async () => {
      refinementCheck.mockResolvedValue([
        {
          id: 'haemoptysis',
          label: 'Coughing up blood',
          severity: 'emergency',
          evidence: 'batuk berdarah',
          source: 'rule',
          ruleId: 'haemoptysis',
        },
      ])
      const { onTranscript } = await startRefinable()

      await pressStop()
      await drain()

      expect(expectLiveWithNotice(onTranscript).batchTranscription).toEqual({ used: false })
    })

    it('when the red-flag check itself fails', async () => {
      refinementCheck.mockRejectedValue(new ApiError(429, 'rate_limited', 'slow down'))
      const { onTranscript } = await startRefinable()

      await pressStop()
      await drain()

      expect(expectLiveWithNotice(onTranscript).batchTranscription).toEqual({ used: false })
    })

    it('when the bound runs out', async () => {
      hangingUpload()
      const { onTranscript } = await startRefinable()

      await pressStop()
      await settle()
      expect(onTranscript).not.toHaveBeenCalled()

      // A minute of recording is bounded at the one-minute floor.
      await act(async () => vi.advanceTimersByTime(59_000))
      await settle()
      expect(onTranscript).not.toHaveBeenCalled()

      await act(async () => vi.advanceTimersByTime(1_500))
      await drain()

      expect(expectLiveWithNotice(onTranscript).batchTranscription).toEqual({ used: false })
    })
  })

  it('uses the live transcript at once when the doctor skips, and says it was skipped', async () => {
    hangingUpload()
    const { onTranscript } = await startRefinable()

    await pressStop()
    await settle()
    const signal = transcribeRecording.mock.calls[0]?.[2] as AbortSignal
    await act(async () => screen.getByRole('button', { name: 'Use Live Transcript' }).click())
    await drain()

    expect(signal.aborted).toBe(true)
    const result = delivered(onTranscript)
    expect(result.text).toBe(LIVE_TEXT)
    expect(result.batchTranscription).toEqual({ used: false })
    expect(screen.getByRole('status').textContent).toMatch(/skipped/i)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/skipped/i), expect.anything())
  })

  it('stops the check too when the doctor skips while it runs', async () => {
    refinementCheck.mockImplementation(
      (_live: unknown, _refined: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { onTranscript } = await startRefinable()

    await pressStop()
    await drain()
    expect(refinementCheck).toHaveBeenCalledTimes(1)
    await act(async () => screen.getByRole('button', { name: 'Use Live Transcript' }).click())
    await drain()

    expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
    expect(delivered(onTranscript).batchTranscription).toEqual({ used: false })
  })

  it('moves focus to Use Live Transcript when refining starts', async () => {
    hangingUpload()
    await startRefinable()

    await pressStop()
    await settle()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use Live Transcript' }))
  })

  it('checks the turns that will be stored, and delivers exactly those', async () => {
    /*
     * The labelling pass runs on the refined text before the check, because
     * where turns break changes what the rules raise; the check then reads the
     * labelled turns, and those are what is delivered, never re-labelled.
     */
    const labelled = [
      { speaker: 'patient' as const, text: 'Ada batuk sikit doktor.' },
      { speaker: 'doctor' as const, text: 'Berapa lama sudah batuk?' },
    ]
    draftHostedTurns.mockResolvedValue(labelled)
    const { onTranscript } = await startRefinable()

    await pressStop()
    await drain()

    expect(draftHostedTurns).toHaveBeenCalledTimes(1)
    expect(draftHostedTurns).toHaveBeenCalledWith(REFINED_TEXT, expect.any(AbortSignal))
    expect(refinementCheck.mock.calls[0]?.[1]).toEqual(labelled.map((turn) => turn.text))
    expect(delivered(onTranscript).draftTurns).toEqual(labelled)
  })

  it('labels the live text after a refined transcript is refused', async () => {
    refinementCheck.mockResolvedValue([
      {
        id: 'chest-pain',
        label: 'Chest pain',
        severity: 'urgent',
        evidence: 'chest pain',
        source: 'rule',
        ruleId: 'chest-pain',
      },
    ])
    const { onTranscript } = await startRefinable()

    await pressStop()
    await drain()

    expect(draftHostedTurns.mock.calls.map((call) => call[0])).toEqual([REFINED_TEXT, LIVE_TEXT])
    expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
  })

  it('starts no upload when the panel is unmounted while finishing', async () => {
    const view = await startRefinable()

    const stopped = act(async () => {
      screen.getByRole('button', { name: /stop and finish/i }).click()
    })
    await settle()
    view.unmount()
    await act(async () => vi.advanceTimersByTime(FINISH_TIMEOUT_MS))
    await stopped
    await drain()

    expect(createBatchSession).not.toHaveBeenCalled()
    expect(transcribeRecording).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('stops the upload when the panel is unmounted while refining, and says nothing', async () => {
    hangingUpload()
    const view = await startRefinable()

    await pressStop()
    await settle()
    const signal = transcribeRecording.mock.calls[0]?.[2] as AbortSignal
    view.unmount()
    await drain()

    expect(signal.aborted).toBe(true)
    expect(createBatchSession).toHaveBeenCalledTimes(1)
    expect(refinementCheck).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('holds the latch through labelling, refined or not', async () => {
    let finishLabelling: (turns: unknown) => void = () => {}
    draftHostedTurns.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLabelling = resolve
        }),
    )
    const { onLiveChange, onTranscript } = await startRefinable({ refineAfterStop: false })

    await pressStop()
    await drain()
    expect(screen.getByText('Drafting speaker labels')).toBeTruthy()
    expect(onLiveChange).not.toHaveBeenCalledWith(false)

    await act(async () => finishLabelling([]))
    await drain()

    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
  })

  it('refines a recording exactly at the bound', async () => {
    await startRefinable()
    await act(async () => vi.advanceTimersByTime(1_800_000))

    await pressStop()
    await drain()

    expect(createBatchSession).toHaveBeenCalledWith(expect.any(AbortSignal), 1_860)
  })

  it('uploads nothing when there is no recording to send', async () => {
    const { onTranscript } = await startRefinable()
    // A recorder that hands over nothing: no chunk ever reached the archive.
    recorder().stop = function stop(this: FakeMediaRecorder) {
      this.state = 'inactive'
      queueMicrotask(() => this.onstop?.())
    }

    await pressStop()
    await drain()

    expect(createBatchSession).not.toHaveBeenCalled()
    expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
  })

  it('clears the short-tail notice once the refined reading runs to the end', async () => {
    // Read from the whole recording, so the gap the notice warned about is not
    // in it, provided its words reach the end of what was recorded.
    transcribeRecording.mockResolvedValue({
      ok: true,
      sent: true,
      words: [...REFINED_WORDS, ...vendorSentence('Jumpa lagi doktor.', 58, 'speaker_1')],
    })
    const { onTranscript } = await startRefinable()

    await pressStop({ acknowledged: false })
    await act(async () => vi.advanceTimersByTime(FINISH_TIMEOUT_MS))
    await drain()

    expect(delivered(onTranscript).text).toBe(`${REFINED_TEXT} Jumpa lagi doktor.`)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the short-tail notice when the refined reading stops short of the end', async () => {
    // Accepted, because it reaches where the live transcript ended; but that
    // is where the tail was lost, so the warning still stands.
    const { onTranscript } = await startRefinable()

    await pressStop({ acknowledged: false })
    await act(async () => vi.advanceTimersByTime(FINISH_TIMEOUT_MS))
    await drain()

    expect(delivered(onTranscript).text).toBe(REFINED_TEXT)
    expect(screen.getByRole('alert').textContent).toMatch(/last few words may be missing/i)
  })

  it('keeps the short-tail notice when the live transcript is used', async () => {
    transcribeRecording.mockResolvedValue({ ok: false, reason: 'unavailable', sent: true })
    await startRefinable()

    await pressStop({ acknowledged: false })
    await act(async () => vi.advanceTimersByTime(FINISH_TIMEOUT_MS))
    await drain()

    expect(screen.getByRole('alert').textContent).toMatch(/last few words may be missing/i)
  })

  describe('never refines', () => {
    it('when the API does not offer it', async () => {
      liveAsrConfig.mockResolvedValue(config)
      const { onTranscript } = await startSession()
      await act(async () => socket().message({ tokens: LIVE_TOKENS }))
      await act(async () => vi.advanceTimersByTime(60_000))

      await pressStop()
      await drain()

      expect(createBatchSession).not.toHaveBeenCalled()
      expect(delivered(onTranscript).batchTranscription).toBeUndefined()
      expect(toast).not.toHaveBeenCalled()
    })

    it('when this device has opted out', async () => {
      const { onTranscript } = await startRefinable({ refineAfterStop: false })

      await pressStop()
      await drain()

      expect(createBatchSession).not.toHaveBeenCalled()
      expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
      expect(toast).not.toHaveBeenCalled()
    })

    it('when nobody spoke', async () => {
      liveAsrConfig.mockResolvedValue(refinedConfig)
      const { onTranscript } = await startSession()
      await act(async () => vi.advanceTimersByTime(60_000))

      await pressStop()
      await drain()

      expect(createBatchSession).not.toHaveBeenCalled()
      expect(onTranscript).not.toHaveBeenCalled()
    })

    it('when the connection dropped and capture stopped on its own', async () => {
      createLiveSession.mockResolvedValueOnce(session).mockRejectedValue(new Error('offline'))
      const { onTranscript } = await startRefinable()

      await act(async () => socket().drop())
      await settle()
      for (let i = 0; i < 5; i += 1) {
        await act(async () => vi.advanceTimersByTime(5_000))
        await settle()
      }
      await drain()

      expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
      expect(createBatchSession).not.toHaveBeenCalled()
      expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
    })

    it('when the recording runs past the bound', async () => {
      const { onTranscript } = await startRefinable()
      await act(async () => vi.advanceTimersByTime(1_801_000))

      await pressStop()
      await drain()

      expect(createBatchSession).not.toHaveBeenCalled()
      expect(delivered(onTranscript).text).toBe(LIVE_TEXT)
    })

    it('on a translated session, which the grant does not cover', async () => {
      liveAsrConfig.mockResolvedValue({
        ...refinedConfig,
        availableTranslations: ['bn'],
      })
      createLiveSession.mockResolvedValue({
        ...session,
        config: {
          ...session.config,
          languageHints: ['bn', 'en', 'ms'],
          speakerDiarization: false,
          endpointDetection: true,
          translation: { type: 'two_way', languageA: 'bn', languageB: 'en' },
        },
      })
      const { onTranscript } = renderAmbient()
      await settle()
      await act(async () => screen.getByRole('button', { name: "Patient's language" }).click())
      await act(async () => screen.getByRole('option', { name: 'Bengali (Translated)' }).click())
      await act(async () => tick().click())
      await act(async () => startButton().click())
      await settle()
      await act(async () => socket().open())
      await settle()
      await act(async () =>
        socket().message({
          tokens: [
            {
              text: 'Any cough?',
              start_ms: 0,
              end_ms: 900,
              is_final: true,
              language: 'en',
              translation_status: 'original',
            },
            { text: '<end>', is_final: true },
          ],
        }),
      )
      await act(async () => vi.advanceTimersByTime(60_000))

      await pressStop()
      await drain()

      expect(createBatchSession).not.toHaveBeenCalled()
      expect(transcribeRecording).not.toHaveBeenCalled()
      expect(onTranscript).toHaveBeenCalledTimes(1)
    })
  })

  it('reports whether refinement is on offer, so the settings can show its switch', async () => {
    const onRefinementAvailable = vi.fn()
    liveAsrConfig.mockResolvedValue(refinedConfig)
    renderAmbient(null, { onRefinementAvailable })
    await settle()
    expect(onRefinementAvailable).toHaveBeenLastCalledWith(true)

    cleanup()
    liveAsrConfig.mockResolvedValue(config)
    renderAmbient(null, { onRefinementAvailable })
    await settle()
    expect(onRefinementAvailable).toHaveBeenLastCalledWith(false)
  })
})
