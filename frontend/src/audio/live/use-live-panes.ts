import {
  type ClinicalFacts,
  type InformationGap,
  LIVE_ANALYSIS_INTERVAL_MS,
  type LiveAnalysisState,
  type OperationalBlock,
  type RedFlag,
} from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api.js'
import type { TranscriptSegment } from '../protocol.js'
import { closedSegments, deltaFor, mergeFlags, segmentsToDelta } from './live-fold.js'

/**
 * Drives the three live panes while ambient capture runs (#219).
 *
 * Two cadences, because the two halves cost different things. Red flags are
 * deterministic and in-process on the API, so they run on every closed segment
 * and are the surface that feels immediate. The model fold runs at most every
 * `LIVE_ANALYSIS_INTERVAL_MS` and is allowed to lag: docs/trd.md §20.8.1 puts
 * the deterministic safety pass in the hot path and lets the card follow.
 *
 * **Nothing here is persisted.** `useState` and `useRef` only: no
 * `localStorage`, no `sessionStorage`, no IndexedDB, no query persister. The
 * running consultation dies with the tab, which is the existing rule for
 * clinical content and the reason session resumption is its own issue (#256).
 */

export type LivePanes = {
  redFlags: readonly RedFlag[]
  /** Still unestablished, so still worth asking. */
  gaps: readonly InformationGap[]
  /**
   * Prompts that have since been answered.
   *
   * `deriveGaps` simply stops returning a field once it is established, so a
   * gap the doctor has just covered would otherwise vanish from under their
   * eye mid-sentence. Moving it instead keeps the surface honest in both
   * directions: zero erasure protects what was asserted, this protects the
   * reader's sense that the list is tracking the conversation.
   */
  answered: readonly InformationGap[]
  clinicalFacts: ClinicalFacts | null
  operational: OperationalBlock | null
  /** True once any pane has something to show, so the caller can swap placeholders. */
  hasContent: boolean
  /**
   * Whether a flags cycle has ever succeeded.
   *
   * Separate from `hasContent` because they answer different questions, and
   * conflating them let the Red Flags panel claim "none so far" on the strength
   * of a successful *analysis* cycle. Only this may license that sentence.
   */
  flagsChecked: boolean
  /**
   * The live safety check is failing.
   *
   * The one state the pane must never hide. A panel that says "no escalation
   * triggers" while the check behind it is erroring is asserting an absence it
   * did not establish, which is the false negative this engine exists to
   * prevent.
   */
  flagsStalled: boolean
}

const EMPTY: LivePanes = {
  redFlags: [],
  gaps: [],
  answered: [],
  clinicalFacts: null,
  operational: null,
  hasContent: false,
  flagsChecked: false,
  flagsStalled: false,
}

export function useLivePanes(consultationId: string | null) {
  const [panes, setPanes] = useState<LivePanes>(EMPTY)

  /** How many closed segments each half has already sent. */
  const flagsCommitted = useRef(0)
  const analysisCommitted = useRef(0)
  const state = useRef<LiveAnalysisState | null>(null)
  const lastCycleRendered = useRef(0)
  const lastAnalysisAt = useRef(0)

  /*
   * At most one request of each kind in flight. A cycle that arrives while one
   * is running is dropped rather than queued: the next closed segment will
   * carry the same ground, because `committed` only advances on success. That
   * is what keeps a slow provider from building a backlog of stale windows.
   */
  const flagsBusy = useRef(false)
  const analysisBusy = useRef(false)
  const inflight = useRef<AbortController[]>([])

  const abortAll = useCallback(() => {
    for (const controller of inflight.current) controller.abort()
    inflight.current = []
  }, [])

  const reset = useCallback(() => {
    abortAll()
    flagsCommitted.current = 0
    analysisCommitted.current = 0
    state.current = null
    lastCycleRendered.current = 0
    lastAnalysisAt.current = 0
    flagsBusy.current = false
    analysisBusy.current = false
    setPanes(EMPTY)
  }, [abortAll])

  useEffect(() => abortAll, [abortAll])

  /*
   * Deliberately not memoised. `AmbientCapture` keeps this callback in a ref it
   * refreshes on every render and only invokes it when settled tokens change,
   * so a fresh identity here costs nothing, and pinning one would mean either
   * a stale closure over `consultationId` or a dependency list that lies.
   */
  function absorb(segments: readonly TranscriptSegment[]) {
    if (consultationId === null) return
    const closed = closedSegments(segments)
    if (closed.length === 0) return

    void runFlags(closed, consultationId)
    void runAnalysis(closed, consultationId)
  }

  async function runFlags(closed: readonly TranscriptSegment[], id: string) {
    if (flagsBusy.current) return
    const window_ = deltaFor(closed, flagsCommitted.current)
    if (window_.length === 0) return

    const turns = segmentsToDelta(window_)
    if (turns.length === 0) return

    flagsBusy.current = true
    const controller = new AbortController()
    inflight.current.push(controller)
    const sent = closed.length

    try {
      const raised = await api.liveFlags(
        id,
        { source: 'asr_live', labelsReviewed: false, turns },
        controller.signal,
      )
      flagsCommitted.current = sent
      // Insert-only. A window that raises nothing must never clear the pane,
      // and the API is additive against the authoritative Finish run.
      setPanes((current) => {
        const redFlags = mergeFlags(current.redFlags, raised)
        return redFlags.length === current.redFlags.length && !current.flagsStalled
          ? current
          : { ...current, redFlags, flagsStalled: false, flagsChecked: true }
      })
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof DOMException)) throw error
      /*
       * A dropped cycle used to be swallowed silently, and that was a
       * false-negative in the shape this engine exists to prevent: the pane
       * went on rendering "No escalation triggers so far" over a check that had
       * stopped running, which is an affirmative absence nobody had earned.
       *
       * An abort is not a failure. It is the doctor stopping the session or the
       * component unmounting, and saying the checks stalled there would be
       * alarming and untrue.
       */
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setPanes((current) => (current.flagsStalled ? current : { ...current, flagsStalled: true }))
      }
    } finally {
      flagsBusy.current = false
      inflight.current = inflight.current.filter((c) => c !== controller)
    }
  }

  async function runAnalysis(closed: readonly TranscriptSegment[], id: string) {
    if (analysisBusy.current) return

    /*
     * Fires on the first closed segment, then honours the floor. Waiting a full
     * interval before the first cycle would leave the panes empty through the
     * opening of the consultation, which is where the doctor is most likely to
     * look at them.
     */
    const now = Date.now()
    const opened = state.current !== null
    if (opened && now - lastAnalysisAt.current < LIVE_ANALYSIS_INTERVAL_MS) return

    const window_ = deltaFor(closed, analysisCommitted.current)
    if (window_.length === 0) return

    const turns = segmentsToDelta(window_)
    if (turns.length === 0) return

    analysisBusy.current = true
    lastAnalysisAt.current = now
    const controller = new AbortController()
    inflight.current.push(controller)
    const sent = closed.length

    try {
      const result = await api.liveAnalysis(
        id,
        { source: 'asr_live', labelsReviewed: false, turns },
        state.current,
        controller.signal,
      )

      analysisCommitted.current = sent

      /*
       * Out-of-order arrivals are dropped rather than rendered. Strict
       * sequencing above makes this nearly unreachable, but it is the one
       * mechanism that can still catch a retraction before the doctor sees it,
       * and a line vanishing mid-sentence is the failure the fold exists to
       * prevent (docs/trd.md §20.8.1).
       */
      if (result.state.cycle <= lastCycleRendered.current) return
      lastCycleRendered.current = result.state.cycle
      state.current = result.state

      setPanes((current) => {
        const stillOpen = new Set(result.gaps.map((gap) => gap.id))
        const alreadyAnswered = new Set(current.answered.map((gap) => gap.id))
        const newlyAnswered = current.gaps.filter(
          (gap) => !stillOpen.has(gap.id) && !alreadyAnswered.has(gap.id),
        )

        return {
          ...current,
          gaps: result.gaps,
          answered: [...current.answered, ...newlyAnswered],
          clinicalFacts: result.state.clinicalFacts,
          operational: result.state.operational,
          hasContent: true,
        }
      })
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof DOMException)) throw error
    } finally {
      analysisBusy.current = false
      inflight.current = inflight.current.filter((c) => c !== controller)
    }
  }

  return { panes, absorb, reset }
}
