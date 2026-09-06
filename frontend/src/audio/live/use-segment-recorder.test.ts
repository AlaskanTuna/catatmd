import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Segment, useSegmentRecorder } from './use-segment-recorder'

/** Every recorder the hook builds, so tests can count windows and drive stops. */
const recorders: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  state: 'inactive' | 'recording' = 'inactive'
  start = vi.fn(() => {
    this.state = 'recording'
  })

  constructor(readonly stream: unknown) {
    recorders.push(this)
  }

  /** The browser fires this after stop() returns, never inside it. */
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => this.ondataavailable?.({ data: new Blob(['opus']) }))
  }
}

/** 128 is silence in a time-domain frame; 0 is full deflection. */
let level = 128

const disconnectSource = vi.fn()
const closeContext = vi.fn(async () => {})

class FakeAudioContext {
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: disconnectSource }))
  createAnalyser = vi.fn(() => ({
    fftSize: 2048,
    getByteTimeDomainData: (frame: Uint8Array) => frame.fill(level),
  }))
  close = closeContext
}

let tracks: { stop: ReturnType<typeof vi.fn> }[]
const streamOf = () => ({ getTracks: () => tracks }) as unknown as MediaStream

const speak = () => {
  level = 0
}
const hush = () => {
  level = 128
}

beforeEach(() => {
  vi.useFakeTimers()
  recorders.length = 0
  tracks = [{ stop: vi.fn() }]
  disconnectSource.mockClear()
  closeContext.mockClear()
  speak()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = (onSegment: (segment: Segment) => void) =>
  renderHook(() => useSegmentRecorder({ stream: streamOf(), onSegment }))

describe('useSegmentRecorder', () => {
  it('cuts a window at the ceiling when nobody pauses', async () => {
    const segments: Segment[] = []
    mount((segment) => segments.push(segment))

    await vi.advanceTimersByTimeAsync(20_000)

    expect(segments).toHaveLength(1)
    expect(segments[0]?.index).toBe(0)
    expect(segments[0]?.durationMs).toBeGreaterThanOrEqual(20_000)
  })

  it('cuts on a pause once the floor has passed', async () => {
    const segments: Segment[] = []
    mount((segment) => segments.push(segment))

    await vi.advanceTimersByTimeAsync(9_000)
    expect(segments).toHaveLength(0)

    hush()
    await vi.advanceTimersByTimeAsync(800)

    expect(segments).toHaveLength(1)
  })

  it('does not cut before the floor, however long the pause', async () => {
    const segments: Segment[] = []
    mount((segment) => segments.push(segment))

    await vi.advanceTimersByTimeAsync(1_000)
    hush()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(segments).toHaveLength(0)
  })

  it('drops a window nobody spoke in', async () => {
    const segments: Segment[] = []
    hush()
    mount((segment) => segments.push(segment))

    await vi.advanceTimersByTimeAsync(20_000)

    // The recorder still cycled, so capture continues; only the blob is dropped.
    expect(recorders.length).toBeGreaterThan(1)
    expect(segments).toHaveLength(0)
  })

  it('opens exactly one recorder per window', async () => {
    const segments: Segment[] = []
    mount((segment) => segments.push(segment))

    await vi.advanceTimersByTimeAsync(40_000)

    expect(segments.map((segment) => segment.index)).toEqual([0, 1])
    // Two closed windows plus the one still open.
    expect(recorders).toHaveLength(3)
  })

  it('never stops the tracks of a stream it was lent', async () => {
    const { unmount } = mount(() => {})
    await vi.advanceTimersByTimeAsync(20_000)

    unmount()

    expect(tracks[0]?.stop).not.toHaveBeenCalled()
  })

  it('releases its own analyser graph on unmount', async () => {
    const { unmount } = mount(() => {})
    await vi.advanceTimersByTimeAsync(1_000)

    unmount()

    expect(disconnectSource).toHaveBeenCalled()
    expect(closeContext).toHaveBeenCalled()
  })

  it('emits nothing from a recorder that outlived the mount', async () => {
    const segments: Segment[] = []
    const { unmount } = mount((segment) => segments.push(segment))
    await vi.advanceTimersByTimeAsync(1_000)

    const open = recorders.at(-1)
    unmount()
    segments.length = 0

    open?.ondataavailable?.({ data: new Blob(['late']) })
    await vi.advanceTimersByTimeAsync(0)

    expect(segments).toHaveLength(0)
  })

  it('starts nothing until a stream is handed to it', async () => {
    const segments: Segment[] = []
    renderHook(() => useSegmentRecorder({ stream: null, onSegment: (s) => segments.push(s) }))

    await vi.advanceTimersByTimeAsync(30_000)

    expect(recorders).toHaveLength(0)
    expect(segments).toHaveLength(0)
  })
})
