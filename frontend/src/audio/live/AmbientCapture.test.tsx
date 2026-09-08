import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api.js'
import { AmbientCapture, TIMESLICE_MS } from './AmbientCapture.js'
import { FINISH_TIMEOUT_MS } from './soniox-stream.js'

const liveAsrConfig = vi.hoisted(() => vi.fn())
const createLiveSession = vi.hoisted(() => vi.fn())
const draftHostedTurns = vi.hoisted(() => vi.fn())

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api.js')>('../../lib/api.js')
  return {
    ApiError: actual.ApiError,
    api: { liveAsrConfig, createLiveSession, draftHostedTurns },
  }
})

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
    expect(gate?.textContent).toMatch(/leaves this device/i)
    expect(gate?.textContent).toMatch(/Soniox/)
    expect(within(gate as HTMLElement).getByRole('checkbox', { name: /agreed/i })).toBeTruthy()
  })
})

describe('consent', () => {
  it('names the provider, the region, and that our server never holds the audio', async () => {
    renderAmbient()
    await settle()

    const disclosure = screen.getByText(/leaves this device/i)
    expect(disclosure.textContent).toMatch(/Soniox/)
    expect(disclosure.textContent).toMatch(/United States/)
    expect(disclosure.textContent).toMatch(/never receives the audio/i)
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

describe('a dropped connection', () => {
  it('keeps what was already transcribed and says capture stopped', async () => {
    const { onTranscript } = await startSession()

    await act(async () =>
      socket().message({
        tokens: [
          { text: 'I have had a cough', start_ms: 0, end_ms: 900, is_final: true, speaker: 2 },
          { text: ' for th', start_ms: 900, end_ms: 1100, is_final: false, speaker: 2 },
        ],
      }),
    )
    await act(async () => socket().drop())
    await settle()

    expect(screen.getByRole('alert').textContent).toMatch(/capture stopped/i)
    expect(screen.getByRole('alert').textContent).toMatch(/connection/i)
    expect(tracks[0]?.stop).toHaveBeenCalled()
    // Settled text is a true record of the consultation; the unsettled tail is
    // not, so it goes.
    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript.mock.calls[0]?.[0].text).toBe('I have had a cough')
  })

  it('delivers nothing when the drop happened before anyone spoke', async () => {
    const { onTranscript } = await startSession()

    await act(async () => socket().drop())
    await settle()

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

  it('keeps the processor and its region in the consent gate, not the title bar', async () => {
    await startSession(null, props())

    // The owner asked for the short form in the dialog header. The disclosure
    // itself is a data-residency consent statement and stays whole: this test
    // exists so trimming the header cannot quietly trim the consent too.
    expect(theatre()?.textContent).toContain('Ambient scribe')
    expect(theatre()?.textContent).not.toMatch(/Soniox/)
    expect(document.body.textContent).toMatch(/Soniox/)
  })
})
