import { useEffect, useRef } from 'react'
import {
  DEFAULT_SEGMENT_BOUNDS,
  DEFAULT_SILENCE_RMS,
  isSilentThroughout,
  rmsFromTimeDomain,
  type SegmentBounds,
  shouldCut,
} from './segment-policy'

export type Segment = {
  blob: Blob
  index: number
  startedAtMs: number
  durationMs: number
}

export type SegmentRecorderOptions = {
  /**
   * Borrowed for the session, never owned. Its tracks are not stopped here, the
   * same contract `InputMeter` takes when it is handed a stream instead of
   * constraints. Null while there is nothing to listen to.
   */
  stream: MediaStream | null
  onSegment: (segment: Segment) => void
  bounds?: SegmentBounds
  silenceRms?: number
}

const TICK_MS = 100

/** Matches `InputMeter`, which reads the same signal off the same graph. */
const FFT_SIZE = 512

type OpenWindow = {
  index: number
  startedAt: number
  silentMs: number
  voicedMs: number
  drop: boolean
}

/*
 * Cuts a live microphone into windows a batch recogniser can accept, by running
 * a fresh `MediaRecorder` per window over one long-lived stream.
 *
 * `MediaRecorder.start(timeslice)` is the obvious approach and produces
 * undecodable output: only the first chunk carries the WebM header and the rest
 * are bare clusters, which a recogniser rejects. Cycling the recorder instead
 * costs a sub-frame gap at each boundary and buys a self-contained file per
 * window, which is what lets these blobs reach a provider exactly as recorded
 * (docs/trd.md 20.9).
 *
 * This emits segments and does not upload them. Nothing here opens a microphone
 * either, so the session-scoped consent that docs/trd.md 20.4 requires belongs
 * to whichever surface acquires the stream.
 */
export function useSegmentRecorder({
  stream,
  onSegment,
  bounds = DEFAULT_SEGMENT_BOUNDS,
  silenceRms = DEFAULT_SILENCE_RMS,
}: SegmentRecorderOptions): void {
  const onSegmentRef = useRef(onSegment)
  onSegmentRef.current = onSegment

  // Bumped on teardown so a data event still queued against a torn-down graph
  // resolves into nothing, the same generation discipline `AudioCapture` uses.
  const epochRef = useRef(0)

  const { floorMs, ceilingMs, silenceHoldMs } = bounds

  useEffect(() => {
    if (!stream) return

    epochRef.current += 1
    const epoch = epochRef.current

    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    source.connect(analyser)
    const frame = new Uint8Array(analyser.fftSize)

    let recorder: MediaRecorder | null = null
    let live: OpenWindow | null = null
    let nextIndex = 0
    let lastTick = Date.now()

    const openWindow = () => {
      const opened: OpenWindow = {
        index: nextIndex,
        startedAt: Date.now(),
        silentMs: 0,
        voicedMs: 0,
        drop: false,
      }
      nextIndex += 1
      live = opened

      const next = new MediaRecorder(stream)
      next.ondataavailable = (event) => {
        if (epochRef.current !== epoch || opened.drop) return
        onSegmentRef.current({
          blob: event.data,
          index: opened.index,
          startedAtMs: opened.startedAt,
          durationMs: Date.now() - opened.startedAt,
        })
      }
      next.start()
      recorder = next
    }

    const tick = () => {
      const current = live
      const running = recorder
      if (!current || !running) return

      analyser.getByteTimeDomainData(frame)
      const now = Date.now()
      const delta = now - lastTick
      lastTick = now

      if (rmsFromTimeDomain(frame) < silenceRms) {
        current.silentMs += delta
      } else {
        current.silentMs = 0
        current.voicedMs += delta
      }

      const state = {
        elapsedMs: now - current.startedAt,
        silentMs: current.silentMs,
        voicedMs: current.voicedMs,
      }
      if (!shouldCut(state, { floorMs, ceilingMs, silenceHoldMs })) return

      // Decided before the stop, because the data event that reads it arrives
      // after this window has already been replaced.
      current.drop = isSilentThroughout(state)
      running.stop()
      openWindow()
    }

    openWindow()
    const timer = setInterval(tick, TICK_MS)

    return () => {
      epochRef.current += 1
      clearInterval(timer)
      if (recorder?.state === 'recording') recorder.stop()
      recorder = null
      live = null
      source.disconnect()
      void context.close()
    }
  }, [stream, floorMs, ceilingMs, silenceHoldMs, silenceRms])
}
