import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { keepRecording, recordingUrl } from './session-audio.js'

/**
 * Playing one transcript turn back from the consultation's own recording
 * (#293).
 *
 * The reason this exists is that a mis-transcription reads perfectly fluently.
 * A recogniser that invents a phrase produces a sentence the doctor cannot
 * distinguish from a correct one by looking at it, and the words this product
 * runs on are code-switched Malay and English, which is where recognisers are
 * least reliable. Playing the audio behind a sentence is the only way to settle
 * it.
 *
 * **Two sources, in that order.** The recording a capture just produced is
 * already in memory, so it plays without a round trip. On any later visit it is
 * fetched from the API, which holds it for the configured retention window.
 * Absent from both is an ordinary state, not a failure: the window may have
 * closed, storage may be switched off, or the transcript may have been typed.
 *
 * Lives outside the review page because that page is long enough already, and
 * because the seek-and-stop behaviour is worth testing on its own.
 */
export function useTranscriptAudio(consultationId: string) {
  const element = useRef<HTMLAudioElement>(null)
  /** Where the turn being played ends, or null to run to the end of the audio. */
  const stopAt = useRef<number | null>(null)
  const [src, setSrc] = useState(() => recordingUrl(consultationId))
  const [playing, setPlaying] = useState<string | undefined>(undefined)

  /*
   * Falls back to the stored recording when memory has none, which is every
   * visit after the one that captured it.
   *
   * Guarded against a consultation change mid-flight, so a slow fetch for the
   * record the doctor just navigated away from cannot hand its audio to the one
   * they are now looking at. A failure is swallowed: the transcript is still
   * perfectly readable without audio, and a banner would report a problem the
   * doctor cannot act on.
   */
  useEffect(() => {
    const held = recordingUrl(consultationId)
    setSrc(held)
    setPlaying(undefined)
    stopAt.current = null
    if (held !== undefined) return

    let current = true
    void api
      .getConsultationAudio(consultationId)
      .then((recording) => {
        if (!current || recording === null) return
        /*
         * A recording captured while this fetch was in flight wins. `current`
         * only tracks unmount and a change of consultation, so without this a
         * slow GET could land after `keep()` stored a fresh take and replace it
         * with the older stored copy, revoking the new one's URL on the way.
         * The doctor would then be checking a sentence against the wrong audio,
         * which is worse than having none.
         */
        if (recordingUrl(consultationId) !== undefined) return
        keepRecording(consultationId, recording)
        setSrc(recordingUrl(consultationId))
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [consultationId])

  const stop = useCallback(() => {
    stopAt.current = null
    element.current?.pause()
    setPlaying(undefined)
  }, [])

  /**
   * Takes the recording a capture just produced and stores it.
   *
   * Shown immediately from memory rather than waiting on the upload, so the
   * doctor can play a sentence back the moment the transcript settles. The
   * upload is what makes it survive the tab closing; its failure costs the
   * later visit, not this one.
   */
  const keep = useCallback(
    (blob: Blob) => {
      keepRecording(consultationId, blob)
      setSrc(recordingUrl(consultationId))
      void api.putConsultationAudio(consultationId, blob).catch(() => {})
    },
    [consultationId],
  )

  const play = useCallback(
    (key: string, startSeconds: number, endSeconds?: number) => {
      const node = element.current
      if (node === null) return
      // A second press on the turn already playing stops it. Without this the
      // only way to stop is to wait it out, and a doctor who clicked the wrong
      // line has no way back.
      if (playing === key) {
        stop()
        return
      }

      stopAt.current = endSeconds ?? null
      setPlaying(key)

      const go = () => {
        node.currentTime = startSeconds
        void node.play().catch(() => {
          // Autoplay policy, a decoding failure, or a stop that raced the
          // load. None of them are worth a banner over a transcript that is
          // still perfectly readable, but the row must not stay lit.
          stopAt.current = null
          setPlaying(undefined)
        })
      }
      // Seeking before metadata arrives silently does nothing, and the turn
      // would play from the top of the consultation instead of from itself.
      if (node.readyState >= HAVE_METADATA) go()
      else node.addEventListener('loadedmetadata', go, { once: true })
    },
    [playing, stop],
  )

  /**
   * Stops at the end of the turn rather than running on into the next one.
   *
   * `timeupdate` fires about four times a second, so this overshoots by up to a
   * quarter of a second. That is why `serialiseTurns` ceils the stored end: the
   * pair errs towards playing a little too much, never towards clipping the
   * last word, which is the one most worth hearing.
   */
  const onTimeUpdate = useCallback(() => {
    const node = element.current
    const end = stopAt.current
    if (node === null || end === null) return
    if (node.currentTime >= end) stop()
  }, [stop])

  return {
    /** Spread onto the page's single `<audio>` element. */
    audioProps: {
      ref: element,
      src,
      preload: 'metadata' as const,
      onTimeUpdate,
      onEnded: stop,
    },
    /** Whether there is a recording to play at all. */
    available: src !== undefined,
    /** The key of the turn currently playing, for the row to show it. */
    playing,
    play,
    keep,
  }
}

/** `HTMLMediaElement.HAVE_METADATA`, named so the comparison reads. */
const HAVE_METADATA = 1
