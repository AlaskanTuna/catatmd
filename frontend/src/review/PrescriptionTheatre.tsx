import {
  type LiveAsrConfig,
  MAX_PRESCRIPTIONS,
  type Prescription,
  type PrescriptionLine,
  type ShareableSigField,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { Check, CircleHelp, Mic, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { type SyntheticEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
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
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { Checkbox } from '../ui/Checkbox.js'
import { Select } from '../ui/Select.js'
import { DrugField } from './DrugField.js'
import {
  capDictation,
  FOOD_OPTIONS,
  FREQUENCY_OPTIONS,
  type LineEdit,
  type LineRow,
  lineKeys,
  MAX_DICTATED_CHARACTERS,
  manualRow,
  ROUTE_OPTIONS,
  rowsFrom,
  toConfirm,
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
 * **One table of lines, read from the whole box** (`docs/decisions.md` D-001,
 * amended 06/10/26). One parse returns every drug said, each with its own sig,
 * and the box is read again shortly after the doctor stops editing it. An exact
 * name starts ticked, a near-match waits for a tick, and a line with a sig but
 * no recognised name holds Confirm until it is named or unticked.
 *
 * **A native `<dialog>` rather than a fixed panel.** `showModal()` promotes it
 * to the top layer, outside every backdrop root, which is what keeps the glass
 * from frosting against a flat fill; it also hands over focus trapping, Escape
 * and inertness of the page behind at no cost. The panel is glass because it is
 * chrome, and everything inside carrying clinical text sits on an opaque
 * surface.
 *
 * **Nothing is stored until Confirm.** Parsing writes nothing server-side, the
 * table is local state, and confirming is one ordinary
 * `PATCH /api/consultations/:id { prescriptions }` carrying the whole list.
 */

const STALL_ERROR = `Transcription was stopped after ${Math.round(
  STALL_TIMEOUT_MS / 60_000,
)} minutes with no sign of progress. The speech model may be unreachable from this network. Type the medication instead.`

const WORKER_DIED_ERROR = 'Speech recognition stopped unexpectedly. Type the medication instead.'

const CAPPED_NOTICE =
  'Length limit reached, so recording stopped here. Confirm what you have, then dictate again.'

const SAVE_FAILED = 'That could not be saved. Nothing was lost, try Confirm again.'

const FIELD_LABEL = 'text-2xs font-semibold text-ink-muted'
const TEXT_INPUT =
  'h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent'
/** The Completeness Checklist's section card: bordered on the sunken body, no shadow. */
const PANEL = 'rounded-card border border-line bg-surface p-4'

/** Dose, duration, frequency, food and route: one row wide; the lists take a full row on a phone. */
const SIG_GRID =
  'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]'

const SHARED_NAMES: Record<ShareableSigField, string> = {
  route: 'Route',
  frequency: 'Frequency',
  duration: 'Duration',
  food: 'With Food',
}

/**
 * A field's name, shown above it while the table wraps. On a wide screen the
 * header row names the columns instead, and every control carries its own
 * label for a screen reader either way.
 */
function FieldName({ children }: { children: string }) {
  return (
    <span aria-hidden className={cn(FIELD_LABEL, 'lg:hidden')}>
      {children}
    </span>
  )
}

/** A line's own words, with the drug name heard in them marked. */
function Quote({
  text,
  span,
  name,
}: {
  text: string
  span: { start: number; end: number }
  name: { start: number; end: number } | undefined
}) {
  if (name === undefined || name.start < span.start || name.end > span.end) {
    return <>“{text.slice(span.start, span.end)}”</>
  }
  return (
    <>
      “{text.slice(span.start, name.start)}
      <mark className="bg-transparent font-semibold text-ink underline decoration-accent decoration-2 underline-offset-2">
        {text.slice(name.start, name.end)}
      </mark>
      {text.slice(name.end, span.end)}”
    </>
  )
}

/** Queried rather than reffed, because `Button` does not declare a `ref` prop. */
const STOP_LABEL = 'Stop dictation'
const ADD_LINE_LABEL = 'Add Line'
const REMOVE_LABEL = 'Remove ticked lines'

const removePrompt = (n: number) =>
  `Remove ${count(n, 'ticked line')}? Restore brings ${n === 1 ? 'it' : 'them'} back until the dictation is closed.`

const DISCARD_PROMPT = 'Discard the prescriptions you have not confirmed?'

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/**
 * How long the box rests before it is read again. Long enough not to parse on
 * every keystroke, short enough that the table has caught up by the time the
 * doctor looks at it.
 */
const REPARSE_DELAY_MS = 600

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
  const linesId = useId()

  /*
   * Streaming is always preferred here, and on-device is only the fallback when
   * the config says streaming is unavailable or does not answer. No stored
   * preference is read: the owner settled the engine for this page, so a
   * device left on the on-device choice by an older build still streams.
   */
  const [liveConfig, setLiveConfig] = useState<LiveAsrConfig | null>(null)
  const [configFailure, setConfigFailure] = useState<'unavailable' | 'unreachable' | null>(null)
  const streaming = liveConfig !== null

  /**
   * Whether the engine is a decision yet.
   *
   * `streaming` reads false while `liveConfig` is still null, and the config is
   * fetched asynchronously, so an autoStart running on the mount tick took the
   * on-device branch every time and the one-shot ref below then refused to
   * retry once the config landed. A doctor on the shipped streaming default got
   * the local model, silently, on every press of Dictate.
   */
  const engineResolved = liveConfig !== null || configFailure !== null

  const [lowPower] = useState(belowHardwareFloor)
  /** A socket loads no weights, so the floor only bites when the worker runs. */
  const thin = lowPower && !streaming

  const [dictation, setDictation] = useState('')
  const [parsedFrom, setParsedFrom] = useState<string | null>(null)
  const [lines, setLines] = useState<readonly PrescriptionLine[]>([])
  const [generics, setGenerics] = useState<readonly string[]>([])
  /**
   * What the doctor did to each line, kept apart from the parse so reading the
   * box again cannot overwrite it (`LineEdit`).
   */
  const [edits, setEdits] = useState<ReadonlyMap<string, LineEdit>>(new Map())
  const [manual, setManual] = useState<readonly { key: string; phrase: string }[]>([])
  const [parseFailed, setParseFailed] = useState(false)
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

  /*
   * The latest text, and the last text sent. A response for text the doctor has
   * since changed is dropped rather than rendered: a newer read is coming, and
   * offsets into the old text would quote the wrong words.
   */
  const latest = useRef('')
  const sent = useRef<string | null>(null)
  useEffect(() => {
    latest.current = dictation.trim()
  })

  const parse = useMutation({
    mutationFn: (dictated: string) => api.parsePrescription(consultationId, dictated),
    onSuccess: (response, dictated) => {
      if (dictated !== latest.current) {
        // Dropped, so not read: going back to these words must read them again.
        if (sent.current === dictated) sent.current = null
        return
      }
      setError(null)
      setParseFailed(false)
      /*
       * A line the doctor removed stays removed only while the text still
       * holds it. Its key is by drug, so without this a drug removed, deleted
       * from the box and then dictated again would come back hidden: said, and
       * dropped with no row to show for it.
       */
      const present = new Set(lineKeys(dictated, response.lines ?? []))
      setEdits((current) => {
        // A row added by hand is in no read, so only read rows are pruned.
        const stale = [...current].filter(
          ([key, each]) => each.removed && !key.startsWith('manual-') && !present.has(key),
        )
        if (stale.length === 0) return current
        const next = new Map(current)
        for (const [key, each] of stale) next.set(key, { ...each, removed: undefined })
        return next
      })
      setLines(response.lines ?? [])
      setGenerics(response.generics ?? [])
      setParsedFrom(dictated)
    },
    onError: (_cause, dictated) => {
      if (dictated === latest.current) setParseFailed(true)
      else if (sent.current === dictated) sent.current = null
    },
  })
  const mutateParse = parse.mutate

  const read = useCallback(
    (text: string) => {
      sent.current = text
      mutateParse(text)
    },
    [mutateParse],
  )

  const onDictated = useRef((text: string) => {
    setDictation(text)
    read(text)
  })
  useEffect(() => {
    onDictated.current = (text: string) => {
      setDictation(text)
      read(text)
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
    if (!open) return
    let live = true
    api
      .liveAsrConfig('dictation')
      .then((config) => {
        if (!live) return
        setLiveConfig(config)
        /*
         * Cleared on success, not only set on failure. Reopening the theatre
         * re-runs this effect, so a first attempt that failed and a retry that
         * succeeded would otherwise leave the "transcribes on this device"
         * sentence on screen while the socket was open. With the consent tick
         * gone from this surface that sentence is the only thing left telling
         * the doctor where the audio goes, so it must not be able to be false.
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
  }, [open])

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

  const reset = useCallback(() => {
    setDictation('')
    setParsedFrom(null)
    setLines([])
    setEdits(new Map())
    setManual([])
    setParseFailed(false)
    setError(null)
    sent.current = null
    cappedRef.current = false
  }, [])

  /** The microphone or the on-device model has the box. */
  const listening = phase !== 'idle' || stream.phase !== null
  const busy = listening || parse.isPending

  /*
   * Read again once the doctor stops editing, rather than on a button. The box
   * stays editable while a read is in flight; a response for text since
   * changed is dropped by `parse`.
   */
  useEffect(() => {
    if (!open || listening) return
    const text = dictation.trim()
    if (text === '') {
      setLines([])
      setParsedFrom(null)
      sent.current = null
      return
    }
    if (text === sent.current) return
    const timer = window.setTimeout(() => read(text), REPARSE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, listening, dictation, read])

  /** The table is from the text as it stands, not from words since changed. */
  const fresh = parsedFrom !== null && dictation.trim() === parsedFrom
  const everyRow: LineRow[] = [
    ...(parsedFrom === null ? [] : rowsFrom(parsedFrom, lines, edits)),
    ...manual.map(({ key, phrase }) => manualRow(key, phrase, edits.get(key))),
  ]
  const rows = everyRow.filter(({ key }) => edits.get(key)?.removed !== true)
  const removedCount = everyRow.length - rows.length
  const { ready, unnamed, undecided } = toConfirm(rows)
  const room = MAX_PRESCRIPTIONS - stored.length
  /*
   * After the first read rather than on the first keystroke, so a doctor typing
   * from Add does not watch the surface widen under the words.
   */
  const reviewing = !capturing && (parsedFrom !== null || parseFailed || manual.length > 0)

  /** Stable across edits, so a row's React key and focus target never move. */
  const mintKey = () => {
    nextKey.current += 1
    return `manual-${nextKey.current}`
  }

  /** Each row's drug field, so focus can follow the doctor's act. */
  const drugFields = useRef(new Map<string, HTMLInputElement>())
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const key = focusNext.current
    if (key === null) return
    focusNext.current = null
    drugFields.current.get(key)?.focus()
  })

  const edit = (key: string, change: LineEdit) =>
    setEdits((current) => {
      const before = current.get(key)
      return new Map(current).set(key, {
        ...before,
        ...change,
        fields: { ...before?.fields, ...change.fields },
      })
    })

  const addByHand = () => {
    /*
     * The live box is the evidence, because a row typed by hand was read from
     * no line of it. Without words behind it there is nothing to quote, and
     * `dictated` is required.
     */
    const phrase = dictation.trim()
    if (phrase.length === 0) return
    const key = mintKey()
    focusNext.current = key
    setManual((current) => [...current, { key, phrase }])
  }

  /*
   * One control for the table rather than one per row, beside Add Line, acting
   * on the ticked lines the way a list's selection does. A row read from the
   * box is hidden rather than deleted, since its words are still there and the
   * next read would only bring it back; a row added by hand is hidden too, so
   * Restore can bring either back.
   *
   * The tick also means "include", and exact names start ticked, so the button
   * counts what it would take and asks before it takes a named drug. Without
   * both, one press on a freshly read table hid every line it had.
   */
  const ticked = rows.filter((row) => row.ticked)
  const removeTicked = () => {
    if (ticked.length === 0) return
    const named = ticked.some((row) => row.draft.drug.trim() !== '')
    if (named && !window.confirm(removePrompt(ticked.length))) return
    setEdits((current) => {
      const next = new Map(current)
      for (const row of ticked) next.set(row.key, { ...current.get(row.key), removed: true })
      return next
    })
    self.current?.querySelector<HTMLButtonElement>(`[aria-label="${ADD_LINE_LABEL}"]`)?.focus()
  }

  const restoreRemoved = () =>
    setEdits((current) => {
      const next = new Map(current)
      for (const [key, each] of current) {
        if (each.removed) next.set(key, { ...each, removed: undefined })
      }
      return next
    })

  const stale = parsedFrom !== null && !fresh
  const confirmable =
    ready.length > 0 &&
    unnamed === 0 &&
    undecided === 0 &&
    ready.length <= room &&
    !busy &&
    !stale &&
    !save.isPending

  const confirm = () => {
    if (!confirmable) return
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
    if (parse.isPending || (stale && !parseFailed)) return 'Reading the prescription.'
    return ''
  }

  const status =
    statusLine() !== ''
      ? statusLine()
      : undecided > 0
        ? `${undecided} ${undecided === 1 ? 'line was' : 'lines were'} not an exact match. Tick to accept, or leave it out.`
        : unnamed > 0
          ? `${unnamed} ticked ${unnamed === 1 ? 'line has' : 'lines have'} no drug name. Name it, or untick it to leave it out.`
          : ready.length > room
            ? `Ten is the most this record holds, and ${stored.length} already recorded. Untick a line.`
            : reviewing
              ? `${ready.length} to confirm, ${stored.length} already recorded`
              : ''
  const failure = error ?? stream.error

  /**
   * The one question, asked by every path that would drop staged rows.
   *
   * It lived on `onCancel` alone, which fires for Escape and never for
   * `close()`, so the header's X and the Discard button each wiped the list
   * without asking. A guard reachable by one of three doors is not a guard.
   */
  const mayDiscard = () => ready.length === 0 || window.confirm(DISCARD_PROMPT)

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
    /*
     * Sized by what it holds rather than by the viewport. One column while
     * there is only the box to show, at a width that keeps the dictated text
     * near the measure the note uses; two once there are decisions to make,
     * wide enough to keep the 440px decision column beside an evidence column
     * of about the same width the box had. Height follows the content up to
     * the ceiling `ChecklistPanel` and `CatatAI` use, and past it the body
     * scrolls while the header and the Confirm footer stay put. `open:flex`
     * rather than `flex`, for the reason `ChecklistPanel` gives: author display
     * outranks the UA rule hiding a closed dialog.
     *
     * A fifth larger on every bound than it first shipped (08/10/26): six
     * columns of sig controls left the drug field too narrow to read a long
     * generic name.
     *
     * The background is the Completeness Checklist's, so the two floating
     * panels on the review page read as one family: `glass-panel` chrome for
     * the header and footer, an opaque `bg-sunken` body, and bordered surface
     * cards on it. The lighter `.glass` tried in #427 frosted the chrome but
     * left white cards floating on a translucent ground, which read as two
     * materials fighting rather than as glass.
     */
    <dialog
      ref={self}
      onClose={() => {
        reset()
        onClose()
      }}
      onCancel={cancel}
      aria-labelledby={titleId}
      data-print="hide"
      className={cn(
        'glass-panel m-auto max-h-[min(92vh,57.5rem)] max-w-none overflow-hidden rounded-float p-0 text-ink open:flex open:flex-col backdrop:bg-scrim backdrop:backdrop-blur-sm',
        reviewing ? 'w-[min(77rem,calc(100vw-2rem))]' : 'w-[min(48rem,calc(100vw-2rem))]',
      )}
    >
      {open && (
        <>
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <p
                id={titleId}
                className="truncate font-display text-base font-semibold leading-tight"
              >
                {patientName ?? 'Consultation'}
              </p>
              <p className="text-2xs text-ink-muted">Prescription Dictation</p>
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
                  <InputMeter variant="wave" stream={liveStream ?? stream.micStream ?? undefined} />
                  <span className="hidden tabular-nums text-sm text-ink-muted sm:inline">
                    {clock(elapsed)}
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
                  {!thin && (
                    <Button
                      size="sm"
                      variant="neutral"
                      icon={<Mic aria-hidden className="size-3.5" />}
                      disabled={listening}
                      onClick={startDictation}
                    >
                      {parsedFrom === null ? 'Dictate' : 'Dictate Again'}
                    </Button>
                  )}
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

          <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto bg-sunken p-4 sm:p-5">
            <section className={PANEL}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold text-ink" id={boxId}>
                  What You Prescribed
                </span>
                <span aria-hidden className="tabular-nums text-2xs text-ink-muted">
                  {dictation.length} / {MAX_DICTATED_CHARACTERS}
                </span>
              </div>

              {/* Grows with the words as they arrive, where the browser can
                size a field to its content, and scrolls past the ceiling. It
                stays editable while a read is in flight, so typing never loses
                focus to a parse. */}
              <textarea
                ref={box}
                aria-labelledby={boxId}
                className={cn(
                  'mt-2 block w-full resize-y rounded-control border border-line bg-surface p-3 text-sm leading-relaxed transition-colors field-sizing-content hover:border-accent focus:border-accent',
                  reviewing ? 'max-h-32 min-h-12' : 'max-h-72 min-h-36',
                )}
                placeholder="amoxicillin 500 mg, three times a day, after food, for five days"
                maxLength={MAX_DICTATED_CHARACTERS}
                value={dictation}
                onChange={(event) => setDictation(event.target.value)}
                disabled={listening}
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
                  The lines below follow this text as you edit it.
                </p>
              )}

              {configFailure !== null && (
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

            {reviewing && (
              <section className={PANEL} aria-labelledby={linesId}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id={linesId} className="text-xs font-semibold text-ink">
                    Prescription Lines
                  </h3>
                  <span className="tabular-nums text-2xs text-ink-muted">
                    {rows.filter(({ ticked }) => ticked).length} of {rows.length} ticked
                  </span>
                </div>

                {parseFailed && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>The text could not be read. The lines may be out of date.</span>
                    <Button size="sm" variant="neutral" onClick={() => read(dictation.trim())}>
                      Try Again
                    </Button>
                  </div>
                )}

                {/* A parse that found nothing must say so. Brand names are
                  outside the lexicon by D-001, so this is a common case. */}
                {everyRow.length === 0 && fresh && (
                  <p className="mt-2 text-xs text-ink-muted">
                    No drug name or dose was read from the text. Add a line and fill it in.
                  </p>
                )}

                {rows.length > 0 && (
                  <>
                    <div aria-hidden className={cn('mt-3 hidden gap-2 px-3 lg:flex', FIELD_LABEL)}>
                      <span className="w-64 shrink-0 pl-6.5">Drug</span>
                      <span className={cn(SIG_GRID, 'flex-1')}>
                        <span>Dose</span>
                        <span>Duration</span>
                        <span>Frequency</span>
                        <span>With Food</span>
                        <span>Route</span>
                      </span>
                    </div>

                    <ul aria-label="Prescription lines" className="mt-2 space-y-2">
                      {rows.map((row, index) => {
                        const line = index + 1
                        const needsName = row.ticked && row.draft.drug.trim() === ''
                        const prompt = needsName || row.undecided
                        const noteId = `${linesId}-needs-${line}`
                        const pick = row.candidates.find(
                          ({ lexiconId }) => lexiconId === row.draft.lexiconId,
                        )
                        const others = row.exact
                          ? []
                          : row.candidates.filter(
                              (candidate, at, all) =>
                                candidate.lexiconId !== row.draft.lexiconId &&
                                all.findIndex(
                                  ({ lexiconId }) => lexiconId === candidate.lexiconId,
                                ) === at,
                            )
                        return (
                          <li
                            key={row.key}
                            className={cn(
                              'rounded-control p-3',
                              // The prompt grammar information gaps use, not a
                              // severity colour: this asks for a name, it warns
                              // of nothing (docs/DESIGN.md, Severity).
                              prompt
                                ? 'border border-dashed border-ink-muted bg-surface'
                                : 'bg-sunken-soft',
                            )}
                          >
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                              <div className="flex items-center gap-2 lg:w-64 lg:shrink-0">
                                <Checkbox
                                  aria-label={`Include line ${line}`}
                                  checked={row.ticked}
                                  onChange={(event) =>
                                    edit(row.key, { ticked: event.target.checked })
                                  }
                                />
                                <DrugField
                                  inputRef={(node) => {
                                    if (node === null) drugFields.current.delete(row.key)
                                    else drugFields.current.set(row.key, node)
                                  }}
                                  label={`Drug, line ${line}`}
                                  invalid={needsName}
                                  describedBy={prompt ? noteId : undefined}
                                  suggestions={generics}
                                  className={cn(TEXT_INPUT, 'min-w-0 flex-1')}
                                  value={row.draft.drug}
                                  onChange={(drug) => edit(row.key, { drug })}
                                />
                              </div>

                              <div className={cn(SIG_GRID, 'lg:flex-1')}>
                                <div className="flex min-w-0 flex-col gap-1">
                                  <FieldName>Dose</FieldName>
                                  <input
                                    aria-label={`Dose, line ${line}`}
                                    className={cn(TEXT_INPUT, 'min-w-0')}
                                    value={row.draft.dose}
                                    onChange={(event) =>
                                      edit(row.key, { fields: { dose: event.target.value } })
                                    }
                                  />
                                </div>
                                <div className="flex min-w-0 flex-col gap-1">
                                  <FieldName>Duration</FieldName>
                                  <input
                                    aria-label={`Duration, line ${line}`}
                                    className={cn(TEXT_INPUT, 'min-w-0')}
                                    value={row.draft.duration}
                                    onChange={(event) =>
                                      edit(row.key, { fields: { duration: event.target.value } })
                                    }
                                  />
                                </div>
                                <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                                  <FieldName>Frequency</FieldName>
                                  <Select
                                    label={`Frequency, line ${line}`}
                                    value={row.draft.frequency}
                                    options={FREQUENCY_OPTIONS}
                                    onChange={(frequency) =>
                                      edit(row.key, {
                                        fields: { frequency: frequency as SigFrequency | '' },
                                      })
                                    }
                                  />
                                </div>
                                <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                                  <FieldName>With Food</FieldName>
                                  <Select
                                    label={`With food, line ${line}`}
                                    value={row.draft.food}
                                    options={FOOD_OPTIONS}
                                    onChange={(food) =>
                                      edit(row.key, {
                                        fields: { food: food as SigFoodTiming | '' },
                                      })
                                    }
                                  />
                                </div>
                                <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                                  <FieldName>Route</FieldName>
                                  <Select
                                    label={`Route, line ${line}`}
                                    value={row.draft.route}
                                    options={ROUTE_OPTIONS}
                                    onChange={(route) =>
                                      edit(row.key, { fields: { route: route as SigRoute | '' } })
                                    }
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 space-y-1 text-2xs text-ink-muted lg:pl-6.5">
                              {/* The words this line was read from, so a wrong
                                split is visible rather than silent. */}
                              {row.span !== undefined && parsedFrom !== null && (
                                <p className="line-clamp-2 font-mono">
                                  <Quote text={parsedFrom} span={row.span} name={pick} />
                                </p>
                              )}
                              {row.kind === 'manual' && <p>Added by hand.</p>}
                              {needsName && (
                                <p id={noteId} className="flex items-center gap-1.5 text-ink">
                                  <CircleHelp aria-hidden className="size-3.5 shrink-0" />
                                  <span>
                                    <strong className="font-semibold">Needs a drug name.</strong>{' '}
                                    None was recognised. Name it, or untick it to leave it out.
                                  </span>
                                </p>
                              )}
                              {row.kind === 'heard' && !row.exact && pick !== undefined && (
                                <div
                                  id={row.undecided ? noteId : undefined}
                                  className={cn(
                                    'flex flex-wrap items-center gap-x-2 gap-y-1',
                                    row.undecided && 'text-ink',
                                  )}
                                >
                                  {row.undecided && (
                                    <CircleHelp aria-hidden className="size-3.5 shrink-0" />
                                  )}
                                  <span>
                                    {row.undecided && (
                                      <strong className="font-semibold">Needs a decision. </strong>
                                    )}
                                    {pick.heard.toLowerCase() === pick.generic
                                      ? 'Another drug or reading was heard in the same phrase.'
                                      : `Heard “${pick.heard}”, which is not an exact match.`}
                                    {row.undecided ? ` Tick to accept ${pick.generic}, or` : ''}
                                  </span>
                                  {row.undecided && (
                                    <button
                                      type="button"
                                      aria-label={`Leave line ${line} out`}
                                      className="font-semibold text-ink underline decoration-ink-muted underline-offset-2 hover:text-accent"
                                      onClick={() => edit(row.key, { ticked: false })}
                                    >
                                      leave it out
                                    </button>
                                  )}
                                </div>
                              )}
                              {others.length > 0 && (
                                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span>Or read as</span>
                                  {others.map((candidate) => (
                                    <button
                                      key={candidate.lexiconId}
                                      type="button"
                                      aria-label={`Read line ${line} as ${candidate.generic}`}
                                      className="font-semibold text-ink underline decoration-accent underline-offset-2 hover:text-accent"
                                      onClick={() => {
                                        // The button leaves with the choice, so
                                        // focus goes to the name it just set.
                                        drugFields.current.get(row.key)?.focus()
                                        edit(row.key, {
                                          chosen: candidate.lexiconId,
                                          drug: undefined,
                                          ticked: true,
                                        })
                                      }}
                                    >
                                      {candidate.generic}
                                    </button>
                                  ))}
                                </p>
                              )}
                              {parsedFrom !== null &&
                                [...new Set(row.shared.map(({ start }) => start))].map((start) => {
                                  const from = row.shared.filter((each) => each.start === start)
                                  return (
                                    <p key={start}>
                                      {from.map(({ field }) => SHARED_NAMES[field]).join(', ')} from
                                      “{parsedFrom.slice(start, from[0]?.end ?? start)}”
                                    </p>
                                  )
                                })}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="neutral"
                    aria-label={ADD_LINE_LABEL}
                    icon={<Plus aria-hidden className="size-3.5" />}
                    disabled={dictation.trim().length === 0}
                    onClick={addByHand}
                  >
                    Add Line
                  </Button>
                  <Button
                    size="sm"
                    variant="neutral"
                    aria-label={REMOVE_LABEL}
                    title={REMOVE_LABEL}
                    icon={<Trash2 aria-hidden className="size-3.5" />}
                    disabled={ticked.length === 0}
                    onClick={removeTicked}
                  >
                    {ticked.length > 0 && (
                      <span aria-hidden className="tabular-nums">
                        {ticked.length}
                      </span>
                    )}
                  </Button>
                  {removedCount > 0 && (
                    <Button
                      size="sm"
                      variant="neutral"
                      icon={<RotateCcw aria-hidden className="size-3.5" />}
                      onClick={restoreRemoved}
                    >
                      Restore {removedCount}
                    </Button>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Below `sm` the status takes a row of its own above the buttons
            rather than truncating beside them, because it is what says why
            Confirm is still disabled. */}
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3.5">
            <div
              className={cn(
                'min-w-0 sm:flex-1 sm:basis-0',
                (status !== '' || failure !== null) && 'basis-full',
              )}
            >
              {/* Always mounted, because a live region added to the DOM
                alongside its first content is the shape screen readers miss. */}
              <p role="status" className="text-xs text-ink-muted sm:truncate">
                {status}
              </p>
              {failure !== null && (
                <p role="alert" className="mt-1 text-xs text-emergency">
                  {failure}
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

            {rows.length > 0 && (
              <Button
                size="sm"
                variant="neutral"
                disabled={save.isPending}
                onClick={() => {
                  if (mayDiscard()) reset()
                }}
              >
                Discard
              </Button>
            )}

            <Button
              variant="primary"
              disabled={!confirmable}
              loading={save.isPending}
              icon={<Check aria-hidden className="size-4" />}
              onClick={confirm}
            >
              {ready.length > 1 ? `Confirm ${ready.length} Prescriptions` : 'Confirm Prescription'}
            </Button>
          </footer>
        </>
      )}
    </dialog>
  )
}
