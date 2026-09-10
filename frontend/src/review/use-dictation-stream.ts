import { useCallback, useEffect, useRef, useState } from 'react'
import { DICTATION_AUDIO_CONSTRAINTS } from '../audio/dictation.js'
import {
  absorb,
  EMPTY_LIVE_TRANSCRIPT,
  interimText,
  type LiveTranscript,
  tokensToText,
} from '../audio/live/live-tokens.js'
import { openSonioxStream, type SonioxStream, TIMESLICE_MS } from '../audio/live/soniox-stream.js'
import { api } from '../lib/api.js'

/**
 * The streaming half of prescription dictation (#357), kept out of
 * `PrescriptionBlock` because that component is already 800 lines and owns a
 * complete on-device state machine that this one does not replace.
 *
 * **It opens the second surface on the ambient audio egress, not a third
 * egress** (`docs/trd.md` §20.10, sign-off extended 10/09/26). Same vendor,
 * transport, region and minting route as ambient capture; what differs is the
 * recognition config the API hands back for `mode: 'dictation'` and the
 * two-minute session cap it mints with.
 *
 * **It constructs no socket of its own.** `openSonioxStream` is the only module
 * in the SPA permitted to hold one, pinned by `no-stray-websocket.test.ts`, and
 * this file is a caller rather than a second holder. It lives directly under
 * `review/` so `no-stray-transformers.test.ts` walks it as an entry point and a
 * stray value import of the inference library here fails that guard.
 */

/** Refused before the microphone opens, so nothing was captured. */
export const NOT_AGREED_ERROR =
  'This patient has not agreed to streaming recognition for this consultation.'
export const MIC_FAILED_ERROR = 'Microphone access was refused, or no microphone is available.'
/** The socket never opened or the key was never minted. Nothing was sent. */
export const START_FAILED_ERROR = 'Dictation could not start, and nothing was sent.'
/**
 * The socket closed with audio already flowing. There is no reconnect (#256),
 * so the settled words are kept and the doctor is told what may be missing
 * rather than shown a box that silently stopped growing.
 */
export const DROPPED_ERROR =
  'The connection was lost. What was transcribed is kept, and the last few words may be missing.'
/** `finish()` timed out waiting for the provider to acknowledge the end. */
export const SHORT_TAIL_NOTICE = 'The last word or two may be missing.'

export type DictationPhase = 'connecting' | 'streaming' | 'finishing'

export type DictationStream = {
  /** `null` means no run is in flight; the component's own phase machine owns idle. */
  phase: DictationPhase | null
  /** Settled text from this run only. The component joins it to what preceded it. */
  settled: string
  /** Provisional tokens, rendered outside the field. Never written into it. */
  interim: string
  micStream: MediaStream | null
  error: string | null
  clearError: () => void
  start: () => Promise<void>
  stop: () => void
}

/**
 * `onComplete` fires exactly once per run, whatever ended it: Stop, the
 * character cap, or a dropped socket. It carries the settled text and an
 * optional notice, and it is what the caller hangs its single parse call on.
 * Firing per token instead would move the candidate offsets under the doctor's
 * feet, because they index the text the server last read.
 */
export function useDictationStream({
  agreed,
  onComplete,
}: {
  /** Read at dispatch, never from a render closure. See `start`. */
  agreed: { readonly current: boolean }
  onComplete: (text: string, notice: string | null) => void
}): DictationStream {
  const [phase, setPhase] = useState<DictationPhase | null>(null)
  const [live, setLive] = useState<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attempt = useRef(0)
  const stream = useRef<SonioxStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const tracks = useRef<MediaStream | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const settled = useRef<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT)
  const stopping = useRef(false)

  // Assigned through a ref for the reason `PrescriptionBlock` does the same
  // with its worker handler: the socket callbacks are built once per run and
  // would otherwise close over the first render's `onComplete`.
  const complete = useRef(onComplete)
  useEffect(() => {
    complete.current = onComplete
  })

  const releaseMicrophone = useCallback(() => {
    const held = tracks.current
    tracks.current = null
    if (held !== null) for (const track of held.getTracks()) track.stop()
    setMicStream(null)
  }, [])

  /** Everything a run holds, dropped without firing a handler. */
  const teardown = useCallback(() => {
    attempt.current += 1
    inflight.current?.abort()
    inflight.current = null
    const socket = stream.current
    stream.current = null
    socket?.abort()
    const media = recorder.current
    recorder.current = null
    if (media !== null) {
      media.ondataavailable = null
      if (media.state !== 'inactive') media.stop()
    }
    releaseMicrophone()
  }, [releaseMicrophone])

  useEffect(() => () => teardown(), [teardown])

  const clearError = useCallback(() => setError(null), [])

  /**
   * Ends the run and delivers once.
   *
   * The recorder is stopped before the end frame is sent, because the reverse
   * order asks the provider to finish audio it has not been given yet. The wait
   * for its last chunk is bounded: a recorder that never fires `onstop` must
   * not strand a doctor holding a finished prescription.
   */
  const settle = useCallback(
    async (notice: string | null) => {
      if (stopping.current) return
      stopping.current = true
      const id = attempt.current
      setPhase('finishing')

      const media = recorder.current
      recorder.current = null
      if (media !== null && media.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          media.onstop = done
          const timer = setTimeout(done, 2_000)
          void timer
          media.stop()
        })
      }

      const socket = stream.current
      stream.current = null
      let short = false
      if (socket !== null) {
        const result = await socket.finish()
        short = !result.finished
      }
      if (attempt.current !== id) return

      releaseMicrophone()
      setPhase(null)
      const text = tokensToText(settled.current.final).trim()
      complete.current(text, notice ?? (short ? SHORT_TAIL_NOTICE : null))
    },
    [releaseMicrophone],
  )

  const stop = useCallback(() => {
    void settle(null)
  }, [settle])

  const start = useCallback(async () => {
    /*
     * The dispatcher backstop, not merely a disabled button. The tick can be
     * cleared between render and click, so this refusal is the one that counts,
     * and it refuses rather than quietly running the on-device worker instead:
     * a silent path switch gives a different result with no word that it
     * happened.
     */
    if (!agreed.current) {
      setError(NOT_AGREED_ERROR)
      return
    }

    setError(null)
    setPhase('connecting')
    stopping.current = false
    setLive(EMPTY_LIVE_TRANSCRIPT)
    settled.current = EMPTY_LIVE_TRANSCRIPT
    const id = attempt.current

    let microphone: MediaStream
    try {
      // Opened before the key is minted: the permission prompt is the slow
      // part, and the key lives thirty seconds.
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: DICTATION_AUDIO_CONSTRAINTS,
      })
    } catch {
      if (attempt.current !== id) return
      setPhase(null)
      setError(MIC_FAILED_ERROR)
      return
    }
    if (attempt.current !== id) {
      for (const track of microphone.getTracks()) track.stop()
      return
    }
    tracks.current = microphone

    const controller = new AbortController()
    inflight.current = controller
    try {
      const session = await api.createLiveSession(controller.signal, 'dictation')
      if (attempt.current !== id) {
        releaseMicrophone()
        return
      }

      // Tracked in the closure rather than read back from state, because
      // `setPhase` lands a render later and a socket failing in that gap would
      // be reported as a failure to start when audio was already flowing.
      let streaming = false

      const opened = openSonioxStream(session, {
        onOpen: () => {
          if (attempt.current !== id) return
          streaming = true
          const supported =
            typeof MediaRecorder !== 'undefined' &&
            MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
          const media = supported
            ? new MediaRecorder(microphone, { mimeType: 'audio/webm;codecs=opus' })
            : new MediaRecorder(microphone)
          media.ondataavailable = (event) => {
            if (attempt.current !== id) return
            if (event.data.size === 0) return
            // Sent and forgotten. Ambient retains chunks for its playback
            // surface (#293); there is none here, and a second
            // `createObjectURL` holder would fail the audio-persistence guard.
            opened.send(event.data)
          }
          recorder.current = media
          media.start(TIMESLICE_MS)
          setMicStream(microphone)
          setPhase('streaming')
        },
        onTokens: (tokens) => {
          if (attempt.current !== id) return
          setLive((current) => {
            const next = absorb(current, tokens)
            settled.current = next
            return next
          })
        },
        onFailure: () => {
          if (attempt.current !== id) return
          if (!streaming) {
            attempt.current += 1
            recorder.current = null
            stream.current = null
            releaseMicrophone()
            setPhase(null)
            setError(START_FAILED_ERROR)
            return
          }
          // Audio was flowing, so the settled words are real and are kept.
          setError(DROPPED_ERROR)
          void settle(DROPPED_ERROR)
        },
      })
      stream.current = opened
    } catch {
      if (attempt.current !== id) return
      releaseMicrophone()
      setPhase(null)
      setError(START_FAILED_ERROR)
    }
  }, [agreed, releaseMicrophone, settle])

  return {
    phase,
    settled: tokensToText(live.final),
    interim: interimText(live.interim),
    micStream,
    error,
    clearError,
    start,
    stop,
  }
}
