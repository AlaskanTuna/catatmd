import {
  type LiveAsrConfig,
  MAX_PRESCRIPTIONS,
  type MedicationCandidateWire,
  type Prescription,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { Check, Mic, Pencil, Plus, Settings2, Square, Trash2, X } from 'lucide-react'
import { type SyntheticEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog.js'
import { type AudioSettings, loadAudioSettings } from '../audio/audio-settings.js'
import {
  belowHardwareFloor,
  DICTATION_AUDIO_CONSTRAINTS,
  STALL_TIMEOUT_MS,
  toMono16k,
} from '../audio/dictation.js'
import { InputMeter } from '../audio/InputMeter.js'
import type { WorkerRequest, WorkerResponse } from '../audio/protocol.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { Select } from '../ui/Select.js'
import {
  acceptCandidate,
  candidateKey,
  capDictation,
  EMPTY_DRAFT,
  FOOD_OPTIONS,
  FREQUENCY_OPTIONS,
  fromSig,
  MAX_DICTATED_CHARACTERS,
  type PrescriptionDraft,
  ROUTE_OPTIONS,
  type StagedPrescription,
  setDrugByHand,
  sliceForCandidate,
  summarise,
  toPrescription,
  visibleCandidates,
} from './prescription-draft.js'
import { START_FAILED_ERROR, useDictationStream } from './use-dictation-stream.js'

/**
 * Where a prescription is dictated and assembled (#365).
 *
 * **A theatre, for the reason the capture theatre is one** (`docs/DESIGN.md`,
 * "While Capture Is Running"). The compose form lived in the review page's
 * middle column, which is about 620px wide and is itself an internal scroller,
 * with a three-line dictation box. Everything a doctor needed to check a
 * prescription was stacked in that column and most of it was below the fold,
 * which is what made a wired Accept button read as dead.
 *
 * **It is one column while listening and two after Stop.** The ambient theatre
 * is two throughout because red flags stream in beside the transcript. This one
 * has nothing to put there: the parse runs once, on complete, so drug names and
 * sig fields do not exist until the talking is over. A second column while the
 * doctor is speaking would be furniture.
 *
 * **A native `<dialog>` rather than a fixed panel.** `showModal()` promotes it
 * to the top layer, outside every backdrop root, which is what keeps the glass
 * from frosting against a flat fill; it also hands over focus trapping, Escape
 * and inertness of the page behind at no cost. The panel is glass because it is
 * chrome, and everything inside carrying clinical text sits on an opaque
 * surface.
 *
 * **Nothing is stored until Confirm.** Parsing writes nothing server-side, the
 * staged list is local state, and confirming is one ordinary
 * `PATCH /api/consultations/:id { prescriptions }` carrying the whole list.
 */

const STALL_ERROR = `Transcription was stopped after ${Math.round(
  STALL_TIMEOUT_MS / 60_000,
)} minutes with no sign of progress. The speech model may be unreachable from this network. Type the medication instead.`

const WORKER_DIED_ERROR = 'Speech recognition stopped unexpectedly. Type the medication instead.'

const CAPPED_NOTICE =
  'Length limit reached, so recording stopped here. Confirm what you have, then dictate again.'

const SAVE_FAILED = 'That could not be saved. Nothing was lost, try Confirm again.'

const FIELD_LABEL = 'text-2xs font-semibold uppercase tracking-wide text-ink-muted'
const TEXT_INPUT =
  'h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent'
const PANEL = 'rounded-card bg-surface p-4 shadow-card'

/** Queried rather than reffed, because `Button` does not declare a `ref` prop. */
const STOP_LABEL = 'Stop dictation'

const DISCARD_PROMPT = 'Discard the prescriptions you have not confirmed?'

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

export function PrescriptionTheatre({
  consultationId,
  stored,
  open,
  autoStart,
  patientName,
  onSave,
  onClose,
}: {
  consultationId: string
  stored: Prescription[]
  open: boolean
  /** Opened by Dictate rather than by Add, so the microphone starts itself. */
  autoStart: boolean
  patientName?: string
  onSave: (next: Prescription[]) => Promise<unknown>
  onClose: () => void
}) {
  const self = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const boxId = useId()

  const [audio, setAudio] = useState<AudioSettings>(loadAudioSettings)
  const dictationEngine = audio.dictationEngine
  const audioDialog = useRef<HTMLDialogElement>(null)
  const [audioOpen, setAudioOpen] = useState(false)

  const [liveConfig, setLiveConfig] = useState<LiveAsrConfig | null>(null)
  const [configFailure, setConfigFailure] = useState<'unavailable' | 'unreachable' | null>(null)
  const streaming = dictationEngine === 'streaming' && liveConfig !== null

  /**
   * Whether the engine is a decision yet.
   *
   * `streaming` reads false while `liveConfig` is still null, and the config is
   * fetched asynchronously, so an autoStart running on the mount tick took the
   * on-device branch every time and the one-shot ref below then refused to
   * retry once the config landed. A doctor on the shipped streaming default got
   * the local model, silently, on every press of Dictate.
   */
  const engineResolved =
    dictationEngine !== 'streaming' || liveConfig !== null || configFailure !== null

  const [lowPower] = useState(belowHardwareFloor)
  /** A socket loads no weights, so the floor only bites when the worker runs. */
  const thin = lowPower && !streaming

  const [dictation, setDictation] = useState('')
  const [parsedFrom, setParsedFrom] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<readonly MedicationCandidateWire[]>([])
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  const [staged, setStaged] = useState<readonly StagedPrescription[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'loading-model' | 'transcribing'>(
    'idle',
  )
  const [progress, setProgress] = useState<number | null>(null)
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const attempt = useRef(0)
  const worker = useRef<Worker | null>(null)
  const stall = useRef<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const nextKey = useRef(0)
  const box = useRef<HTMLTextAreaElement>(null)
  /**
   * Set by the streaming effect when the cap fires and read once in
   * `onComplete`. The cap path stops the socket with no notice of its own, so
   * without this the text truncates and the socket closes in silence.
   */
  const cappedRef = useRef(false)

  const save = useMutation({
    mutationFn: (next: Prescription[]) => onSave(next),
    onError: () => setError(SAVE_FAILED),
  })

  const parse = useMutation({
    mutationFn: (dictated: string) => api.parsePrescription(consultationId, dictated),
    onSuccess: (response, dictated) => {
      setError(null)
      setCandidates(response.candidates)
      setRejected(new Set())
      setParsedFrom(dictated)
    },
    onError: () =>
      toast.error('That medication could not be checked. The fields are still yours to fill in.'),
  })

  /**
   * The sig for one accepted drug, read from that drug's own stretch of text.
   *
   * The parse endpoint returns one sig per phrase, so a four-drug dictation
   * cannot hand four sigs back from one response. Re-parsing the slice is what
   * gives each drug the dose said beside it; reusing the whole-phrase sig is how
   * paracetamol's 500 mg lands on cetirizine, which `docs/decisions.md` D-001
   * exists to prevent. The route is deterministic, stores nothing, writes no
   * audit row and allows thirty a minute, so a handful of extra calls per
   * dictation costs nothing that matters.
   */
  const segment = useMutation({
    mutationFn: ({ source }: { key: string; source: string }) =>
      api.parsePrescription(consultationId, source),
    onSuccess: (response, { key }) =>
      setStaged((rows) =>
        rows.map((row) => {
          if (row.key !== key) return row
          /*
           * Fills what is still blank and replaces nothing. The row stays
           * editable while its request is in flight, so a wholesale merge let a
           * response arriving half a second later overwrite a dose the doctor
           * had already typed. On this field that is the difference between a
           * gap and a wrong number.
           */
          const parsed = fromSig(response.sig)
          const draft: PrescriptionDraft = {
            ...row.draft,
            dose: row.draft.dose === '' ? parsed.dose : row.draft.dose,
            route: row.draft.route === '' ? parsed.route : row.draft.route,
            frequency: row.draft.frequency === '' ? parsed.frequency : row.draft.frequency,
            duration: row.draft.duration === '' ? parsed.duration : row.draft.duration,
            food: row.draft.food === '' ? parsed.food : row.draft.food,
          }
          return { ...row, draft }
        }),
      ),
    onError: () =>
      toast('The dose and frequency could not be read for that drug. Fill them in on the row.'),
  })

  const onDictated = useRef((text: string) => {
    setDictation(text)
    parse.mutate(text)
  })
  useEffect(() => {
    onDictated.current = (text: string) => {
      setDictation(text)
      parse.mutate(text)
    }
  })

  const prefix = useRef('')

  const stream = useDictationStream({
    onComplete: (text, notice) => {
      const { text: joined } = capDictation(prefix.current, text, MAX_DICTATED_CHARACTERS)
      const trimmed = joined.trim()
      if (notice !== null) toast(notice)
      if (cappedRef.current) setError(CAPPED_NOTICE)
      if (trimmed.length > 0) onDictated.current(trimmed)
    },
  })

  useEffect(() => {
    if (stream.phase !== 'streaming') return
    const { text, capped } = capDictation(prefix.current, stream.settled, MAX_DICTATED_CHARACTERS)
    setDictation(text)
    if (capped) {
      cappedRef.current = true
      stream.stop()
    }
  }, [stream.phase, stream.settled, stream.stop])

  const capturing = phase === 'recording' || stream.phase !== null

  /** Only while the microphone is open, so a settled theatre holds no timer. */
  useEffect(() => {
    if (!capturing) return
    const started = Date.now()
    setElapsed(0)
    const tick = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1_000)),
      1_000,
    )
    return () => window.clearInterval(tick)
  }, [capturing])

  useEffect(() => {
    if (!open || dictationEngine !== 'streaming') return
    let live = true
    api
      .liveAsrConfig('dictation')
      .then((config) => {
        if (!live) return
        setLiveConfig(config)
        /*
         * Cleared on success, not only set on failure. Toggling the engine in
         * the Audio dialog re-runs this effect, so a first attempt that failed
         * and a retry that succeeded would otherwise leave the "transcribes on
         * this device" sentence on screen while the socket was open. With the
         * consent tick gone from this surface that sentence is the only thing
         * left telling the doctor where the audio goes, so it must not be able
         * to be false.
         */
        setConfigFailure(null)
      })
      .catch((cause: unknown) => {
        if (!live) return
        setConfigFailure(
          cause instanceof ApiError && cause.status === 503 ? 'unavailable' : 'unreachable',
        )
      })
    return () => {
      live = false
    }
  }, [open, dictationEngine])

  const clearStall = useCallback(() => {
    if (stall.current !== null) {
      window.clearTimeout(stall.current)
      stall.current = null
    }
  }, [])

  const abort = useCallback(
    (message: string | null) => {
      attempt.current += 1
      clearStall()
      worker.current?.terminate()
      worker.current = null
      setPhase('idle')
      setProgress(null)
      setError(message)
    },
    [clearStall],
  )

  const watchForStall = useCallback(() => {
    clearStall()
    stall.current = window.setTimeout(() => abort(STALL_ERROR), STALL_TIMEOUT_MS)
  }, [abort, clearStall])

  const ensureWorker = useCallback(() => {
    if (worker.current) return worker.current
    const id = attempt.current
    /*
     * By URL, never by import. A value import from the worker module would pull
     * the inference library onto the main chunk with it, which `protocol.ts`
     * measured at 458 kB to 982 kB. Only types come from `protocol.js`.
     */
    const instance = new Worker(new URL('../audio/transcribe.worker.js', import.meta.url), {
      type: 'module',
    })

    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (attempt.current !== id) return
      const message = event.data
      switch (message.type) {
        case 'progress':
          watchForStall()
          setProgress(message.total > 0 ? Math.round((message.loaded / message.total) * 100) : null)
          setPhase('loading-model')
          break
        case 'ready':
          watchForStall()
          setProgress(null)
          setPhase('transcribing')
          break
        case 'transcribing':
        case 'alive':
          watchForStall()
          break
        case 'finishing':
          clearStall()
          break
        case 'result': {
          clearStall()
          setPhase('idle')
          setProgress(null)
          // Through the same join and the same cap as the streaming path, so
          // one engine cannot append while the other replaces.
          const { text, capped } = capDictation(
            prefix.current,
            message.text.trim(),
            MAX_DICTATED_CHARACTERS,
          )
          if (capped) setError(CAPPED_NOTICE)
          const settled = text.trim()
          if (settled.length > 0) onDictated.current(settled)
          break
        }
        case 'error':
          clearStall()
          setPhase('idle')
          setProgress(null)
          setError(WORKER_DIED_ERROR)
          break
        default: {
          const unhandled: never = message
          void unhandled
        }
      }
    }
    const died = () => {
      if (attempt.current !== id) return
      abort(WORKER_DIED_ERROR)
    }
    instance.onerror = died
    instance.onmessageerror = died
    worker.current = instance
    return instance
  }, [abort, clearStall, watchForStall])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setPhase('loading-model')
      setProgress(null)
      const id = attempt.current
      watchForStall()
      try {
        const decoded = await toMono16k(blob)
        if (attempt.current !== id) return
        const request: WorkerRequest = { type: 'transcribe', audio: decoded }
        ensureWorker().postMessage(request, [decoded.buffer as ArrayBuffer])
      } catch {
        if (attempt.current !== id) return
        clearStall()
        setPhase('idle')
        setError('That recording could not be read. Type the medication instead.')
      }
    },
    [clearStall, ensureWorker, watchForStall],
  )

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: DICTATION_AUDIO_CONSTRAINTS,
      })
      const capture = new MediaRecorder(media)
      chunks.current = []
      capture.ondataavailable = (event) => chunks.current.push(event.data)
      capture.onstop = () => {
        // A live microphone track outliving the recording leaves the browser's
        // recording indicator on, which in a consulting room reads as "still
        // listening".
        for (const track of media.getTracks()) track.stop()
        setLiveStream(null)
        void transcribe(new Blob(chunks.current, { type: capture.mimeType }))
      }
      capture.start()
      recorder.current = capture
      setLiveStream(media)
      setPhase('recording')
    } catch {
      setError('Microphone access was refused, or no microphone is available.')
    }
  }, [transcribe])

  const stopRecording = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
  }, [])

  const startDictation = useCallback(() => {
    setError(null)
    stream.clearError()
    cappedRef.current = false
    // Snapshotted for both engines. It was set only on the streaming branch,
    // so on-device "Dictate again" replaced the box rather than appending to it.
    prefix.current = dictation
    if (!streaming) {
      void startRecording()
      return
    }
    void stream.start()
  }, [dictation, startRecording, stream, streaming])

  const stopDictation = useCallback(() => {
    if (stream.phase !== null) return stream.stop()
    stopRecording()
  }, [stopRecording, stream])

  /** Everything a run holds, dropped without firing a handler. */
  const teardown = useCallback(() => {
    attempt.current += 1
    if (stall.current !== null) window.clearTimeout(stall.current)
    stall.current = null
    worker.current?.terminate()
    worker.current = null
    const media = recorder.current
    recorder.current = null
    if (media === null) return
    media.onstop = null
    if (media.state !== 'inactive') media.stop()
    for (const track of media.stream.getTracks()) track.stop()
  }, [])

  useEffect(() => () => teardown(), [teardown])

  /*
   * `showModal` and `close` are guarded because jsdom implements neither. The
   * `open` attribute fallback is not a no-op: it is what the UA stylesheet keys
   * on, so the contents leave `display: none` and enter the accessibility tree,
   * which is the part a test can see. Real browsers take the first branch and
   * get the top layer, the focus trap and Escape with it.
   */
  useEffect(() => {
    const node = self.current
    if (!node) return
    if (!open) {
      if (typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
      return
    }
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
  }, [open])

  /*
   * Focus is set here rather than left to the dialog, because `showModal()`
   * runs its autofocus pass before conditionally rendered children have
   * mounted: focus lands on the dialog itself and the first Tab goes nowhere
   * useful. Same fix, and same reason, as `AmbientCapture`'s.
   *
   * Where it lands says what the surface is for. Opened by Dictate the
   * microphone is already running, so Stop is the only thing worth pressing;
   * opened by Add there is nothing running and the box is the whole point.
   */
  const started = useRef(false)
  useEffect(() => {
    if (!open) {
      started.current = false
      return
    }
    if (started.current) return
    // Waits rather than falling through: the engine is not known yet, and
    // guessing it is what shipped the wrong one.
    if (autoStart && !engineResolved) return
    started.current = true
    if (autoStart) {
      startDictation()
      return
    }
    box.current?.focus()
  }, [open, autoStart, engineResolved, startDictation])

  /*
   * Focus follows the microphone rather than being set beside the call that
   * starts it. `startDictation` sets state from an effect body, which React
   * batches rather than flushing, so on that tick the header still renders its
   * idle branch and there is no Stop button to focus: the query found nothing
   * and focus fell to the body a tick later when the idle branch unmounted.
   */
  useEffect(() => {
    if (!open || !autoStart || !capturing) return
    self.current?.querySelector<HTMLButtonElement>(`[aria-label="${STOP_LABEL}"]`)?.focus()
  }, [open, autoStart, capturing])

  useEffect(() => {
    const node = audioDialog.current
    if (!audioOpen || !node) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    const close = () => setAudioOpen(false)
    node.addEventListener('close', close)
    return () => node.removeEventListener('close', close)
  }, [audioOpen])

  const reset = useCallback(() => {
    setDictation('')
    setParsedFrom(null)
    setCandidates([])
    setRejected(new Set())
    setStaged([])
    setEditing(null)
    setError(null)
    cappedRef.current = false
  }, [])

  const busy = phase !== 'idle' || stream.phase !== null || parse.isPending
  const dirty = parsedFrom !== null && dictation.trim() !== parsedFrom.trim()
  const room = MAX_PRESCRIPTIONS - stored.length - staged.length
  /*
   * A candidate is resolved when it was rejected, or when a staged row already
   * claims a span it overlaps. Removing the row releases the span, which is
   * what hands every candidate on it back.
   */
  const claimed = staged.flatMap((row) => (row.span === undefined ? [] : [row.span]))
  const offered = visibleCandidates(candidates, rejected).filter(
    (candidate) =>
      !claimed.some((span) => candidate.start < span.end && span.start < candidate.end),
  )
  /*
   * The right column appears once there is anything to work with, not only
   * after a successful parse. Gating it on `parsedFrom` meant a failed parse
   * left the doctor reading "the fields are still yours to fill in" beside no
   * fields at all.
   */
  const reviewing = !capturing && (parsedFrom !== null || dictation.trim().length > 0)
  const ready = staged.flatMap((row) => {
    const prescription = toPrescription(row.draft, row.source)
    return prescription === null ? [] : [prescription]
  })

  /** Stable across edits, so a row's React key and focus target never move. */
  const mintKey = () => {
    nextKey.current += 1
    return `staged-${nextKey.current}`
  }

  const accept = (candidate: MedicationCandidateWire) => {
    if (parsedFrom === null || room <= 0) return
    const key = mintKey()
    const source = sliceForCandidate(parsedFrom, candidates, candidate)
    setStaged((rows) => [
      ...rows,
      {
        key,
        draft: acceptCandidate(EMPTY_DRAFT, candidate),
        source: source.length > 0 ? source : parsedFrom,
        span: { start: candidate.start, end: candidate.end },
      },
    ])
    if (source.length > 0) segment.mutate({ key, source })
  }

  const addByHand = () => {
    /*
     * The live box, not the last parsed text. A doctor who checked one phrase,
     * edited the box and then added by hand would otherwise have the row record
     * the phrase they replaced as the evidence its fields came from.
     */
    const phrase = dictation.trim()
    if (phrase.length === 0 || room <= 0) return
    const key = mintKey()
    setStaged((rows) => [...rows, { key, draft: EMPTY_DRAFT, source: phrase }])
    setEditing(key)
  }

  const patch = (key: string, change: Partial<PrescriptionDraft>) =>
    setStaged((rows) =>
      rows.map((row) => (row.key === key ? { ...row, draft: { ...row.draft, ...change } } : row)),
    )

  /** Rows that are not a prescription yet, so Confirm cannot quietly drop them. */
  const incomplete = staged.length - ready.length

  const confirm = () => {
    if (ready.length === 0 || incomplete > 0) return
    save.mutate([...stored, ...ready], {
      onSuccess: () => {
        reset()
        onClose()
      },
    })
  }

  const statusLine = () => {
    // The gap between opening on Dictate and knowing which engine to open.
    if (autoStart && !engineResolved && !capturing) return 'Getting ready.'
    if (stream.phase === 'connecting') return 'Connecting.'
    if (capturing && stream.phase !== 'finishing') {
      return 'Listening. Press Stop when you have finished.'
    }
    if (stream.phase === 'finishing') return 'Finishing, waiting for the last words.'
    if (phase === 'loading-model') {
      return progress === null || progress >= 100
        ? 'Opening the speech model.'
        : `Downloading the speech model, ${progress}%.`
    }
    if (phase === 'transcribing') return 'Transcribing on this device.'
    if (parse.isPending) return 'Checking the medication.'
    if (segment.isPending) return 'Reading the dose for that drug.'
    return ''
  }

  /**
   * The one question, asked by every path that would drop staged rows.
   *
   * It lived on `onCancel` alone, which fires for Escape and never for
   * `close()`, so the header's X and the Discard button each wiped the list
   * without asking. A guard reachable by one of three doors is not a guard.
   */
  const mayDiscard = () => staged.length === 0 || window.confirm(DISCARD_PROMPT)

  const requestClose = () => {
    if (mayDiscard()) self.current?.close()
  }

  /**
   * Escape stops the dictation and keeps the theatre open, rather than docking
   * and streaming on the way the ambient theatre does. A consultation must keep
   * recording while the doctor uses the page behind it; a dictated phrase has
   * nothing to keep running for, and stopping loses nothing because the settled
   * words are kept and the parse runs on them. A second Escape closes.
   *
   * With rows staged it asks first, because closing would drop prescriptions
   * that were never saved.
   */
  const cancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (capturing) {
      event.preventDefault()
      stopDictation()
      return
    }
    if (!mayDiscard()) event.preventDefault()
  }

  return (
    <dialog
      ref={self}
      onClose={() => {
        reset()
        onClose()
      }}
      onCancel={cancel}
      aria-labelledby={titleId}
      data-print="hide"
      className="glass-panel m-auto h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <p
                id={titleId}
                className="truncate font-display text-base font-semibold leading-tight"
              >
                {patientName ?? 'Consultation'}
              </p>
              <p className="text-2xs text-ink-muted">Prescription dictation</p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
              {capturing ? (
                <>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {/* The badge and the status line are one element apart, so
                      a pulsing red "Listening" while the socket is still
                      opening contradicts the sentence beside it. */}
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 rounded-pill',
                        stream.phase === 'connecting'
                          ? 'bg-ink-muted'
                          : 'animate-pulse bg-emergency',
                      )}
                    />
                    <span>{stream.phase === 'connecting' ? 'Connecting' : 'Listening'}</span>
                  </span>
                  <span className="hidden tabular-nums text-sm text-ink-muted sm:inline">
                    {clock(elapsed)}
                  </span>
                  <span className="hidden sm:inline">
                    <InputMeter stream={liveStream ?? stream.micStream ?? undefined} />
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    aria-label={STOP_LABEL}
                    icon={<Square aria-hidden className="size-3.5" />}
                    disabled={stream.phase === 'finishing'}
                    onClick={stopDictation}
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="neutral"
                    aria-label="Audio settings"
                    title="Audio settings"
                    icon={<Settings2 aria-hidden className="size-3.5" />}
                    onClick={() => setAudioOpen(true)}
                  />
                  {!thin && (
                    <Button
                      size="sm"
                      variant="neutral"
                      icon={<Mic aria-hidden className="size-3.5" />}
                      disabled={busy}
                      onClick={startDictation}
                    >
                      {parsedFrom === null ? 'Dictate' : 'Dictate again'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="neutral"
                    disabled={busy || dictation.trim().length === 0}
                    loading={parse.isPending}
                    onClick={() => parse.mutate(dictation.trim())}
                  >
                    Check
                  </Button>
                  <button
                    type="button"
                    aria-label="Close prescription dictation"
                    onClick={requestClose}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-sunken-soft text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </>
              )}
            </div>
          </header>

          <div
            className={cn(
              'min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:p-5',
              reviewing && 'lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:overflow-hidden',
            )}
          >
            <div
              className={cn(
                'flex min-w-0 flex-col gap-4',
                reviewing ? 'lg:min-h-0 lg:overflow-y-auto lg:pr-1' : 'mx-auto w-full max-w-3xl',
              )}
            >
              <section className={cn(PANEL, !reviewing && 'flex min-h-0 flex-1 flex-col')}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={FIELD_LABEL} id={boxId}>
                    What You Prescribed
                  </span>
                  <span aria-hidden className="tabular-nums text-2xs text-ink-muted">
                    {dictation.length} / {MAX_DICTATED_CHARACTERS}
                  </span>
                </div>

                <textarea
                  ref={box}
                  aria-labelledby={boxId}
                  className={cn(
                    'mt-2 w-full resize-y rounded-control border border-line bg-surface p-3 text-sm leading-relaxed transition-colors hover:border-accent focus:border-accent',
                    reviewing ? 'h-40' : 'min-h-40 flex-1',
                  )}
                  placeholder="amoxicillin 500 mg, three times a day, after food, for five days"
                  maxLength={MAX_DICTATED_CHARACTERS}
                  value={dictation}
                  onChange={(event) => setDictation(event.target.value)}
                  disabled={busy}
                />

                {/* Provisional tokens, outside the field on purpose: they are
                  rewritten as the doctor speaks, and one truncated at
                  `maxLength` would stay truncated once it settled. No
                  `aria-live` either, since a region firing per token floods a
                  screen reader; the status line already narrates the phase. */}
                {stream.interim !== '' && (
                  <p className="mt-2 text-xs italic text-ink-muted">{stream.interim}</p>
                )}

                {reviewing && (
                  <p className="mt-2 text-2xs text-ink-muted">
                    Edit the text and press Check to read it again.
                  </p>
                )}

                {dictationEngine === 'streaming' && configFailure !== null && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {configFailure === 'unavailable'
                      ? 'Streaming recognition is not available on this deployment, so Dictate transcribes on this device.'
                      : 'Streaming recognition could not be reached, so Dictate transcribes on this device.'}
                  </p>
                )}

                {thin && (
                  <p className="mt-2 text-xs text-ink-muted">
                    This device does not have the memory to run the speech model, so type the
                    medication above instead.
                  </p>
                )}
              </section>

              {reviewing && offered.length > 0 && parsedFrom !== null && (
                <section className={PANEL}>
                  <h3 className="text-xs font-semibold text-ink">
                    Drug Names Heard ({offered.length})
                  </h3>
                  <p className="mt-1 text-2xs text-ink-muted">
                    Each is a separate decision, and nothing is recorded until you accept it.
                  </p>

                  <ul aria-label="Drug names heard" className="mt-3 space-y-2">
                    {offered.map((candidate) => {
                      const heardIsGeneric = candidate.heard.toLowerCase() === candidate.generic
                      return (
                        <li
                          key={candidateKey(candidate)}
                          className="rounded-control bg-sunken-soft p-3 text-xs text-ink-muted"
                        >
                          {/* Sliced from the text the offsets belong to, never
                            from the live box, so the marked span stays truthful
                            while the doctor is mid-edit. */}
                          <p className="line-clamp-3 font-mono leading-relaxed">
                            {parsedFrom.slice(0, candidate.start)}
                            <mark className="bg-transparent font-semibold text-ink underline decoration-accent decoration-2 underline-offset-2">
                              {parsedFrom.slice(candidate.start, candidate.end)}
                            </mark>
                            {parsedFrom.slice(candidate.end)}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-ink">
                              {heardIsGeneric ? 'Record as' : 'Read as'}{' '}
                              <strong className="font-semibold">{candidate.generic}</strong>?
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Check aria-hidden className="size-3.5" />}
                              disabled={dirty || room <= 0}
                              onClick={() => accept(candidate)}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="neutral"
                              icon={<X aria-hidden className="size-3.5" />}
                              onClick={() =>
                                setRejected((current) =>
                                  new Set(current).add(candidateKey(candidate)),
                                )
                              }
                            >
                              Reject
                            </Button>
                            {dirty && <span>Check the dictation again first.</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {/* A parse that found nothing rendered no block at all before
                #365, so a doctor who said a drug the lexicon does not hold got
                silence. Brand names are outside the lexicon by D-001, which
                makes this the common case rather than the rare one. */}
              {reviewing && parsedFrom !== null && candidates.length === 0 && (
                <section className={PANEL}>
                  <h3 className="text-xs font-semibold text-ink">Drug Names Heard (0)</h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    No drug name in the list matched what you said. Add it by hand on the right, or
                    edit the text above and press Check.
                  </p>
                </section>
              )}
            </div>

            {reviewing && (
              <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <section className={PANEL}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xs font-semibold text-ink">Prescriptions To Confirm</h3>
                    <span className="tabular-nums text-2xs text-ink-muted">{staged.length}</span>
                  </div>

                  {staged.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-muted">
                      Accept a drug name on the left, or add one by hand.
                    </p>
                  ) : (
                    <ul aria-label="Prescriptions to confirm" className="mt-3 space-y-2">
                      {staged.map((row, index) => (
                        <li
                          key={row.key}
                          className={cn(
                            'rounded-control p-3',
                            editing === row.key ? 'bg-accent-soft' : 'bg-sunken-soft',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink">
                                <span className="tabular-nums text-ink-muted">{index + 1}. </span>
                                {row.draft.drug.trim() === '' ? (
                                  <span className="font-normal italic text-ink-muted">
                                    Name this drug
                                  </span>
                                ) : (
                                  row.draft.drug
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-ink-muted">
                                {summarise(row.draft) === ''
                                  ? 'No dose or frequency read.'
                                  : summarise(row.draft)}
                              </p>
                              {/* The stretch these fields were read from, so a
                                bad split is visible rather than silent. */}
                              <p className="mt-1 line-clamp-2 font-mono text-2xs italic text-ink-muted">
                                from “{row.source}”
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <Button
                                size="sm"
                                variant="neutral"
                                aria-label={`Edit prescription ${index + 1}`}
                                icon={<Pencil aria-hidden className="size-3.5" />}
                                onClick={() =>
                                  setEditing((current) => (current === row.key ? null : row.key))
                                }
                              />
                              <Button
                                size="sm"
                                variant="neutral"
                                aria-label={`Remove prescription ${index + 1}`}
                                icon={<Trash2 aria-hidden className="size-3.5" />}
                                onClick={() => {
                                  setStaged((rows) => rows.filter(({ key }) => key !== row.key))
                                  setEditing((current) => (current === row.key ? null : current))
                                }}
                              />
                            </div>
                          </div>

                          {editing === row.key && (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <label className="flex flex-col gap-1.5 sm:col-span-2">
                                <span className={FIELD_LABEL}>Drug</span>
                                <input
                                  className={TEXT_INPUT}
                                  value={row.draft.drug}
                                  placeholder="Type the name"
                                  onChange={(event) =>
                                    setStaged((rows) =>
                                      rows.map((other) =>
                                        other.key === row.key
                                          ? {
                                              ...other,
                                              draft: setDrugByHand(other.draft, event.target.value),
                                            }
                                          : other,
                                      ),
                                    )
                                  }
                                />
                              </label>

                              <label className="flex flex-col gap-1.5">
                                <span className={FIELD_LABEL}>Dose</span>
                                <input
                                  className={TEXT_INPUT}
                                  value={row.draft.dose}
                                  onChange={(event) => patch(row.key, { dose: event.target.value })}
                                />
                              </label>

                              <div className="flex flex-col gap-1.5">
                                <span className={FIELD_LABEL}>Route</span>
                                <Select
                                  label="Route"
                                  value={row.draft.route}
                                  options={ROUTE_OPTIONS}
                                  onChange={(route) =>
                                    patch(row.key, { route: route as SigRoute | '' })
                                  }
                                />
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <span className={FIELD_LABEL}>Frequency</span>
                                <Select
                                  label="Frequency"
                                  value={row.draft.frequency}
                                  options={FREQUENCY_OPTIONS}
                                  onChange={(frequency) =>
                                    patch(row.key, { frequency: frequency as SigFrequency | '' })
                                  }
                                />
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <span className={FIELD_LABEL}>With Food</span>
                                <Select
                                  label="With Food"
                                  value={row.draft.food}
                                  options={FOOD_OPTIONS}
                                  onChange={(food) =>
                                    patch(row.key, { food: food as SigFoodTiming | '' })
                                  }
                                />
                              </div>

                              <label className="flex flex-col gap-1.5">
                                <span className={FIELD_LABEL}>Duration</span>
                                <input
                                  className={TEXT_INPUT}
                                  value={row.draft.duration}
                                  onChange={(event) =>
                                    patch(row.key, { duration: event.target.value })
                                  }
                                />
                              </label>

                              <div className="sm:col-span-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={<Check aria-hidden className="size-3.5" />}
                                  onClick={() => setEditing(null)}
                                >
                                  Done
                                </Button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="neutral"
                      icon={<Plus aria-hidden className="size-3.5" />}
                      disabled={room <= 0 || dictation.trim().length === 0}
                      onClick={addByHand}
                    >
                      Add By Hand
                    </Button>
                    {room <= 0 && (
                      <span className="text-2xs text-ink-muted">
                        Ten is the most this record holds. Remove one to add another.
                      </span>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
            <div className="min-w-0 flex-1">
              {/* Always mounted, because a live region added to the DOM
                alongside its first content is the shape screen readers miss. */}
              <p role="status" className="truncate text-xs text-ink-muted">
                {statusLine() !== ''
                  ? statusLine()
                  : incomplete > 0
                    ? `Name every drug before confirming. ${incomplete} still ${
                        incomplete === 1 ? 'needs' : 'need'
                      } a name.`
                    : reviewing
                      ? `${staged.length} to confirm, ${stored.length} already recorded`
                      : ''}
              </p>
              {(error ?? stream.error) !== null && (
                <p role="alert" className="mt-1 text-xs text-emergency">
                  {error ?? stream.error}
                </p>
              )}
            </div>

            {/* A second deliberate press rather than an automatic switch.
              Nothing was sent on this path, so the local worker is a real
              alternative; running it unasked hands the doctor a different
              engine's result with no word that it happened. */}
            {stream.error === START_FAILED_ERROR && !capturing && (
              <Button
                size="sm"
                variant="neutral"
                icon={<Mic aria-hidden className="size-3.5" />}
                disabled={busy}
                onClick={() => {
                  stream.clearError()
                  void startRecording()
                }}
              >
                Use On-Device Instead
              </Button>
            )}

            {staged.length > 0 && (
              <Button
                size="sm"
                variant="neutral"
                disabled={save.isPending}
                onClick={() => {
                  if (!mayDiscard()) return
                  setStaged([])
                  setEditing(null)
                }}
              >
                Discard
              </Button>
            )}

            <Button
              variant="primary"
              disabled={ready.length === 0 || incomplete > 0 || busy || segment.isPending}
              loading={save.isPending}
              icon={<Check aria-hidden className="size-4" />}
              onClick={confirm}
            >
              {ready.length > 1 ? `Confirm ${ready.length} Prescriptions` : 'Confirm Prescription'}
            </Button>
          </footer>

          {/* `ambient` is false rather than plumbed: this page has no live
            ambient session, and the dialog reads that flag only to name an
            engine that is actually running. */}
          {audioOpen && (
            <AudioSettingsDialog
              ref={audioDialog}
              settings={audio}
              onApply={setAudio}
              ambient={false}
            />
          )}
        </div>
      )}
    </dialog>
  )
}
