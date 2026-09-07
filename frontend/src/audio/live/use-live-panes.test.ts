import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment } from '../protocol.js'

/**
 * Scheduling tests for the live panes (#219).
 *
 * The pane contents are the API's business and are tested there. What this hook
 * owns is *when* it asks and *what it refuses to render*: the two cadences, the
 * one-in-flight rule, and the two ways a finding could vanish from the screen
 * (a window that raises nothing, and a stale cycle arriving late).
 */

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

const apiMock = vi.hoisted(() => ({
  liveFlags: vi.fn(),
  liveAnalysis: vi.fn(),
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: FakeApiError,
  api: apiMock,
}))

const { useLivePanes } = await import('./use-live-panes.js')

const segment = (text: string, start: number): TranscriptSegment => ({
  text,
  start,
  end: start + 2,
})

/** `closedSegments` treats the trailing segment as still growing. */
const withClosed = (count: number): TranscriptSegment[] =>
  Array.from({ length: count + 1 }, (_, index) => segment(`Sentence ${index}.`, index * 3))

const flag = (id: string) => ({
  id,
  label: id,
  severity: 'urgent' as const,
  evidence: 'evidence',
  source: 'rule' as const,
  ruleId: id,
  guidelineIds: [],
})

const emptyFacts = {
  symptoms: {},
  history: {},
  observations: {},
  examination: {},
}

const analysisResult = (cycle: number, gaps: { id: string }[] = []) => ({
  state: { cycle, clinicalFacts: emptyFacts, operational: {} },
  gaps,
  discardedFieldIds: [],
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  apiMock.liveFlags.mockReset().mockResolvedValue([])
  apiMock.liveAnalysis.mockReset().mockResolvedValue(analysisResult(1))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLivePanes', () => {
  it('does nothing without a consultation to attach to', async () => {
    const { result } = renderHook(() => useLivePanes(null))
    await act(async () => result.current.absorb(withClosed(2)))
    expect(apiMock.liveFlags).not.toHaveBeenCalled()
    expect(apiMock.liveAnalysis).not.toHaveBeenCalled()
  })

  it('does nothing until a segment has actually closed', async () => {
    const { result } = renderHook(() => useLivePanes('c1'))
    // One segment is still growing, so there is nothing settled to send.
    await act(async () => result.current.absorb([segment('Half a sen', 0)]))
    expect(apiMock.liveFlags).not.toHaveBeenCalled()
  })

  it('checks red flags on each newly closed segment', async () => {
    const { result } = renderHook(() => useLivePanes('c1'))

    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalledTimes(1))

    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalledTimes(2))
  })

  it('holds the model cycle to the interval floor', async () => {
    const { result } = renderHook(() => useLivePanes('c1'))

    // Fires immediately on the first closed segment rather than waiting a full
    // interval, so the panes are not blank through the opening exchange.
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(1))

    await act(async () => result.current.absorb(withClosed(2)))
    expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(12_000)
    })
    await act(async () => result.current.absorb(withClosed(3)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(2))
  })

  it('never runs two model cycles at once', async () => {
    let release: (value: unknown) => void = () => {}
    apiMock.liveAnalysis.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    const { result } = renderHook(() => useLivePanes('c1'))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(1))

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await act(async () => result.current.absorb(withClosed(4)))

    // Dropped rather than queued: a slow provider must not build a backlog of
    // stale windows behind it.
    expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(1)
    await act(async () => release(analysisResult(1)))
  })

  it('sends the previous state back, and never the running transcript', async () => {
    const { result } = renderHook(() => useLivePanes('c1'))

    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(1))
    expect(apiMock.liveAnalysis.mock.calls[0]?.[2]).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(12_000)
    })
    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(2))

    const previous = apiMock.liveAnalysis.mock.calls[1]?.[2]
    expect(previous).toMatchObject({ cycle: 1 })
    // The fold contract: state carries settled facts, never text.
    expect(JSON.stringify(previous)).not.toContain('Sentence')
  })

  it('keeps a flag when a later window raises nothing', async () => {
    apiMock.liveFlags.mockResolvedValueOnce([flag('haemoptysis')]).mockResolvedValueOnce([])

    const { result } = renderHook(() => useLivePanes('c1'))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(result.current.panes.redFlags).toHaveLength(1))

    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalledTimes(2))

    // An empty window says nothing about an earlier one. The pane only grows.
    expect(result.current.panes.redFlags.map((f) => f.id)).toEqual(['haemoptysis'])
  })

  it('ignores a stale cycle arriving after a newer one', async () => {
    const { result } = renderHook(() => useLivePanes('c1'))

    apiMock.liveAnalysis.mockResolvedValueOnce(analysisResult(5, [{ id: 'fever' }]))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(result.current.panes.gaps).toHaveLength(1))

    // An older cycle must not overwrite what the doctor has already read.
    apiMock.liveAnalysis.mockResolvedValueOnce(analysisResult(2, []))
    await act(async () => {
      vi.advanceTimersByTime(12_000)
    })
    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(apiMock.liveAnalysis).toHaveBeenCalledTimes(2))

    expect(result.current.panes.gaps.map((g) => g.id)).toEqual(['fever'])
  })

  it('keeps the panes when a cycle fails', async () => {
    apiMock.liveFlags.mockResolvedValueOnce([flag('chest-pain')])
    const { result } = renderHook(() => useLivePanes('c1'))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(result.current.panes.redFlags).toHaveLength(1))

    apiMock.liveFlags.mockRejectedValueOnce(new FakeApiError(429, 'rate_limited'))
    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalledTimes(2))

    // A dropped cycle is not the doctor's problem: the pane holds what it has.
    expect(result.current.panes.redFlags).toHaveLength(1)
  })

  it('reports that the safety check has stalled, rather than claiming none so far', async () => {
    /*
     * The blocker clinical review found. A swallowed failure left the pane
     * rendering "No escalation triggers so far" over a check that had stopped
     * running, which is an affirmative absence nobody established: the exact
     * false-negative shape the deterministic engine exists to prevent.
     */
    apiMock.liveFlags.mockRejectedValueOnce(new FakeApiError(429, 'rate_limited'))
    const { result } = renderHook(() => useLivePanes('c1'))

    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(result.current.panes.flagsStalled).toBe(true))
    expect(result.current.panes.flagsChecked).toBe(false)

    // And it recovers: one good cycle is enough to earn the sentence back.
    apiMock.liveFlags.mockResolvedValueOnce([])
    await act(async () => result.current.absorb(withClosed(2)))
    await waitFor(() => expect(result.current.panes.flagsStalled).toBe(false))
    expect(result.current.panes.flagsChecked).toBe(true)
  })

  it('does not call an abort a stall', async () => {
    // Aborting is the doctor stopping, or the component unmounting. Saying the
    // safety checks failed there would be alarming and untrue.
    const abort = new DOMException('aborted', 'AbortError')
    apiMock.liveFlags.mockRejectedValueOnce(abort)
    const { result } = renderHook(() => useLivePanes('c1'))

    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalled())
    expect(result.current.panes.flagsStalled).toBe(false)
  })

  it('clears everything on reset', async () => {
    apiMock.liveFlags.mockResolvedValueOnce([flag('chest-pain')])
    const { result } = renderHook(() => useLivePanes('c1'))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(result.current.panes.hasContent).toBe(true))

    await act(async () => result.current.reset())
    expect(result.current.panes.redFlags).toHaveLength(0)
    expect(result.current.panes.hasContent).toBe(false)
  })

  it('writes nothing to web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useLivePanes('c1'))
    await act(async () => result.current.absorb(withClosed(1)))
    await waitFor(() => expect(apiMock.liveFlags).toHaveBeenCalled())

    // No clinical content in localStorage, sessionStorage or IndexedDB.
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})
