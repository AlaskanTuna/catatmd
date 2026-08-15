import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioCapture, STALL_TIMEOUT_MS } from './AudioCapture.js'
import type { WorkerResponse } from './protocol.js'

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
  decodeAudioData = async () => ({ duration: 1 })
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
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

function renderCapture() {
  const onTranscript = vi.fn()
  const view = render(<AudioCapture onTranscript={onTranscript} />)
  return { onTranscript, ...view }
}

function pickFile() {
  fireEvent.change(screen.getByLabelText(/use an audio file/i), {
    target: { files: [new File(['audio'], 'clip.wav', { type: 'audio/wav' })] },
  })
}

const startButton = () =>
  screen.getByRole('button', { name: /start recording/i }) as HTMLButtonElement

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

    expect(onTranscript).toHaveBeenCalledWith({ text: 'hello', segments: [] })
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
