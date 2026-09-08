import { type DraftTurn, MAX_DRAFT_TEXT_CHARACTERS } from '@shared/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AudioCapture,
  LABEL_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from './AudioCapture.js'
import type { WorkerResponse } from './protocol.js'

/**
 * The relay client and the labelling client, mocked so the hosted path can be
 * driven without a network. Hoisted because `vi.mock` is lifted above the
 * imports.
 */
const { transcribeHostedAsr, draftHostedTurns } = vi.hoisted(() => ({
  transcribeHostedAsr: vi.fn(),
  draftHostedTurns: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: { transcribeHostedAsr, draftHostedTurns } }))

/**
 * The component's side of the wedge contract (issues #138 and #139): every
 * wait on the record path is bounded by a silence budget, the doctor can
 * cancel without reloading, no exit leaves a worker or a timer behind, and
 * the status never claims completion while work is still running.
 *
 * jsdom has no Worker, no audio pipeline and reports thin hardware, so all
 * three are stubbed. The stubs are driven, not observed: tests reply as the
 * worker would and advance the fake clock, then assert what the doctor sees.
 */

/** Every worker the component builds, so tests can drive replies into each. */
const workers: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    workers.push(this)
  }

  /** Delivers a worker message the way the browser would, inside act. */
  reply(message: WorkerResponse) {
    act(() => {
      this.onmessage?.(new MessageEvent('message', { data: message }))
    })
  }

  /** The global error event a worker emits when its module fails or it dies. */
  die() {
    act(() => {
      this.onerror?.(new ErrorEvent('error', { message: 'worker died' }))
    })
  }
}

/** Indexed access under noUncheckedIndexedAccess, asserted present. */
function spawned(index = 0): FakeWorker {
  const instance = workers[index]
  if (!instance) throw new Error(`expected worker ${index} to exist`)
  return instance
}

/** Every recorder the component builds, so tests can drive its stop. */
const recorders: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  /** Modelled because the teardown path reads it before stopping (issue #140). */
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  /** Real recorders expose the stream they were built on; teardown needs it. */
  readonly stream: { getTracks: () => { stop: () => void }[] }
  start = vi.fn(() => {
    this.state = 'recording'
  })
  pause = vi.fn(() => {
    this.state = 'paused'
  })
  resume = vi.fn(() => {
    this.state = 'recording'
  })

  constructor(stream: { getTracks: () => { stop: () => void }[] }) {
    this.stream = stream
    recorders.push(this)
  }

  /** The browser fires these after stop() returns, never inside it. */
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['pcm']) })
      this.onstop?.()
    })
  }
}

/** Swappable per test, so microphone access can be made to fail. */
let getUserMedia: () => Promise<{ getTracks: () => { stop: () => void }[] }>
let tracks: { stop: ReturnType<typeof vi.fn> }[]

/** Every constraints object handed to getUserMedia, so tests can pin them. */
let gumCalls: unknown[]

/** Swappable per test, so a decode can be made to hang or settle late. */
let decodeAudioData: () => Promise<unknown>

class FakeAudioContext {
  decodeAudioData(_bytes: ArrayBuffer) {
    return decodeAudioData()
  }
  close = vi.fn(async () => {})
}

class FakeOfflineAudioContext {
  destination = {}
  createBufferSource() {
    return { buffer: null as unknown, connect: () => {}, start: () => {} }
  }
  async startRendering() {
    return { getChannelData: () => new Float32Array(16) }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  workers.length = 0
  recorders.length = 0
  // Models `fetch`: hangs until the caller's signal aborts, then rejects the
  // way an aborted request does. Tests that want a settled upload override it.
  transcribeHostedAsr.mockReset()
  transcribeHostedAsr.mockImplementation(
    (_blob: Blob, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      }),
  )
  // Rejects promptly by default, the same outcome a caller with no labelling
  // client sees: labelling is a bonus on top of a transcription already in
  // hand, so a test that does not care about it must not have to wait out a
  // hang before its own assertions can run.
  draftHostedTurns.mockReset()
  draftHostedTurns.mockRejectedValue(new Error('not configured'))
  decodeAudioData = async () => ({ duration: 1 })
  tracks = [{ stop: vi.fn() }]
  gumCalls = []
  getUserMedia = async () => ({ getTracks: () => tracks })
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  // jsdom has no mediaDevices at all, so this defines rather than spies.
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: (constraints: unknown) => {
        gumCalls.push(constraints)
        return getUserMedia()
      },
    },
    configurable: true,
  })
  // jsdom reports few cores and no memory, and the hardware floor would hide
  // the whole control cluster, so pin the machine capable.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
  // jsdom's Blob has no arrayBuffer at all, so this defines rather than spies.
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value: async () => new ArrayBuffer(8),
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  // cleanup() must run while the fake clock is still installed: unmount
  // clears timer handles, and clearing fake handles with the real function
  // leaks them into the next test's vi.getTimerCount().
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

function renderCapture(
  engine: 'local' | 'hosted' = 'local',
  transcript = '',
  onBusyChange = vi.fn(),
) {
  const onTranscript = vi.fn()
  const view = render(
    <AudioCapture
      onTranscript={onTranscript}
      onBusyChange={onBusyChange}
      engine={engine}
      transcript={transcript}
    />,
  )
  return { onTranscript, onBusyChange, ...view }
}

function pickFile() {
  fireEvent.change(screen.getByLabelText(/use an audio file/i), {
    target: { files: [new File(['audio'], 'clip.wav', { type: 'audio/wav' })] },
  })
}

/*
 * The engine is no longer a control on this screen: it is the device's standing
 * preference from the Audio dialog, arriving as a prop (owner's decision,
 * 2026-09-02). Hosted tests mount with `engine='hosted'`; the ones that flip
 * mid-test rerender, the way the same component re-renders when the doctor
 * saves a new choice in the dialog.
 */

/** The one hosted line the GP-facing screen still carries, per the docstring. */
const hostedRestatement = () => screen.getByText(/this recording leaves this device/i)

/** The signal handed to the relay on the most recent upload. */
function uploadSignal(): AbortSignal {
  const call = transcribeHostedAsr.mock.calls.at(-1)
  if (!call) throw new Error('expected an upload to have been attempted')
  return call[1] as AbortSignal
}

/** Never settles until its signal aborts, the same shape as the relay's own default. */
function hangUntilAborted(mock: ReturnType<typeof vi.fn>) {
  mock.mockImplementation(
    (_text: string, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      }),
  )
}

/** Whether any worker was ever asked to transcribe, as opposed to prewarm. */
const transcribeRequests = () =>
  workers.flatMap((instance) =>
    instance.postMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string } | undefined)?.type === 'transcribe',
    ),
  )

const startButton = () =>
  screen.getByRole('button', { name: /start recording/i }) as HTMLButtonElement

const stopButton = () => screen.getByRole('button', { name: /stop and transcribe/i })

async function startRecording() {
  fireEvent.click(startButton())
  await settle()
}

async function stopRecording() {
  fireEvent.click(stopButton())
  await settle()
}

/** The per-consultation tick the hosted path needs before it will send (#254). */
const consentBox = () => screen.getByRole('checkbox', { name: /agreed/i }) as HTMLInputElement

/*
 * Called explicitly by every hosted test rather than folded into
 * `renderCapture`. A helper that ticked the box for everyone would hide the
 * gate from the whole suite, which is the opposite of what it is for: each
 * hosted test should show, on its own face, that the relay is unreachable
 * until someone agrees.
 */
const agree = () => fireEvent.click(consentBox())

describe('capture ownership reporting', () => {
  it('reports recording as busy and returns to idle after cancellation', async () => {
    const onBusyChange = vi.fn()
    renderCapture('local', '', onBusyChange)

    expect(onBusyChange).not.toHaveBeenCalled()
    await startRecording()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)

    await stopRecording()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
})

describe('the silence budget', () => {
  it('terminates a worker that stays silent and points at typing or pasting', async () => {
    renderCapture()
    pickFile()
    await settle()
    expect(workers).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS)
    })

    expect(spawned().terminate).toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/type or paste/i)
    expect(startButton().disabled).toBe(false)
  })

  it('bounds the audio decode too, before any worker exists', async () => {
    decodeAudioData = () => new Promise(() => {})
    renderCapture()
    pickFile()
    await settle()
    expect(workers).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS)
    })

    expect(screen.getByRole('alert').textContent).toMatch(/type or paste/i)
    expect(workers).toHaveLength(0)
  })

  it('is rearmed by every worker message, so a slow healthy run is never cut off', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()

    const feed: WorkerResponse[] = [
      { type: 'progress', loaded: 1, total: 10 },
      { type: 'ready' },
      { type: 'alive' },
      { type: 'transcribing', done: 1, total: 9 },
      { type: 'alive' },
    ]
    for (const message of feed) {
      act(() => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1000)
      })
      worker.reply(message)
    }

    expect(worker.terminate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is cleared by a result, so no alert lands after success', async () => {
    const { onTranscript } = renderCapture()
    pickFile()
    await settle()
    const worker = spawned()
    worker.reply({ type: 'ready' })
    worker.reply({ type: 'result', text: 'hello', segments: [] })

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2)
    })

    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hello',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('is cleared by finishing, so a long merge tail is never killed', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()
    worker.reply({ type: 'ready' })
    worker.reply({ type: 'transcribing', done: 15, total: 15 })
    worker.reply({ type: 'finishing' })

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 3)
    })

    expect(worker.terminate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    screen.getAllByText(/finishing up/i)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.queryByText(/left/)).toBeNull()
    expect(document.querySelector('.busy-spinner')).not.toBeNull()
  })
})

describe('cancel', () => {
  it('terminates immediately, shows no error, and restores the controls', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(worker.terminate).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(startButton().disabled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('during the decode builds no worker and leaves no timer', async () => {
    let releaseDecode: () => void = () => {}
    decodeAudioData = () =>
      new Promise((resolve) => {
        releaseDecode = () => resolve({ duration: 1 })
      })
    renderCapture()
    pickFile()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    releaseDecode()
    await settle()

    expect(workers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops a message already queued behind the cancel', async () => {
    const { onTranscript } = renderCapture()
    pickFile()
    await settle()
    const worker = spawned()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    worker.reply({ type: 'result', text: 'late', segments: [] })

    expect(onTranscript).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('unmount', () => {
  it('mid-run terminates the worker and leaves no timer', async () => {
    const { unmount } = renderCapture()
    pickFile()
    await settle()
    const worker = spawned()

    unmount()

    expect(worker.terminate).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('mid-decode builds no worker and leaves no timer', async () => {
    let releaseDecode: () => void = () => {}
    decodeAudioData = () =>
      new Promise((resolve) => {
        releaseDecode = () => resolve({ duration: 1 })
      })
    const { unmount } = renderCapture()
    pickFile()
    await settle()

    unmount()
    releaseDecode()
    await settle()

    expect(workers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('a dying worker', () => {
  it('surfaces as a visible, actionable error instead of an endless spinner', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()

    worker.die()

    expect(worker.terminate).toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/try again, or type or paste/i)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('what the status claims', () => {
  it('switches to opening copy at 100 per cent instead of claiming a finished download', async () => {
    renderCapture()
    pickFile()
    await settle()

    spawned().reply({ type: 'progress', loaded: 500, total: 500 })

    screen.getAllByText(/opening the speech model/i)
    expect(screen.queryByText(/downloading the speech model, 100/i)).toBeNull()
  })

  it('shows no bar when the host reported no sizes', async () => {
    renderCapture()
    pickFile()
    await settle()

    spawned().reply({ type: 'progress', loaded: 42, total: 0 })

    expect(screen.queryByRole('progressbar')).toBeNull()
    screen.getAllByText(/preparing the speech model/i)
  })

  it('resets stale download progress when a second run starts', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()
    worker.reply({ type: 'progress', loaded: 500, total: 500 })
    worker.reply({ type: 'ready' })
    worker.reply({ type: 'result', text: 'one', segments: [] })

    pickFile()
    await settle()

    screen.getAllByText(/preparing the speech model/i)
    expect(screen.queryByText(/opening the speech model/i)).toBeNull()
  })
})

describe('try again', () => {
  it('retries the same recording on a fresh worker after a stall', async () => {
    renderCapture()
    pickFile()
    await settle()
    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS)
    })
    expect(workers).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await settle()

    expect(workers).toHaveLength(2)
    expect(spawned(1).postMessage).toHaveBeenCalledTimes(1)
  })
})

describe('prewarming the speech model', () => {
  it('pauses and resumes the same recorder while freezing the elapsed clock', async () => {
    renderCapture()
    await startRecording()
    const media = recorders[0]
    if (!media) throw new Error('expected a recorder')

    act(() => vi.advanceTimersByTime(2000))
    screen.getByText('0:02')
    fireEvent.click(screen.getByRole('button', { name: 'Pause Recording' }))

    expect(media.pause).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.getByText(/audio is not being added/i)).toBeTruthy()
    act(() => vi.advanceTimersByTime(5000))
    screen.getByText('0:02')

    fireEvent.click(screen.getByRole('button', { name: 'Resume Recording' }))
    expect(media.resume).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1000))
    screen.getByText('0:03')
  })

  it('stops and transcribes from paused state without replacing the recorder', async () => {
    const { onTranscript } = renderCapture()
    await startRecording()
    const media = recorders[0]
    if (!media) throw new Error('expected a recorder')

    fireEvent.click(screen.getByRole('button', { name: 'Pause Recording' }))
    await stopRecording()

    expect(recorders).toEqual([media])
    expect(media.state).toBe('inactive')
    spawned().reply({ type: 'ready' })
    spawned().reply({ type: 'result', text: 'paused capture', segments: [] })
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'paused capture',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
  })

  it('posts a load request to a fresh worker when recording starts', async () => {
    renderCapture()
    await startRecording()

    expect(workers).toHaveLength(1)
    expect(spawned().postMessage).toHaveBeenCalledTimes(1)
    expect(spawned().postMessage).toHaveBeenCalledWith({ type: 'load' })
    stopButton()
  })

  it('keeps the recording UI untouched by prewarm progress and ready', async () => {
    renderCapture()
    await startRecording()

    spawned().reply({ type: 'progress', loaded: 100, total: 500 })
    spawned().reply({ type: 'ready' })

    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText(/downloading|preparing|opening/i)).toBeNull()
    expect(document.querySelector('.busy-spinner')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // The elapsed time reads from its own element beside the Recording heading
    // rather than from the stop button's label, so this asserts the clock, not
    // the control it used to be printed on.
    screen.getByText('0:01')
    stopButton()
  })

  it('never arms the silence budget from prewarm alone', async () => {
    renderCapture()
    await startRecording()
    spawned().reply({ type: 'progress', loaded: 1, total: 10 })

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000)
    })

    expect(spawned().terminate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    stopButton()
  })

  it('reuses the prewarmed worker and load when the recording stops', async () => {
    const { onTranscript } = renderCapture()
    await startRecording()
    spawned().reply({ type: 'ready' })
    await stopRecording()

    expect(workers).toHaveLength(1)
    expect(spawned().postMessage).toHaveBeenCalledTimes(2)
    expect(spawned().postMessage.mock.calls[0]?.[0]).toEqual({ type: 'load' })
    expect(spawned().postMessage.mock.calls[1]?.[0]).toMatchObject({ type: 'transcribe' })
    expect(tracks[0]?.stop).toHaveBeenCalled()

    // The load's own answer can land beside the transcribe's; a repeated
    // ready must read as the same state, not a restart.
    spawned().reply({ type: 'ready' })
    spawned().reply({ type: 'ready' })
    screen.getAllByText(/transcribing on this device/i)
    spawned().reply({ type: 'result', text: 'hello', segments: [] })
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hello',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
  })

  it('stays silent when the prewarm fails, and still transcribes on stop', async () => {
    const { onTranscript } = renderCapture()
    await startRecording()
    spawned().reply({ type: 'error', message: 'network gave out' })

    expect(screen.queryByRole('alert')).toBeNull()
    stopButton()

    await stopRecording()
    expect(workers).toHaveLength(1)
    expect(spawned().postMessage.mock.calls[1]?.[0]).toMatchObject({ type: 'transcribe' })
    spawned().reply({ type: 'progress', loaded: 1, total: 10 })
    spawned().reply({ type: 'ready' })
    spawned().reply({ type: 'result', text: 'recovered', segments: [] })
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'recovered',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('quietly replaces a worker that dies during the prewarm', async () => {
    const { onTranscript } = renderCapture()
    await startRecording()

    spawned().die()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(spawned().terminate).toHaveBeenCalled()
    stopButton()

    await stopRecording()
    expect(workers).toHaveLength(2)
    expect(spawned(1).postMessage).toHaveBeenCalledTimes(1)
    expect(spawned(1).postMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'transcribe' })
    spawned(1).reply({ type: 'ready' })
    spawned(1).reply({ type: 'result', text: 'second worker', segments: [] })
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'second worker',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
  })

  it('swallows a prewarm error that lands during the decode after stop', async () => {
    let releaseDecode: () => void = () => {}
    const { onTranscript } = renderCapture()
    await startRecording()

    decodeAudioData = () =>
      new Promise((resolve) => {
        releaseDecode = () => resolve({ duration: 1 })
      })
    fireEvent.click(stopButton())
    await settle()
    spawned().reply({ type: 'error', message: 'load failed late' })
    expect(screen.queryByRole('alert')).toBeNull()

    releaseDecode()
    await settle()
    expect(spawned().postMessage.mock.calls[1]?.[0]).toMatchObject({ type: 'transcribe' })
    spawned().reply({ type: 'ready' })
    spawned().reply({ type: 'result', text: 'late recovery', segments: [] })
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'late recovery',
      segments: [],
      source: 'asr_local',
      audio: expect.any(Blob),
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('unmounting mid-recording terminates the prewarmed worker and leaves no timer', async () => {
    const { unmount } = renderCapture()
    await startRecording()

    unmount()

    expect(spawned().terminate).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases every microphone track when unmounted mid-recording', async () => {
    // Issue #140. Tracks were stopped only inside `onstop`, which only the Stop
    // button reaches, so switching intake tabs left the browser's recording
    // indicator on. In a consulting room that reads as "still listening".
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const { unmount } = renderCapture()
    await startRecording()

    unmount()

    // Every track, not just the first: a stream carrying two would otherwise
    // half-release and keep the indicator lit.
    for (const track of tracks) expect(track.stop).toHaveBeenCalled()
  })

  it('starts no transcription for a recording it tore down', async () => {
    // Unlike the test above, this one does NOT fail before the fix, because
    // nothing stopped the recorder and so `onstop` never fired at all. It
    // guards the fix instead: stopping the recorder to free the device must
    // not also queue a decode, which would build a fresh worker moments after
    // teardown killed the last one, on a component that is already gone.
    const { unmount, onTranscript } = renderCapture()
    await startRecording()
    const built = workers.length

    unmount()
    await settle()

    expect(workers).toHaveLength(built)
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('builds no worker when microphone access is refused', async () => {
    renderCapture()
    getUserMedia = async () => {
      throw new Error('denied')
    }
    fireEvent.click(startButton())
    await settle()

    expect(workers).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toMatch(/microphone/i)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('requests dictation constraints, not the browser voice-call defaults', async () => {
    renderCapture()
    await startRecording()

    // Pinned exactly so a refactor cannot drift back to `{ audio: true }`,
    // which would re-enable the DSP behind the devoicing family measured in
    // docs/trd.md §20.3 ("patut" for "batuk").
    expect(gumCalls).toEqual([
      {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      },
    ])
  })
})

/**
 * The standing transcription-engine preference (originally issue #155, now a
 * device setting on the owner's decision 2026-09-02).
 *
 * The governing rule is still that hosted is findable but never funnelled:
 * on-device is the default and the floor, and failure in either direction
 * degrades toward privacy rather than toward the other path. The screen itself
 * carries no picker any more, so what is pinned here is what a reader cannot
 * verify by eye: the default stays local, and the hosted restatement line
 * tracks the prop.
 */
describe('the standing engine preference', () => {
  it('restates the hosted choice on screen only when hosted is the saved engine', () => {
    renderCapture('hosted')
    expect(hostedRestatement()).toBeTruthy()
  })

  it('carries no hosted restatement on the default local engine', () => {
    renderCapture()
    expect(screen.queryByText(/this recording leaves this device/i)).toBeNull()
  })

  it('shows no engine picker, which lives in the Audio dialog now', () => {
    renderCapture('hosted')
    expect(screen.queryByRole('radio', { name: /ilmu/i })).toBeNull()
    expect(screen.queryByRole('radio', { name: /on this device/i })).toBeNull()
  })

  it('still records nothing on the GP-facing screen; the setting is device state', () => {
    // The screen has no control to save with, so it must not write settings.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderCapture('hosted')

    expect(setItem).not.toHaveBeenCalled()
  })
})

/*
 * The per-consultation gesture (issue #254).
 *
 * The engine preference says where audio goes and is remembered for this
 * device; this says whether this patient's audio may be sent and is remembered
 * by nothing. #228 collapsed the two into one remembered setting and left the
 * Audio dialog claiming each patient was still asked, which nothing did for
 * three weeks. These tests exist so that cannot recur silently: the relay is
 * unreachable without the tick, and the tick cannot outlive the screen.
 */
describe('the per-consultation consent gesture', () => {
  it('blocks both ways into the relay until the patient has agreed', async () => {
    renderCapture('hosted')

    expect(consentBox().checked).toBe(false)
    expect(startButton().disabled).toBe(true)
    expect((screen.getByLabelText(/use an audio file/i) as HTMLInputElement).disabled).toBe(true)

    // Neither control moves, so neither can produce a blob to send.
    fireEvent.click(startButton())
    pickFile()
    await settle()

    expect(transcribeHostedAsr).not.toHaveBeenCalled()
  })

  it('opens the controls once agreed, and sends that recording', async () => {
    renderCapture('hosted')
    agree()
    expect(startButton().disabled).toBe(false)

    await startRecording()
    await stopRecording()

    expect(transcribeHostedAsr).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to agree to on the on-device engine', () => {
    renderCapture()

    // The gate is not a neutral addition on the local path: a tick offered
    // where nothing leaves the browser is an invitation to the cloud on a
    // screen that mentions none, which is the funnel section 20 forbids.
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(startButton().disabled).toBe(false)
  })

  it('dies with the screen, so it cannot carry to the next patient', () => {
    const { unmount } = renderCapture('hosted')
    agree()
    expect(consentBox().checked).toBe(true)

    unmount()
    renderCapture('hosted')

    expect(consentBox().checked).toBe(false)
    expect(startButton().disabled).toBe(true)
  })

  it('is written nowhere: no storage, so nothing to inherit', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderCapture('hosted')
    agree()

    expect(setItem).not.toHaveBeenCalled()
  })

  it('cannot be withdrawn mid-run, so a recording cannot fork under itself', async () => {
    renderCapture('hosted')
    agree()
    await startRecording()

    expect(consentBox().disabled).toBe(true)
  })

  /*
   * The hole disabled buttons cannot close. A recording started legitimately on
   * the on-device path becomes a hosted one the moment the doctor saves the
   * Audio dialog mid-recording, and the button that started it was never
   * disabled. Only the dispatcher sees this, which is why the rule lives there.
   */
  it('refuses a recording the Audio dialog turned hosted mid-run, and keeps it', async () => {
    const { rerender } = renderCapture()
    await startRecording()

    rerender(<AudioCapture onTranscript={vi.fn()} engine="hosted" transcript="" />)
    await stopRecording()

    expect(transcribeHostedAsr).not.toHaveBeenCalled()
    // Nor did it quietly run the local worker instead: no silent switching in
    // either direction, and the doctor is told which it was.
    expect(transcribeRequests()).toHaveLength(0)
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/still on this device/i)
    expect(alert).toMatch(/has not agreed/i)
    // Kept, not discarded: a consultation recording is unrecoverable.
    expect((screen.getByRole('button', { name: /try again/i }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('sends the kept recording once the patient does agree', async () => {
    const { rerender } = renderCapture()
    await startRecording()
    rerender(<AudioCapture onTranscript={vi.fn()} engine="hosted" transcript="" />)
    await stopRecording()

    agree()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await settle()

    expect(transcribeHostedAsr).toHaveBeenCalledTimes(1)
  })

  it('survives a failed upload, so Try Again does not ask the patient twice', async () => {
    renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockRejectedValue(new Error('relay exploded'))

    await startRecording()
    await stopRecording()

    expect(consentBox().checked).toBe(true)
    expect((screen.getByRole('button', { name: /try again/i }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})

describe('the recording fork', () => {
  it('goes to the worker and never to the relay on the default local engine', async () => {
    renderCapture()
    await startRecording()
    await stopRecording()

    expect(transcribeHostedAsr).not.toHaveBeenCalled()
    expect(transcribeRequests()).toHaveLength(1)
  })

  it('goes to the relay with the recording, and runs no worker, on the hosted engine', async () => {
    renderCapture('hosted')
    agree()
    await startRecording()
    await stopRecording()

    expect(transcribeHostedAsr).toHaveBeenCalledTimes(1)
    expect(transcribeHostedAsr.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    // No prewarm and no transcribe: a hosted recording loads no local model.
    expect(workers).toHaveLength(0)
    expect(transcribeRequests()).toHaveLength(0)
  })

  it('terminates a worker left warm by an earlier on-device run when the engine changes to hosted', async () => {
    const { rerender } = renderCapture()
    // A local run first, which builds and warms a worker.
    pickFile()
    await settle()
    expect(workers).toHaveLength(1)
    spawned().reply({ type: 'result', text: 'local', segments: [] })

    rerender(<AudioCapture onTranscript={vi.fn()} engine="hosted" transcript="" />)
    agree()
    await startRecording()

    // Roughly 250 MB of weights held for a path that will not use them.
    expect(spawned().terminate).toHaveBeenCalled()
  })

  it('sends the picked audio file to the relay too', async () => {
    renderCapture('hosted')
    agree()
    pickFile()
    await settle()

    expect(transcribeHostedAsr).toHaveBeenCalledTimes(1)
    expect(workers).toHaveLength(0)
  })

  it('reports hosted provenance on success', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })

    await startRecording()
    await stopRecording()

    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hosted text',
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
    })
  })
})

describe('a hosted upload', () => {
  it('is abandoned by Cancel, with no error and the controls restored', async () => {
    renderCapture('hosted')
    agree()
    await startRecording()
    await stopRecording()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await settle()

    expect(uploadSignal().aborted).toBe(true)
    // A cancel is not a failure: the doctor asked for it.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(startButton().disabled).toBe(false)
  })

  it('is abandoned on unmount, so no audio keeps flowing from a closed tab', async () => {
    const { unmount } = renderCapture('hosted')
    agree()
    await startRecording()
    await stopRecording()

    unmount()
    await settle()

    expect(uploadSignal().aborted).toBe(true)
  })

  it('is bounded, and the expiry is reported rather than swallowed', async () => {
    renderCapture('hosted')
    agree()
    await startRecording()
    await stopRecording()

    act(() => {
      vi.advanceTimersByTime(UPLOAD_TIMEOUT_MS)
    })
    await settle()

    expect(uploadSignal().aborted).toBe(true)
    expect(screen.getByRole('alert').textContent).toMatch(/still on this device/i)
  })

  it('degrades toward privacy on failure and never runs the local worker', async () => {
    renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockRejectedValue(new Error('relay exploded'))

    await startRecording()
    await stopRecording()

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/still on this device/i)
    expect(alert).toMatch(/type or paste/i)
    // The whole point: a hosted failure must not silently push the doctor into
    // the on-device path, exactly as a local failure never uploads.
    expect(workers).toHaveLength(0)
    expect(transcribeRequests()).toHaveLength(0)
  })

  it('reruns whichever engine the device setting now names', async () => {
    const { rerender } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockRejectedValue(new Error('relay exploded'))
    await startRecording()
    await stopRecording()
    expect(screen.getByRole('alert')).toBeTruthy()

    // The doctor switches the Audio dialog back to on-device and retries: the
    // retry is local, not a second upload of audio from a setting they have
    // just withdrawn.
    rerender(<AudioCapture onTranscript={vi.fn()} engine="local" transcript="" />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await settle()

    expect(transcribeHostedAsr).toHaveBeenCalledTimes(1)
    expect(transcribeRequests()).toHaveLength(1)
  })
})

describe('on-device failure copy', () => {
  /*
   * The local failure paths must never mention the hosted option. Offering the
   * cloud at the moment on-device transcription just failed is precisely the
   * funnel docs/trd.md section 20 forbids, and it is an easy regression to
   * introduce while editing nearby copy.
   */
  const NEVER = /hosted|ilmu|upload/i

  it('never points a stalled run at the hosted path', async () => {
    renderCapture()
    pickFile()
    await settle()
    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS)
    })

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/type or paste/i)
    expect(alert).not.toMatch(NEVER)
  })

  it('never points a dead worker at the hosted path', async () => {
    renderCapture()
    pickFile()
    await settle()
    spawned().die()

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/type or paste/i)
    expect(alert).not.toMatch(NEVER)
  })
})

/**
 * The hosted-draft-labelling pass that follows a successful relay (#189). It
 * sends only text the relay already returned, never audio, and every failure
 * on it, including a timeout and a cancel, degrades to the unlabelled prose
 * the doctor already has rather than to an error.
 */
describe('hosted draft-turn labelling', () => {
  const SAMPLE_TURNS: DraftTurn[] = [
    { speaker: 'doctor', text: 'How are you feeling?' },
    { speaker: 'patient', text: 'I have a cough.' },
  ]

  it('delivers the drafted turns alongside the transcript and returns to idle', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })
    draftHostedTurns.mockResolvedValue(SAMPLE_TURNS)

    await startRecording()
    await stopRecording()

    expect(draftHostedTurns).toHaveBeenCalledWith('hosted text', expect.any(AbortSignal))
    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hosted text',
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
      draftTurns: SAMPLE_TURNS,
    })
    expect(startButton().disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('delivers the transcript without draftTurns and raises no banner when labelling is rejected', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })
    draftHostedTurns.mockRejectedValue(new Error('labelling failed'))

    await startRecording()
    await stopRecording()

    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hosted text',
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to the unlabelled transcript once the label timeout expires', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })
    hangUntilAborted(draftHostedTurns)

    await startRecording()
    await stopRecording()
    expect(startButton().disabled).toBe(true)

    act(() => {
      vi.advanceTimersByTime(LABEL_TIMEOUT_MS)
    })
    await settle()

    expect(onTranscript).toHaveBeenCalledWith({
      text: 'hosted text',
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is abandoned by Cancel mid-labelling, with no onTranscript call and no banner', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })
    hangUntilAborted(draftHostedTurns)

    await startRecording()
    await stopRecording()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await settle()

    expect(onTranscript).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(startButton().disabled).toBe(false)
  })

  it('never calls the labelling client for an empty relay result', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: '', durationSeconds: 0, segments: [] })

    await startRecording()
    await stopRecording()

    expect(draftHostedTurns).not.toHaveBeenCalled()
    expect(onTranscript).toHaveBeenCalledWith({
      text: '',
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
    })
  })

  it('never calls the labelling client for a relay result over the request bound', async () => {
    const { onTranscript } = renderCapture('hosted')
    agree()
    const oversized = 'a'.repeat(MAX_DRAFT_TEXT_CHARACTERS + 1)
    transcribeHostedAsr.mockResolvedValue({ text: oversized, durationSeconds: 9, segments: [] })

    await startRecording()
    await stopRecording()

    expect(draftHostedTurns).not.toHaveBeenCalled()
    expect(onTranscript).toHaveBeenCalledWith({
      text: oversized,
      segments: [],
      source: 'asr_hosted',
      audio: expect.any(Blob),
    })
  })

  it('never calls the labelling client on the on-device path', async () => {
    renderCapture()
    pickFile()
    await settle()
    const worker = spawned()
    worker.reply({ type: 'ready' })
    worker.reply({ type: 'result', text: 'on-device text', segments: [] })
    await settle()

    expect(draftHostedTurns).not.toHaveBeenCalled()
  })

  it('holds the controls busy while labelling is in flight', async () => {
    renderCapture('hosted')
    agree()
    transcribeHostedAsr.mockResolvedValue({ text: 'hosted text', durationSeconds: 4, segments: [] })
    hangUntilAborted(draftHostedTurns)

    await startRecording()
    await stopRecording()

    expect(startButton().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await settle()
    expect(startButton().disabled).toBe(false)
  })
})

describe('the recording panel', () => {
  it('says it is recording, and says when the words arrive', async () => {
    renderCapture()
    await startRecording()

    screen.getByText('Recording…')
    // The field is deliberately empty during the pass. Transcription runs on
    // the finished recording, so anything else would promise a live transcript
    // this product does not produce.
    screen.getByText(/text appears when you stop/i)
  })

  it('shows the transcript already captured, rather than an empty field', async () => {
    renderCapture('local', 'Doctor: How long has the cough been there?')
    await startRecording()

    screen.getByText('Doctor: How long has the cough been there?')
    expect(screen.queryByText(/text appears when you stop/i)).toBeNull()
  })

  it('leaves no recording panel behind once the recording stops', async () => {
    renderCapture()
    await startRecording()
    expect(screen.queryByText('Recording…')).not.toBeNull()

    await stopRecording()

    expect(screen.queryByText('Recording…')).toBeNull()
  })
})

describe('the hosted-processing disclosure', () => {
  /*
   * `AGENTS.md` forbids demoting consent copy into a tooltip, and this line is
   * the one the rule is about. Trimming it is allowed; losing a claim is not,
   * so each of the three is pinned separately rather than the sentence as a
   * whole: that the audio leaves the device, who receives it, and where it is
   * processed. A future edit may reword freely and will still fail here if it
   * drops one.
   */
  it('keeps all three claims visible, not in a tooltip', () => {
    renderCapture('hosted')

    const line = hostedRestatement()
    expect(line.textContent).toMatch(/leaves this device/i)
    expect(line.textContent).toMatch(/ILMU/)
    expect(line.textContent).toMatch(/Malaysia/i)
    // Visible copy, not a disclosure the doctor has to open.
    expect(line.closest('[role="tooltip"]')).toBeNull()
  })
})
