import type { DraftTurn, InterpretedLanguage, LiveAsrConfig, LiveSession } from '@shared/types'
import { MAX_DRAFT_TEXT_CHARACTERS } from '@shared/types'
import { Loader2, Maximize2, Mic, Minimize2, Square } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api.js'
import { Button } from '../../ui/Button.js'
import { InfoTip } from '../../ui/InfoTip.js'
import { Select } from '../../ui/Select.js'
import { ConsentGate } from '../ConsentGate.js'
import type { MarkedSegment } from '../draft-turns.js'
import { InputMeter } from '../InputMeter.js'
import {
  bilingualDelivery,
  bilingualDisplay,
  bilingualLiveSegments,
  INTERPRETED_LANGUAGE_NAMES,
  interimLanguage,
  type OtherLanguage,
  tokensToBilingualTurns,
} from './bilingual.js'
import { LiveConversation } from './LiveConversation.js'
import type { LiveFoldSegment } from './live-fold.js'
import {
  absorb,
  EMPTY_LIVE_TRANSCRIPT,
  fromConnection,
  interimSpeaker,
  interimText,
  type LiveTranscript,
  tokensToSegments,
  tokensToText,
} from './live-tokens.js'
import { openSonioxStream, type SonioxStream, TIMESLICE_MS } from './soniox-stream.js'

/**
 * Ambient capture: the room is transcribed while the consultation happens.
 *
 * The sibling of `AudioCapture`, not a replacement for it. That component owns
 * press-to-record and is deliberately untouched; this one owns the continuous
 * path, and the Record tab shows exactly one of them.
 *
 * **The audio does not pass through our API.** The browser opens its own
 * recognition socket under a short-lived key the API mints, because a socket
 * cannot cross the rewrite that makes the session cookie first-party. What the
 * server still decides is everything except the bytes: who may ask, how often,
 * for how long, and what gets written down about it.
 *
 * The consent tick lives here in plain `useState` and is remembered by nothing,
 * exactly as it does in `AudioCapture`. The mode preference in the Audio dialog
 * says where audio would go; this says whether this patient's may.
 */

// Re-exported so `AmbientCapture.test.tsx` keeps importing it from here; it
// now lives beside the socket's other timing constants (#357).
export { TIMESLICE_MS }

/** Bound on the labelling pass, shared with the hosted path it reuses. */
const LABEL_TIMEOUT_MS = 150_000

/** How long to wait for the recorder to hand over its final chunk. */
const RECORDER_STOP_TIMEOUT_MS = 2_000

const START_FAILED_ERROR =
  'Ambient capture could not start, and nothing was sent. Try again, or switch to Press To Record.'

const MIC_FAILED_ERROR =
  'No microphone available. Check the browser permission for this site, then try again.'

const DROPPED_ERROR =
  'Capture stopped: the connection was lost. Everything already transcribed is kept, but the last few words may be missing. Start again to continue.'

/**
 * How a dropped socket is retried (#256): at once, then after one and three
 * more seconds. A clinic wifi blip is seconds long, and past these the doctor
 * is better told than kept waiting.
 */
const RECONNECT_DELAYS_MS = [0, 1_000, 3_000]

/**
 * The most audio held for a socket that is not back yet. It is queued in
 * memory only, and a consultation is better restarted than caught up by more.
 */
const MAX_BEHIND_MS = 60_000

const RECONNECTED_NOTICE =
  'The connection dropped and came back. Words spoken around the drop may be missing, so check that part of the transcript.'

const UNSENT_TAIL_ERROR =
  'Stopped while reconnecting, so the last few seconds were not transcribed. Check the end of the transcript.'

/** Built the same way for the first socket and every reopened one. */
function buildRecorder(microphone: MediaStream): MediaRecorder {
  const supported =
    typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
  return supported
    ? new MediaRecorder(microphone, { mimeType: 'audio/webm;codecs=opus' })
    : new MediaRecorder(microphone)
}

/** Stops a recorder and waits, bounded, for its last chunk. */
function stopRecorder(active: MediaRecorder | null): Promise<void> {
  if (!active || active.state === 'inactive') return Promise.resolve()
  // Bounded, because a recorder that never fires `onstop` would otherwise
  // strand the screen mid-stop with no way forward. Two seconds is far beyond
  // the real path, which resolves on the next task.
  return new Promise<void>((resolve) => {
    const give = window.setTimeout(resolve, RECORDER_STOP_TIMEOUT_MS)
    active.onstop = () => {
      window.clearTimeout(give)
      resolve()
    }
    active.stop()
  })
}

/** Detaches a recorder's handlers before stopping it, so nothing re-enters. */
function discardRecorder(active: MediaRecorder | null) {
  if (!active) return
  active.ondataavailable = null
  active.onstop = null
  if (active.state !== 'inactive') active.stop()
}

/**
 * Shown after a stop the provider never acknowledged.
 *
 * The stream client manufactures that signal rather than pretending the drain
 * succeeded, so discarding it here would hand the doctor a transcript that
 * looks complete and is not. The tail is the end of a consultation, which is
 * where a plan usually is.
 */
const SHORT_TAIL_NOTICE =
  'The transcription service did not confirm the end of the recording, so the last few words may be missing. Check the end of the transcript.'

/**
 * Shown when the API minted a session without the translation asked for.
 *
 * That is an API deployed behind this bundle: it ignores the field and mints
 * plain ambient. Starting anyway would give a patient who cannot follow
 * English a transcript in words they never said, with nothing saying why, so
 * the session is refused before any audio is sent.
 */
const TRANSLATION_UNAVAILABLE_ERROR =
  'Translation is not available right now, and nothing was sent. Choose Auto-Detect, or try again shortly.'

type Phase = 'idle' | 'starting' | 'listening' | 'finishing' | 'labelling'

type Availability =
  | { status: 'loading' }
  | { status: 'ready'; config: LiveAsrConfig }
  | { status: 'unavailable' }
  | { status: 'error' }

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

export function AmbientCapture({
  onTranscript,
  onSwitchToManual,
  onUnavailable,
  onLiveChange,
  onLiveSegments,
  deviceId,
  conversationExpanded = false,
  onConversationExpandedChange,
  prompter,
  patientName,
}: {
  onTranscript: (result: {
    text: string
    /*
     * `MarkedSegment` rather than `TranscriptSegment`, because ambient capture
     * measures a per-token confidence and folds it into character ranges the
     * doctor is shown (#309). Declaring the narrower type would have carried the
     * ranges anyway and hidden them from every reader.
     */
    segments: readonly MarkedSegment[]
    source: 'asr_live'
    draftTurns?: readonly DraftTurn[]
    /**
     * Index for index with `draftTurns` on a translated session (#393): each
     * turn's other language, the words said or the translation shown.
     */
    otherLanguages?: readonly (OtherLanguage | null)[]
    /** The language a translated session paired with English. */
    translation?: InterpretedLanguage
    /** The consultation's audio, for playing a sentence back in review (#293). */
    audio?: Blob
  }) => void
  /** Returns the Record tab to press-to-record, and remembers that choice. */
  onSwitchToManual: () => void
  /**
   * Fired once the config probe says this deployment has no ambient provider,
   * so the Record tab can show the recorder that does work (#378).
   *
   * **The caller is expected to move the consultation to press-to-record, not
   * merely to show it.** Leaving the record on `ambient` while the doctor
   * records some other way is what stamps a consultation with a stream that
   * never happened, and the mode locks the instant a transcript lands, so the
   * window to be honest about it is exactly here.
   *
   * Unavailability only, never a transient error, which is why the probe reads
   * the error code and not just the status. An error keeps this panel and its
   * Check Again button, because there is something to retry.
   */
  onUnavailable?: () => void
  /** Latches the panel open while a session runs, so a settings save cannot unmount it. */
  onLiveChange: (live: boolean) => void
  /**
   * The settled segments, as they accumulate, so the live panes can read the
   * consultation while it is still being spoken (#219).
   *
   * Fires on settled tokens only, never on interim ones: provisional text is
   * re-sent in full and rewritten as the speaker talks, and analysing it would
   * mean sending words the patient did not finish saying. Optional, so the
   * component is unchanged for any caller that does not want the panes.
   *
   * **English only on a translated session** (#393), each segment carrying the
   * role its language settled, so no script the gate cannot read reaches the
   * live analysis model.
   */
  onLiveSegments?: (segments: readonly LiveFoldSegment[]) => void
  /** The input chosen in the Audio dialog. `null` leaves the choice to the browser. */
  deviceId?: string | null
  /**
   * Whether the conversation is showing in its own full-viewport dialog (#287).
   *
   * Owned by the review page rather than here, because the page has to know:
   * it renders the prompter into the companion column when the theatre is
   * docked, and passes the same element in as `prompter` when it is open, so
   * exactly one instance of a panel carrying red flags is ever mounted.
   */
  conversationExpanded?: boolean
  onConversationExpandedChange?: (expanded: boolean) => void
  /**
   * The live safety panel, rendered inside the theatre.
   *
   * A slot rather than a component this file builds, because the panes it reads
   * come from `useLivePanes` on the review page while the transcript comes from
   * this component's own socket state. Passing the element down is what lets the
   * two sit side by side without lifting the capture state out of here, which
   * would remount the socket.
   */
  prompter?: ReactNode
  /** Shown in the theatre's title bar, so the doctor knows whose room this is. */
  patientName?: string
}) {
  const [availability, setAvailability] = useState<Availability>({ status: 'loading' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [agreed, setAgreed] = useState(false)
  const [live, setLive] = useState<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  /** When the socket dropped, while it is being reopened (#256). */
  const [downSince, setDownSince] = useState<number | null>(null)
  /**
   * The patient's language when the consultation is interpreted (#393). `null`
   * is auto-detect, which the recogniser transcribes as spoken.
   */
  const [translation, setTranslation] = useState<InterpretedLanguage | null>(null)
  /**
   * The pair the running session was minted with, set only once the API has
   * confirmed it, so the conversation never renders a pair the socket is not
   * producing.
   */
  const [interpreting, setInterpreting] = useState<InterpretedLanguage | null>(null)
  const conversationDialog = useRef<HTMLDialogElement>(null)

  /*
   * The theatre is only ever open while the room is actually being heard, so
   * the page's request and this component's phase both have to agree. That also
   * means a session ending closes it without the page having to remember to.
   */
  const expanded = conversationExpanded && phase === 'listening'

  /*
   * The theatre is asked for here rather than from the page's capture-busy
   * callback, because that callback also fires for press-to-record, which has
   * no live conversation and therefore no dialog to hold the safety panel.
   * Opening from there withheld the companion column during a manual recording
   * and left the prompter with nowhere to render at all.
   *
   * Keyed on `phase`, so docking mid-consultation is not undone: nothing
   * re-fires until the session itself starts or ends.
   */
  const onConversationExpandedChangeRef = useRef(onConversationExpandedChange)
  useEffect(() => {
    onConversationExpandedChangeRef.current = onConversationExpandedChange
  })

  useEffect(() => {
    onConversationExpandedChangeRef.current?.(phase === 'listening')
  }, [phase])

  /*
   * Push, not pull. It opens when capture starts rather than waiting to be
   * asked, because a doctor mid-consultation will not stop to press Expand, and
   * a pane nobody expands is the clipped window this replaced.
   *
   * Escape still closes it, and closing docks rather than stops: the inline
   * capture layout underneath keeps the safety panel on screen, so no path
   * leaves a red flag unreachable.
   */
  useEffect(() => {
    const node = conversationDialog.current
    if (!node) return
    /*
     * `showModal` and `close` are guarded because jsdom implements neither, the
     * same reason `LiveConversation` guards `scrollTo`. Falling back to the
     * `open` attribute is not a no-op: it is what the UA stylesheet keys on, so
     * the contents leave `display: none` and enter the accessibility tree,
     * which is the part of the difference a test can see. Real browsers take
     * the first branch and get the top layer, focus trap and Escape with it.
     */
    if (!expanded) {
      if (typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
      return
    }
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    /*
     * `showModal()` runs its autofocus pass before conditionally rendered
     * children have mounted, so focus lands on the dialog itself and the first
     * Tab goes nowhere useful. Same fix, and same reason, as the overflow
     * dialog in `ConsultationReview`.
     */
    node.querySelector('button')?.focus()
  }, [expanded])

  /*
   * Bumped on every stop, failure and unmount. Every async continuation below
   * checks it before touching state, so a late resolution from a session the
   * doctor has already ended changes nothing. Same discipline as
   * `AudioCapture`'s.
   */
  const attempt = useRef(0)
  const agreedRef = useRef(false)
  const stream = useRef<SonioxStream | null>(null)
  /** The recorder feeding the socket now. A reconnect gives it a fresh one. */
  const recorder = useRef<MediaRecorder | null>(null)
  /**
   * The recorder behind the playback copy (#293), which runs the whole
   * consultation.
   *
   * It is the first socket's recorder too, and it outlives a drop (#256): a
   * reopened socket needs a stream with its own container header, so it gets a
   * recorder of its own, while this one keeps the recording a single container
   * whose clock the transcript's offsets still index into.
   */
  const archive = useRef<MediaRecorder | null>(null)
  /** When the archive started, which every connection's clock is moved to. */
  const startedAt = useRef(0)
  /** How many times the socket has been reopened this session. */
  const connection = useRef(0)
  /** The minted cap on the whole capture, in milliseconds, when the API gave one. */
  const capMs = useRef<number | null>(null)
  /** True from a drop until a socket is streaming again. */
  const down = useRef(false)
  const tracks = useRef<MediaStream | null>(null)
  const inflight = useRef<AbortController | null>(null)
  /** True once the doctor has pressed stop, so no other path may deliver. */
  const stopping = useRef(false)
  /**
   * The consultation's audio, accumulated so the doctor can hear a sentence
   * back while reviewing the transcript (#293).
   *
   * **This is not a new egress.** Every one of these chunks is already being
   * sent to the recogniser as it is produced; the change is that a reference is
   * kept as well as sent, so the recording still exists once the words come
   * back. Nothing uploads it, and `session-audio.ts` holds the result in memory
   * only.
   *
   * The first chunk carries the container header, so the array is only ever
   * assembled whole. Slicing off a later chunk gives an undecodable file.
   */
  const chunks = useRef<Blob[]>([])
  const mime = useRef<string>('')
  const settled = useRef<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT)
  /** `interpreting` for the callbacks, which must not wait for a render. */
  const pair = useRef<InterpretedLanguage | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onLiveChangeRef = useRef(onLiveChange)
  const onLiveSegmentsRef = useRef(onLiveSegments)
  const onUnavailableRef = useRef(onUnavailable)

  useEffect(() => {
    agreedRef.current = agreed
  }, [agreed])

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onLiveChangeRef.current = onLiveChange
    onLiveSegmentsRef.current = onLiveSegments
    onUnavailableRef.current = onUnavailable
  })

  /*
   * Keyed on `live.final` rather than on `live`, which is what keeps the panes
   * off the interim path: `absorb` returns the previous `final` array by
   * reference when a message carried no settled tokens, so this does not run
   * while provisional text is churning.
   */
  useEffect(() => {
    const language = pair.current
    onLiveSegmentsRef.current?.(
      language === null
        ? tokensToSegments(live.final)
        : bilingualLiveSegments(tokensToBilingualTurns(live.final), language),
    )
  }, [live.final])

  const loadConfig = useCallback(() => {
    const id = attempt.current
    setAvailability({ status: 'loading' })
    api
      .liveAsrConfig('ambient')
      .then((config) => {
        if (attempt.current === id) setAvailability({ status: 'ready', config })
      })
      .catch((cause: unknown) => {
        if (attempt.current !== id) return
        // A deployment with no ambient provider is a plain unavailability with
        // a way out, not an error the doctor has to interpret.
        /*
         * The code as well as the status, because the status alone does not
         * mean what it looks like: a Render cold start and any platform hiccup
         * through the `/api` rewrite also answer 503, and `ApiError` is built
         * from the raw HTTP status. Reading only the number would report a
         * transient outage as "this deployment has no ambient provider", and
         * `onUnavailable` acts on that by writing the consultation's mode.
         */
        const unavailable =
          cause instanceof ApiError && cause.status === 503 && cause.code === 'asr_unavailable'
        setAvailability(unavailable ? { status: 'unavailable' } : { status: 'error' })
        // Through the ref so the callback's identity cannot re-enter this
        // effect: `loadConfig` is its own `useEffect` dependency, and an inline
        // arrow from the caller would re-probe on every render.
        if (unavailable) onUnavailableRef.current?.()
      })
  }, [])

  useEffect(loadConfig, [loadConfig])

  /** Stops only the tracks this component opened. Nothing borrowed is touched. */
  const releaseMicrophone = useCallback(() => {
    for (const track of tracks.current?.getTracks() ?? []) track.stop()
    tracks.current = null
    setMicStream(null)
  }, [])

  const teardown = useCallback(() => {
    // Detached first: a stop this component initiated must not re-enter the
    // delivery path through a handler that is about to be discarded.
    discardRecorder(recorder.current)
    discardRecorder(archive.current)
    recorder.current = null
    archive.current = null
    stream.current?.abort()
    stream.current = null
    inflight.current?.abort()
    inflight.current = null
    releaseMicrophone()
  }, [releaseMicrophone])

  useEffect(
    () => () => {
      attempt.current += 1
      teardown()
      onLiveChangeRef.current(false)
    },
    [teardown],
  )

  useEffect(() => {
    if (phase !== 'listening') return
    const tick = window.setInterval(() => setSeconds((s) => s + 1), 1_000)
    return () => window.clearInterval(tick)
  }, [phase])

  /**
   * Hands the settled transcript to the page, labelled where possible.
   *
   * The labelling pass is the hosted path's, reused unchanged: it sends only
   * text, the API de-identifies it before any model sees it, and every failure
   * resolves to unlabelled prose rather than losing the consultation.
   */
  const deliver = useCallback(async (transcript: LiveTranscript) => {
    const takeRecording = (): Blob | undefined => {
      const recording =
        chunks.current.length > 0
          ? new Blob(chunks.current, ...(mime.current ? [{ type: mime.current }] : []))
          : undefined
      chunks.current = []
      return recording
    }

    /*
     * A translated session takes no labelling pass (#393). Its roles came from
     * the language each line was spoken in, which is firmer ground than a model
     * reading the English, and the pass re-slices turns the pairs are aligned
     * to one for one.
     */
    const language = pair.current
    if (language !== null) {
      const bilingual = bilingualDelivery(tokensToBilingualTurns(transcript.final), language)
      if (bilingual.text.trim() === '') {
        setPhase('idle')
        return
      }
      const recording = takeRecording()
      onTranscriptRef.current({
        text: bilingual.text,
        segments: bilingual.segments,
        source: 'asr_live',
        draftTurns: bilingual.draftTurns,
        otherLanguages: bilingual.others,
        translation: language,
        ...(recording ? { audio: recording } : {}),
      })
      setPhase('idle')
      return
    }

    const text = tokensToText(transcript.final)
    const segments = tokensToSegments(transcript.final)
    if (text.trim() === '') {
      setPhase('idle')
      return
    }

    let draftTurns: readonly DraftTurn[] | null = null
    if (text.length <= MAX_DRAFT_TEXT_CHARACTERS) {
      setPhase('labelling')
      const controller = new AbortController()
      inflight.current = controller
      const bound = window.setTimeout(() => controller.abort(), LABEL_TIMEOUT_MS)
      try {
        draftTurns = await api.draftHostedTurns(text, controller.signal)
      } catch {
        draftTurns = null
      } finally {
        window.clearTimeout(bound)
        if (inflight.current === controller) inflight.current = null
      }
    }

    const recording = takeRecording()

    onTranscriptRef.current({
      text,
      segments,
      source: 'asr_live',
      ...(draftTurns && draftTurns.length > 0 ? { draftTurns } : {}),
      ...(recording ? { audio: recording } : {}),
    })
    setPhase('idle')
  }, [])

  const onStreamFailure = useCallback(() => {
    // The stop path has already claimed the transcript and is mid-drain.
    if (stopping.current) return
    attempt.current += 1
    discardRecorder(recorder.current)
    discardRecorder(archive.current)
    recorder.current = null
    archive.current = null
    stream.current?.abort()
    stream.current = null
    down.current = false
    setDownSince(null)
    releaseMicrophone()
    onLiveChangeRef.current(false)
    setError(DROPPED_ERROR)
    // Whatever settled before the drop is still a true record of the
    // consultation, so it is delivered rather than discarded.
    if (settled.current.final.length > 0) void deliver(settled.current)
    else setPhase('idle')
  }, [deliver, releaseMicrophone])

  /**
   * Reopens a socket that dropped mid-consultation (#256).
   *
   * A fresh recorder starts at once and queues what is said while a new key is
   * minted, so the words spoken during the outage are sent late rather than
   * lost. Only a plain drop is retried: a refusal or a message off contract
   * still ends the session, and so does reaching the minted cap, because
   * reopening past it would make the cap a number rather than a bound.
   */
  const reconnect = useCallback(
    async (id: number) => {
      if (stopping.current || attempt.current !== id) return
      const microphone = tracks.current
      const lostAt = Date.now()
      const cap = capMs.current
      if (!microphone || (cap !== null && lostAt - startedAt.current >= cap)) {
        onStreamFailure()
        return
      }

      // The dropped socket's own recorder ends here, unless it is the archive.
      if (recorder.current !== archive.current) discardRecorder(recorder.current)
      stream.current = null
      down.current = true
      setDownSince(lostAt)
      // The dropped socket's provisional words will never settle.
      settled.current = { final: settled.current.final, interim: [] }
      setLive(settled.current)

      const queued: Blob[] = []
      let target: SonioxStream | null = null
      const media = buildRecorder(microphone)
      media.ondataavailable = (event) => {
        if (attempt.current !== id || event.data.size === 0) return
        if (target?.state === 'streaming') target.send(event.data)
        else queued.push(event.data)
      }
      media.start(TIMESLICE_MS)
      recorder.current = media
      const offsetMs = lostAt - startedAt.current
      connection.current += 1
      const heard = connection.current
      const requested = pair.current

      for (const delay of RECONNECT_DELAYS_MS) {
        if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
        if (stopping.current || attempt.current !== id) return
        if (Date.now() - lostAt > MAX_BEHIND_MS) break

        const controller = new AbortController()
        inflight.current = controller
        let minted: LiveSession
        try {
          minted =
            requested === null
              ? await api.createLiveSession(controller.signal, 'ambient', true)
              : await api.createLiveSession(controller.signal, 'ambient', true, requested)
        } catch {
          continue
        } finally {
          if (inflight.current === controller) inflight.current = null
        }
        if (stopping.current || attempt.current !== id) return
        // The pair the session is reopened with must be the pair it began with.
        if (requested !== null && minted.config.translation?.languageA !== requested) break

        let opened = false
        const reopened = await new Promise<SonioxStream | null>((resolve) => {
          const candidate = openSonioxStream(minted, {
            onOpen: () => {
              opened = true
              resolve(candidate)
            },
            onTokens: (tokens) => {
              if (attempt.current !== id) return
              const next = absorb(settled.current, fromConnection(tokens, offsetMs, heard))
              settled.current = next
              setLive(next)
            },
            onFailure: (failure) => {
              if (!opened) {
                resolve(null)
                return
              }
              if (attempt.current !== id) return
              if (failure === 'closed') void reconnectRef.current(id)
              else onStreamFailure()
            },
          })
          stream.current = candidate
        })
        if (!reopened) continue
        if (stopping.current || attempt.current !== id) {
          reopened.abort()
          return
        }
        for (const chunk of queued.splice(0)) reopened.send(chunk)
        target = reopened
        down.current = false
        setDownSince(null)
        setError(RECONNECTED_NOTICE)
        return
      }

      if (stopping.current || attempt.current !== id) return
      onStreamFailure()
    },
    [onStreamFailure],
  )
  const reconnectRef = useRef(reconnect)
  useEffect(() => {
    reconnectRef.current = reconnect
  })

  const start = useCallback(async () => {
    if (availability.status !== 'ready') return
    // The dispatcher backstop, not merely a disabled button: the tick can be
    // cleared between render and click, and a refusal here is the one that
    // counts.
    if (!agreedRef.current) return

    setError(null)
    setPhase('starting')
    stopping.current = false
    down.current = false
    setDownSince(null)
    connection.current = 0
    setLive(EMPTY_LIVE_TRANSCRIPT)
    settled.current = EMPTY_LIVE_TRANSCRIPT
    // Cleared with the transcript, not after delivery: a session that failed
    // to start must never leave the previous consultation's audio behind for
    // this one to hand over as its own.
    chunks.current = []
    mime.current = ''
    setSeconds(0)
    const requested = translation
    pair.current = null
    setInterpreting(null)
    const id = attempt.current

    let microphone: MediaStream
    try {
      // Asked for first, before the key is minted: the permission prompt can
      // sit for a long time, and a key that expires while it does is wasted.
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          /*
           * The doctor's chosen input, honoured rather than left to the
           * browser. Without this the Microphone select in the Audio dialog is
           * decorative here, and the browser picks for itself: measured
           * 07/09/26 on a Windows machine with a screen-capture tool
           * installed, `audio: true` selected that tool's virtual device over
           * the real array, so the meter read Silent and nothing reached the
           * recogniser. A capture surface that quietly records the wrong
           * device is worse than one that fails.
           *
           * `toConstraints` in `../audio-settings.ts` is deliberately not
           * reused: it turns the DSP back on, and §20.6 measured that off for
           * dictation. Only the device is taken from settings.
           */
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch {
      if (attempt.current !== id) return
      setPhase('idle')
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
      const session =
        requested === null
          ? await api.createLiveSession(controller.signal, 'ambient', true)
          : await api.createLiveSession(controller.signal, 'ambient', true, requested)
      if (attempt.current !== id) {
        releaseMicrophone()
        return
      }

      // The minted config, not the request, says what the socket will do.
      if (requested !== null && session.config.translation?.languageA !== requested) {
        releaseMicrophone()
        setPhase('idle')
        setError(TRANSLATION_UNAVAILABLE_ERROR)
        return
      }
      pair.current = requested
      setInterpreting(requested)

      /*
       * Whether audio ever started flowing, tracked in the closure rather than
       * read back from React state: `setPhase` lands a render later, and a
       * socket that fails in that gap would be reported as a failure to start
       * when the microphone was already live.
       */
      let streaming = false

      const opened = openSonioxStream(session, {
        onOpen: () => {
          if (attempt.current !== id) return
          streaming = true
          const media = buildRecorder(microphone)
          media.ondataavailable = (event) => {
            if (attempt.current !== id) return
            if (event.data.size === 0) return
            opened.send(event.data)
            chunks.current.push(event.data)
          }
          mime.current = media.mimeType
          recorder.current = media
          archive.current = media
          startedAt.current = Date.now()
          capMs.current =
            session.maxSessionSeconds === undefined ? null : session.maxSessionSeconds * 1_000
          media.start(TIMESLICE_MS)
          setMicStream(microphone)
          setPhase('listening')
          onLiveChangeRef.current(true)
        },
        onTokens: (tokens) => {
          if (attempt.current !== id) return
          /*
           * Folded here rather than inside a state updater, which React runs
           * at the next render. A message landing just before Stop could still
           * be queued when `deliver` read `settled.current`, and a translation
           * is exactly what lands last: it follows the words it translates.
           */
          const next = absorb(settled.current, tokens)
          settled.current = next
          setLive(next)
        },
        onFailure: (failure) => {
          if (attempt.current !== id) return
          if (!streaming) {
            attempt.current += 1
            recorder.current = null
            stream.current = null
            releaseMicrophone()
            setPhase('idle')
            setError(START_FAILED_ERROR)
            return
          }
          if (failure === 'closed') void reconnectRef.current(id)
          else onStreamFailure()
        },
      })
      stream.current = opened
    } catch {
      if (attempt.current !== id) return
      releaseMicrophone()
      setPhase('idle')
      setError(START_FAILED_ERROR)
    } finally {
      if (inflight.current === controller) inflight.current = null
    }
  }, [availability, deviceId, onStreamFailure, releaseMicrophone, translation])

  const stop = useCallback(async () => {
    const active = recorder.current
    const opened = stream.current
    /*
     * Claims delivery before anything can go wrong inside the drain. A socket
     * that dies while `finish()` is awaited would otherwise reach the failure
     * path, which holds the same settled transcript and would deliver it a
     * second time, appending the consultation to itself.
     *
     * A dedicated flag rather than the attempt counter, which was the first
     * attempt at this and was wrong: bumping the counter also silences the
     * recorder's own `ondataavailable`, so the final chunk was dropped and the
     * end of the consultation went with it.
     */
    stopping.current = true
    setPhase('finishing')
    // Read before anything settles: a stop mid-reconnect has audio queued for a
    // socket that never came back, and that is said rather than glossed.
    const unsent = down.current
    down.current = false
    setDownSince(null)

    const kept = archive.current
    await Promise.all([stopRecorder(active), kept === active ? undefined : stopRecorder(kept)])
    recorder.current = null
    archive.current = null

    // The last chunk has been handed over by now, so the end frame cannot
    // arrive ahead of audio the provider still needs.
    if (unsent) opened?.abort()
    const drained = unsent ? undefined : await opened?.finish()
    stream.current = null
    releaseMicrophone()
    onLiveChangeRef.current(false)

    // `finished: false` means the provider never acknowledged the end, so what
    // it still held is lost. Saying so is the difference between a short
    // transcript and a short transcript the doctor knows about.
    if (unsent) setError(UNSENT_TAIL_ERROR)
    else if (opened && drained?.finished === false) setError(SHORT_TAIL_NOTICE)

    await deliver(settled.current)
  }, [deliver, releaseMicrophone])

  const busy = phase === 'starting' || phase === 'finishing' || phase === 'labelling'
  const busyLabel =
    phase === 'starting'
      ? 'Connecting'
      : phase === 'finishing'
        ? 'Finishing, waiting for the last words'
        : 'Drafting speaker labels'

  if (availability.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-ink-muted text-sm">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        <span>Checking ambient capture</span>
      </div>
    )
  }

  if (availability.status !== 'ready') {
    return (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-ink">
          {availability.status === 'unavailable'
            ? 'Ambient capture is not available on this deployment.'
            : 'Ambient capture could not be reached.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="neutral" onClick={onSwitchToManual}>
            Use Press To Record
          </Button>
          {availability.status === 'error' && (
            <Button variant="secondary" onClick={loadConfig}>
              Check Again
            </Button>
          )}
        </div>
      </div>
    )
  }

  /*
   * Offered only as the API advertises them, so a picker never offers a pair
   * the deployment behind it cannot mint. An older API sends no list at all.
   */
  const offered = availability.config.availableTranslations ?? []
  const conversation =
    interpreting === null
      ? {
          mode: 'speakers' as const,
          segments: tokensToSegments(live.final),
          interimSpeaker: interimSpeaker(live.interim),
          note: 'Speakers are numbered while recording. Roles are assigned when you stop.',
        }
      : {
          mode: 'languages' as const,
          segments: bilingualDisplay(tokensToBilingualTurns(live.final)),
          interimSpeaker: interimLanguage(live.interim),
          note: 'Translations are machine-generated. Check anything important with the patient.',
        }

  return (
    <div className="grid gap-4">
      {phase === 'idle' && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm">Not Listening</span>
            {/* `layered` because the transcript column is a scroll box from `lg`
                up, and `overflow-y: auto` drags `overflow-x` to `auto` with it,
                so an in-flow panel is clipped on the right. The column is 380px
                and this panel is 288px anchored 110px in, so it was losing the
                end of every line. Left-aligned, which is the default: this
                column is the leftmost one, so the panel has the whole page to
                open into, while right-aligning it would push it off the far
                side of the viewport. */}
            <InfoTip label="About speaker labels" layered>
              Speaker labels are automatic. Check them before submitting.
            </InfoTip>
          </div>
          <p className="text-ink-muted text-xs">
            Ambient Capture transcribes the consultation as it happens.
          </p>
        </div>
      )}

      {phase === 'idle' && offered.length > 0 && (
        <div className="grid gap-1.5">
          <span className="font-semibold text-xs">Patient&apos;s Language</span>
          <Select
            label="Patient's language"
            value={translation ?? ''}
            options={[
              { value: '', label: 'Auto-Detect' },
              ...offered.map((language) => ({
                value: language,
                label: `${INTERPRETED_LANGUAGE_NAMES[language]} (Translated)`,
              })),
            ]}
            onChange={(value) => {
              const next = offered.find((language) => language === value) ?? null
              if (next === translation) return
              setTranslation(next)
              // The tick agreed to a different promise, so it is asked again.
              setAgreed(false)
            }}
          />
          <p className="text-ink-muted text-xs">
            {translation === null
              ? 'Detects English, Malay, Mandarin and Tamil, even when mixed in one sentence. Cantonese is not supported. No translation.'
              : 'Both of you see each line with its translation. Translations are machine-generated. Check anything important with the patient.'}
          </p>
        </div>
      )}

      {/* `null`, not omitted: the default is the relay's sentence, and falling
          through to it would say the audio is processed in Malaysia on the one
          path that streams to the United States. The residency disclosure was
          removed here on 10/09/26 on the owner's instruction, so the tick is
          the whole of what this surface asks (`docs/decisions.md` D-004). */}
      <ConsentGate
        agreed={agreed}
        onAgreedChange={setAgreed}
        disabled={phase !== 'idle'}
        disclosure={null}
        translated={translation !== null}
      />

      {error && (
        <p role="alert" className="text-emergency text-sm">
          {error}
        </p>
      )}

      {phase === 'idle' && (
        <div>
          <Button variant="primary" onClick={() => void start()} disabled={!agreed}>
            <Mic aria-hidden className="size-4" />
            Start Ambient Capture
          </Button>
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          <span aria-live="polite">{busyLabel}</span>
        </div>
      )}

      {phase === 'listening' && (
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 font-medium text-sm">
              {/* The same pulsing dot `AudioCapture` uses, rather than a second
                  idiom for the same state. Both panels mean "a microphone in
                  this room is open"; a doctor who has learned to read one
                  should not have to learn the other, and the dot is the one
                  already carrying that meaning. It reports that capture is
                  running, which this component owns, not that sound is
                  arriving, which only the meter beside it may claim. */}
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-emergency" />
              <span aria-live="polite">Listening</span>
            </span>
            <span className="tabular-nums text-ink-muted text-sm">{clock(seconds)}</span>
            <InputMeter stream={micStream ?? undefined} />
            {onConversationExpandedChange && !expanded && (
              <button
                type="button"
                onClick={() => onConversationExpandedChange(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-control px-2 py-1 font-medium text-ink-muted text-xs transition-colors hover:bg-sunken hover:text-ink"
              >
                <Maximize2 aria-hidden className="size-3.5" />
                Expand
              </button>
            )}
          </div>

          {downSince !== null && <Reconnecting since={downSince} />}

          {/*
            Withheld while the theatre is open rather than rendered twice. Two
            mounted copies of the conversation would read as two conversations
            to a screen reader, and the second scroller would follow speech
            nobody is looking at.
          */}
          {!expanded && (
            <>
              <LiveConversation
                mode={conversation.mode}
                segments={conversation.segments}
                interim={interimText(live.interim)}
                interimSpeaker={conversation.interimSpeaker}
              />

              {/*
                Says out loud what the chips above deliberately do not claim. The
                recogniser separates voices but does not know which is the doctor,
                and a doctor who reads "Speaker 2" without this line may reasonably
                wonder whether the system has failed to work something out. On a
                translated session it says instead that the second line of every
                turn is a machine's.
              */}
              <p className="text-2xs text-ink-muted">{conversation.note}</p>
            </>
          )}

          <div>
            <Button variant="primary" onClick={() => void stop()}>
              <Square aria-hidden className="size-4" />
              Stop and Finish
            </Button>
          </div>
        </div>
      )}

      {/*
        The theatre (#287).

        A native `<dialog>` rather than a fixed div, for the reason
        `docs/DESIGN.md` gives at "Glass inside glass is always flat": an element
        with `backdrop-filter` establishes a backdrop root and a descendant may
        only sample inside it, so a panel nested in the capture card would frost
        against a flat fill. `showModal()` promotes this to the top layer, which
        is outside every backdrop root, and hands over focus trapping, Escape
        and inertness of the page behind for free.

        The panel is glass because it is chrome; everything inside it that
        carries clinical text stays on an opaque surface.
      */}
      {onConversationExpandedChange && (
        <dialog
          ref={conversationDialog}
          onClose={() => onConversationExpandedChange(false)}
          aria-label="Consultation conversation"
          data-print="hide"
          className="glass-panel m-auto h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
        >
          {expanded && (
            <div className="flex h-full flex-col">
              <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-line border-b px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-display font-semibold text-base leading-tight">
                    {patientName ?? 'Consultation'}
                  </p>
                  {/*
                    The short form the owner asked for. It named neither the
                    processor nor the region when the consent gate below still
                    did, and it does not name them now the gate has stopped:
                    the removal was a decision about what this surface shows
                    (`docs/decisions.md` D-004), not a licence for a title bar
                    read mid-consultation to become the disclosure instead.
                  */}
                  <p className="text-ink-muted text-xs">Ambient scribe</p>
                </div>

                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <span aria-hidden className="size-2 animate-pulse rounded-full bg-emergency" />
                    <span>Listening</span>
                  </span>
                  <span className="tabular-nums text-ink-muted text-sm">{clock(seconds)}</span>
                  <InputMeter stream={micStream ?? undefined} />
                  {downSince !== null && <Reconnecting since={downSince} />}
                  <button
                    type="button"
                    onClick={() => onConversationExpandedChange(false)}
                    aria-label="Dock the conversation"
                    title="Dock"
                    className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                  >
                    <Minimize2 aria-hidden className="size-4" />
                  </button>
                  <Button variant="primary" onClick={() => void stop()}>
                    <Square aria-hidden className="size-4" />
                    Stop and Finish
                  </Button>
                </div>
              </header>

              {/*
                The prompter is first in source order below `lg`, the same rule
                the safety rail follows on the review screen: on a narrow screen
                "visible without scrolling" can only mean first.
              */}
              <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="order-2 flex min-h-0 flex-col gap-2 lg:order-1">
                  <LiveConversation
                    fill
                    mode={conversation.mode}
                    segments={conversation.segments}
                    interim={interimText(live.interim)}
                    interimSpeaker={conversation.interimSpeaker}
                  />
                  <p className="text-2xs text-ink-muted">{conversation.note}</p>
                </div>

                {prompter && (
                  <div className="order-1 min-h-0 overflow-y-auto lg:order-2 lg:pr-1">
                    {prompter}
                  </div>
                )}
              </div>
            </div>
          )}
        </dialog>
      )}
    </div>
  )
}

/**
 * Says the socket is being reopened and how far capture is behind (#256). It
 * re-renders with the session clock, which ticks every second while listening.
 */
function Reconnecting({ since }: { since: number }) {
  const behind = Math.max(0, Math.round((Date.now() - since) / 1_000))
  return (
    <p role="status" className="flex items-center gap-2 text-ink-muted text-sm">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      Connection lost, reconnecting. {behind} s of speech is held until it is back.
    </p>
  )
}
