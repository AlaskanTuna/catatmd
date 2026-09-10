import {
  type ConsultationStatus,
  type LiveAsrConfig,
  MAX_PRESCRIPTIONS,
  type MedicationCandidateWire,
  type Prescription,
  type PrescriptionParseResponse,
  SIG_FOOD_TIMINGS,
  SIG_FREQUENCIES,
  SIG_ROUTES,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { Check, ChevronDown, Mic, Settings2, Square, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog.js'
import { type AudioSettings, loadAudioSettings } from '../audio/audio-settings.js'
import { ConsentGate, REGION_LABELS } from '../audio/ConsentGate.js'
import {
  belowHardwareFloor,
  DICTATION_AUDIO_CONSTRAINTS,
  STALL_TIMEOUT_MS,
  toMono16k,
} from '../audio/dictation.js'
import { InputMeter } from '../audio/InputMeter.js'
import type { WorkerRequest, WorkerResponse } from '../audio/protocol.js'
import { useDemoTour } from '../demo/DemoTour.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'
import { Select, type SelectOption } from '../ui/Select.js'
import { NOT_AGREED_ERROR, START_FAILED_ERROR, useDictationStream } from './use-dictation-stream.js'

/**
 * The draft the doctor is filling in, before it is a `Prescription`.
 *
 * Enum fields are the empty string rather than `null` because `Select` speaks
 * strings, and `toPrescription` is the single place that translates back. Every
 * sig field is nullable on the wire, so "not specified" has to survive the
 * round trip rather than being coerced into a value nobody said.
 */
export type PrescriptionDraft = {
  drug: string
  /** Present only while the doctor is standing behind a lexicon candidate. */
  lexiconId?: string
  dose: string
  route: SigRoute | ''
  frequency: SigFrequency | ''
  duration: string
  food: SigFoodTiming | ''
}

export const EMPTY_DRAFT: PrescriptionDraft = {
  drug: '',
  dose: '',
  route: '',
  frequency: '',
  duration: '',
  food: '',
}

/**
 * Take a lexicon candidate as the drug name, on the doctor's explicit act.
 *
 * **This is the only writer of `drug` from a candidate, and the only writer of
 * `lexiconId` at all.** `MedicationCandidate` carries `generic` alongside
 * `start` and `end`, which together are a splice instruction the data shape
 * will happily let anything act on; #311 guarantees only that the matcher never
 * rewrites text, so confirm-before-apply is a property this layer has to
 * re-establish rather than inherit. Automatic substitution of a drug name is a
 * named row in `docs/decisions.md` D-001's Not Built table, because look-alike
 * sound-alike confusion is a leading medication-error class.
 *
 * Exported for its test, and pure so that test needs no component.
 */
export function acceptCandidate(
  draft: PrescriptionDraft,
  candidate: MedicationCandidateWire,
): PrescriptionDraft {
  return { ...draft, drug: candidate.generic, lexiconId: candidate.lexiconId }
}

/**
 * Type a drug name by hand, which drops any lexicon provenance with it.
 *
 * `lexiconId` records that the doctor accepted a candidate. Leaving it attached
 * to a name they then edited would claim a match the lexicon never made, so the
 * key goes rather than going stale.
 */
export function setDrugByHand(draft: PrescriptionDraft, drug: string): PrescriptionDraft {
  const next = { ...draft, drug }
  delete next.lexiconId
  return next
}

/**
 * The draft as it goes on the wire, or `null` while it is not yet a
 * prescription.
 *
 * Two shapes matter and neither is obvious from the schema at a glance.
 * `lexiconId` is optional and **not** nullable, so an absent one is omitted
 * rather than sent as `null`. Every sig field is a required key that may be
 * `null`, so what the parser could not read travels as an explicit `null`.
 *
 * `drug` and `dictated` are both `min(1)`, so an empty either way is not a
 * prescription yet. Returning `null` is what keeps Confirm disabled rather than
 * letting the API answer with a 400.
 */
export function toPrescription(draft: PrescriptionDraft, dictated: string): Prescription | null {
  const drug = draft.drug.trim()
  const phrase = dictated.trim()
  if (drug.length === 0 || phrase.length === 0) return null

  return {
    drug,
    ...(draft.lexiconId === undefined ? {} : { lexiconId: draft.lexiconId }),
    dose: draft.dose.trim() === '' ? null : draft.dose.trim(),
    route: draft.route === '' ? null : draft.route,
    frequency: draft.frequency === '' ? null : draft.frequency,
    duration: draft.duration.trim() === '' ? null : draft.duration.trim(),
    food: draft.food === '' ? null : draft.food,
    dictated: phrase,
  }
}

/** A stable identity for a candidate, so rejecting one does not dismiss another. */
export const candidateKey = (candidate: MedicationCandidateWire) =>
  `${candidate.start}:${candidate.end}:${candidate.lexiconId}`

/**
 * The candidates still on offer, in the order the matcher returned them.
 *
 * **Filtered only, never sorted, grouped or deduped.** The order is score, then
 * span length, then id, and it is a fix rather than a presentation choice: a
 * clinical-safety review on #311 found a contained single agent outranking the
 * combination the doctor actually dictated, because it scored higher on a
 * shorter span. Re-ordering here would reintroduce exactly that.
 */
export function visibleCandidates(
  candidates: readonly MedicationCandidateWire[],
  rejected: ReadonlySet<string>,
): MedicationCandidateWire[] {
  return candidates.filter((candidate) => !rejected.has(candidateKey(candidate)))
}

/** `PrescriptionSchema.dictated` is `max(400)`; the box stops rather than the API. */
const MAX_DICTATED_CHARACTERS = 400

/**
 * Joins what was already in the box to what the stream has settled, bounded by
 * the field's own limit.
 *
 * **It cuts at a word boundary, never mid-word.** `dictated` is the evidence
 * field the sig was parsed from and the doctor reads it back to check the
 * parse, so half a drug name there is worse than a short quote.
 *
 * **`capped` is what stops the session**, not just the text. A stream that
 * keeps billing while its words are discarded is spend with no product, on a
 * path `.claude/rules/security.md` records as having no global budget.
 */
export function capDictation(
  prefix: string,
  streamed: string,
  limit: number,
): { text: string; capped: boolean } {
  const joined = prefix.length > 0 ? `${prefix.trimEnd()} ${streamed}` : streamed
  if (joined.length <= limit) return { text: joined, capped: false }

  const cut = joined.slice(0, limit)
  const boundary = cut.lastIndexOf(' ')
  /*
   * No boundary means the very first token is longer than the whole budget, so
   * there is no whole word to keep. It yields nothing rather than a fragment:
   * the invariant that this field never shows a partial drug name is worth more
   * than salvaging characters, and at a 400 character limit the branch needs a
   * single unbroken 400 character word to reach it at all.
   */
  return { text: boundary > 0 ? cut.slice(0, boundary).trimEnd() : '', capped: true }
}

const STALL_ERROR = `Transcription was stopped after ${Math.round(
  STALL_TIMEOUT_MS / 60_000,
)} minutes with no sign of progress. The speech model may be unreachable from this network. Type the medication instead.`

const WORKER_DIED_ERROR = 'Speech recognition stopped unexpectedly. Type the medication instead.'

/** `every-6-hours` reads as `Every 6 Hours`. Labels are Title Case (docs/DESIGN.md). */
const titleCase = (value: string) =>
  value.replace(/-/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

/** The one set whose bare values are ambiguous: "before" what? */
const FOOD_LABELS: Record<SigFoodTiming, string> = {
  before: 'Before Food',
  after: 'After Food',
  with: 'With Food',
}

const optionsFor = <T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): SelectOption[] => [
  { value: '', label: 'Not Specified' },
  ...values.map((value) => ({ value, label: label(value) })),
]

const ROUTE_OPTIONS = optionsFor(SIG_ROUTES, titleCase)
const FREQUENCY_OPTIONS = optionsFor(SIG_FREQUENCIES, titleCase)
const FOOD_OPTIONS = optionsFor(SIG_FOOD_TIMINGS, (value) => FOOD_LABELS[value])

const FIELD_LABEL = 'text-2xs font-semibold uppercase tracking-wide text-ink-muted'
const TEXT_INPUT =
  'h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent'

/** The sig fields as they arrive from the parser, `null` becoming "not specified". */
function fromSig(
  sig: PrescriptionParseResponse['sig'],
): Omit<PrescriptionDraft, 'drug' | 'lexiconId'> {
  return {
    dose: sig.dose ?? '',
    route: sig.route ?? '',
    frequency: sig.frequency ?? '',
    duration: sig.duration ?? '',
    food: sig.food ?? '',
  }
}

function summarise(prescription: Prescription) {
  return [
    prescription.dose,
    prescription.route === null ? null : titleCase(prescription.route),
    prescription.frequency === null ? null : titleCase(prescription.frequency),
    prescription.food === null ? null : FOOD_LABELS[prescription.food],
    prescription.duration === null ? null : `for ${prescription.duration}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/**
 * Record the medication the doctor dictated (#313, `docs/decisions.md` D-001).
 *
 * **The dictation is a text field, and the microphone fills it.** The parse
 * route takes text and never audio, and `dictated` is required and non-empty,
 * so typing is the path and speaking is an accelerator on it. That is what
 * makes every way the microphone can be unavailable cost nothing: the same box
 * still works, which is this feature's shape of the rule that a failure
 * degrades to typing and never to the cloud.
 *
 * **Streaming by default since 10/09/26, on-device by fallback and by floor
 * (#363).** `DEFAULT_AUDIO_SETTINGS.dictationEngine` is `'streaming'`, so a
 * doctor who changes nothing is offered the second surface on the ambient
 * Soniox egress and is asked for consent before anything opens. Choosing
 * on-device in the Audio dialog dictates into
 * `../audio/transcribe.worker.js` instead, where no audio leaves and no
 * consent tick is offered because there is nothing to consent to.
 *
 * **What the default costs is written down rather than glossed.** The
 * two-control rule in `.claude/rules/security.md` is a standing device
 * preference plus a per-consultation tick, and a preference that ships already
 * set to send is not a choice the doctor made. This surface therefore rests on
 * one defaulted preference and one deliberate tick. The tick is unchanged,
 * still required, and still enforced in the start dispatcher rather than by a
 * disabled button, so nothing leaves without it.
 *
 * **The hardware floor no longer forces typing by default.** A socket loads no
 * weights, so `thin` narrows to the on-device engine and a machine below the
 * floor is offered streaming rather than the text box alone.
 *
 * **Every way streaming can fail lands back on the device or on typing.** Key
 * unset, config unreachable, consent withheld, mint refused, socket dropped: no
 * path falls through to the cloud, and none silently falls through to the
 * worker either, because a switch the doctor did not ask for produces a
 * different result with no word that it happened.
 *
 * **The tick is per consultation, not per prescription.** This component stays
 * mounted across several drugs for one patient, so `reset()` deliberately does
 * not clear it. Clearing it there would ask the same patient once per drug.
 *
 * **The drug name is never pre-filled, and the sig fields are.** Dose, route,
 * frequency, duration and food come from a deterministic regex parser and are
 * structuring, which D-001 puts inside the boundary. The name is the half where
 * a wrong value is a wrong drug, so it starts empty and is only ever written by
 * the doctor accepting a candidate or typing. Nothing is seeded from
 * `medicationsDispensed` either: that field is model-extracted, and this
 * component is given no prop through which it could arrive.
 *
 * **Nothing is stored until Confirm.** Parsing writes nothing server-side, the
 * draft is local state, and confirming is one ordinary
 * `PATCH /api/consultations/:id { prescriptions }` carrying the whole list.
 */
export function PrescriptionBlock({
  consultationId,
  prescriptions,
  status,
  onSave,
}: {
  consultationId: string
  /** `null` is the older API answering, and reads the same as none recorded. */
  prescriptions: Prescription[] | null
  status: ConsultationStatus
  onSave: (next: Prescription[]) => Promise<unknown>
}) {
  const stored = prescriptions ?? []
  // The PATCH gate is `awaiting_review` alone, so `draft` and `analyzing` 409
  // exactly as `approved` does. `!approved` would be the wrong predicate.
  const editable = status === 'awaiting_review'
  const full = stored.length >= MAX_PRESCRIPTIONS

  const tour = useDemoTour()
  const isPrescriptionStep =
    tour.active === true && tour.steps?.[tour.currentStep]?.target === '[data-tour="prescription"]'
  const [isOpen, setIsOpen] = useState(isPrescriptionStep)
  useEffect(() => {
    if (isPrescriptionStep) setIsOpen(true)
  }, [isPrescriptionStep])
  const bodyId = useId()

  /**
   * The standing half of the consent rule, and the dialog that writes it.
   *
   * **Mounted here as well as in `CapturePanel` because it was reachable only
   * from there** (#363). That panel renders under `{!detail.transcript}` while
   * this card needs a transcript and an analysis, so the switch and the
   * microphone it governs could never be on screen together: the standing half
   * of the rule was a control nobody could reach from the surface it governed.
   *
   * **Those same conditions make the two mounts mutually exclusive**, so
   * neither can overwrite the other's snapshot of the whole `catatmd.audio`
   * object. The lost update this comment used to warn about is prevented by
   * the render conditions rather than by convention, and `AudioSettingsDialog`
   * remains the single writer.
   *
   * Held as state rather than read once on mount, so a change made in the
   * dialog is seen here without a remount.
   */
  const [audio, setAudio] = useState<AudioSettings>(loadAudioSettings)
  const dictationEngine = audio.dictationEngine
  const audioDialog = useRef<HTMLDialogElement>(null)
  const [audioOpen, setAudioOpen] = useState(false)

  /*
   * Mounted only while open. `AudioSettingsDialog` carries an `InputMeter`
   * that opens a stream of its own in a mount effect, and a closed `<dialog>`
   * is `display: none` but still mounts its children, so keeping it in the
   * tree would hold a live microphone track and light the browser's recording
   * indicator on a page where the doctor is reading a note.
   */
  useEffect(() => {
    const node = audioDialog.current
    if (!audioOpen || !node) return
    node.showModal()
    const close = () => setAudioOpen(false)
    node.addEventListener('close', close)
    return () => node.removeEventListener('close', close)
  }, [audioOpen])
  /**
   * The per-consultation half, in plain `useState` so it dies with the
   * component. Never persisted, never folded into the preference above: that
   * collapse is exactly what #228 did and #254 undid.
   */
  const [agreed, setAgreed] = useState(false)
  const agreedRef = useRef(false)
  agreedRef.current = agreed
  /**
   * The recognition config, fetched only when streaming is the chosen engine.
   *
   * It carries the region the disclosure names. Read from the API rather than
   * the bundle for the reason `AmbientCapture` does the same: the sentence the
   * doctor reads and the socket the browser opens must not be able to disagree
   * about where the audio goes.
   */
  const [liveConfig, setLiveConfig] = useState<LiveAsrConfig | null>(null)
  const [configFailure, setConfigFailure] = useState<'unavailable' | 'unreachable' | null>(null)
  /** Both halves chosen, and the deployment actually has a provider configured. */
  const streaming = dictationEngine === 'streaming' && liveConfig !== null

  const [lowPower] = useState(belowHardwareFloor)
  /**
   * **A socket loads no weights**, so the hardware floor only hides the control
   * when the local model is what would run. Mirrors the override at
   * `AudioCapture.tsx`, and it is the one place this change leaves a
   * currently worse-off machine strictly better off than before.
   */
  const thin = lowPower && !streaming
  const [dictation, setDictation] = useState('')
  const [parsedFrom, setParsedFrom] = useState<string | null>(null)
  const [draft, setDraft] = useState<PrescriptionDraft>(EMPTY_DRAFT)
  const [candidates, setCandidates] = useState<readonly MedicationCandidateWire[]>([])
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  const [phase, setPhase] = useState<'idle' | 'recording' | 'loading-model' | 'transcribing'>(
    // One machine, not two. The streaming phases live in the hook and are
    // folded in below, so `busy` and every disabled state keep one source.
    'idle',
  )
  const [progress, setProgress] = useState<number | null>(null)
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attempt = useRef(0)
  const worker = useRef<Worker | null>(null)
  const stall = useRef<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const reset = useCallback(() => {
    setDictation('')
    setParsedFrom(null)
    setDraft(EMPTY_DRAFT)
    setCandidates([])
    setRejected(new Set())
  }, [])

  const parse = useMutation({
    mutationFn: (dictated: string) => api.parsePrescription(consultationId, dictated),
    onSuccess: (response, dictated) => {
      setError(null)
      // The drug name survives a re-check. The doctor authored it; only the
      // parser's own fields are the parser's to replace.
      setDraft((current) => ({ ...current, ...fromSig(response.sig) }))
      setCandidates(response.candidates)
      setRejected(new Set())
      setParsedFrom(dictated)
    },
    onError: () =>
      toast.error('That medication could not be checked. The fields are still yours to fill in.'),
  })

  const save = useMutation({ mutationFn: (next: Prescription[]) => onSave(next) })

  /*
   * The worker's `onmessage` is assigned once, so anything it calls would
   * otherwise be frozen at the first render's closure. The same trap
   * `AudioCapture` solves with `onTranscriptRef`.
   */
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

  /**
   * Whatever was already in the box when Dictate was pressed, snapshotted once.
   *
   * The textarea value is recomputed from the whole settled token list on every
   * batch rather than appended to, because `absorb` hands back the entire
   * `final` array and joining incrementally drifts on whitespace. That
   * recomputation would otherwise wipe text the doctor had typed first.
   */
  const prefix = useRef('')

  const stream = useDictationStream({
    agreed: agreedRef,
    onComplete: (text, notice) => {
      const { text: capped } = capDictation(prefix.current, text, MAX_DICTATED_CHARACTERS)
      const trimmed = capped.trim()
      if (notice !== null) toast(notice)
      // The single parse per dictation, in the slot the worker's `result`
      // message occupies on the on-device path. Never per token: candidate
      // offsets index the text the server last read.
      if (trimmed.length > 0) onDictated.current(trimmed)
    },
  })

  /*
   * Settled text lands in the field as it arrives. Interim never does: it is
   * rendered beneath, because a provisional token truncated at `maxLength`
   * becomes permanently truncated once it settles.
   */
  useEffect(() => {
    if (stream.phase !== 'streaming') return
    const { text, capped } = capDictation(prefix.current, stream.settled, MAX_DICTATED_CHARACTERS)
    setDictation(text)
    // The cap ends the session rather than only the text, so the socket stops
    // billing for words the field cannot hold.
    if (capped) stream.stop()
  }, [stream.phase, stream.settled, stream.stop])

  /*
   * **Nothing is requested on the on-device path.** A doctor who has not opted
   * in issues no call this component did not issue before #357, which is what
   * makes the change reversible: unset `SONIOX_API_KEY` or leave the preference
   * alone and the page behaves exactly as it did.
   */
  useEffect(() => {
    if (dictationEngine !== 'streaming') return
    let live = true
    api
      .liveAsrConfig('dictation')
      .then((config) => {
        if (live) setLiveConfig(config)
      })
      .catch((cause: unknown) => {
        if (!live) return
        /*
         * Both land in the same place, streaming not offered and the on-device
         * path on screen, but they are not the same claim. A 503 is a
         * deployment with no key set, which is a fact about the deployment.
         * Anything else is a network that did not answer, which is not, and
         * naming it as one would be a claim this component cannot support.
         *
         * The split only started earning its keep when streaming became the
         * default and every doctor could reach this line (#363).
         * `live/AmbientCapture.tsx` has drawn it since #268. Still no retry
         * button, for the original reason: the working alternative is already
         * the same button.
         */
        setConfigFailure(
          cause instanceof ApiError && cause.status === 503 ? 'unavailable' : 'unreachable',
        )
      })
    return () => {
      live = false
    }
  }, [dictationEngine])

  const clearStall = useCallback(() => {
    if (stall.current !== null) {
      window.clearTimeout(stall.current)
      stall.current = null
    }
  }, [])

  /**
   * The only way out of a run other than the worker answering. Terminate rather
   * than a cancel message, because the worker has none and one wedged inside a
   * fetch that never settles would not read it anyway.
   */
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

  /** Rearms the silence budget. Every worker message buys another window. */
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
      // A terminated worker's already-queued message must not resurrect state.
      if (attempt.current !== id) return
      const message = event.data
      switch (message.type) {
        case 'progress':
          watchForStall()
          setProgress(message.total > 0 ? Math.round((message.loaded / message.total) * 100) : null)
          setPhase('loading-model')
          break
        // `ready` can arrive more than once and always means the same state.
        case 'ready':
          watchForStall()
          setProgress(null)
          setPhase('transcribing')
          break
        case 'transcribing':
        case 'alive':
          watchForStall()
          break
        // The merge tail blocks the worker thread, so no heartbeat is possible
        // and the budget is cleared rather than rearmed.
        case 'finishing':
          clearStall()
          break
        case 'result':
          clearStall()
          setPhase('idle')
          setProgress(null)
          onDictated.current(message.text.trim())
          break
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
    // The only channels a dying worker has: a failed module fetch, a CSP block
    // or an out-of-memory kill fires no `message`, only these.
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
      // Armed before the decode, because a malformed container can hang
      // `decodeAudioData` before any worker exists to be waited on.
      watchForStall()
      try {
        const audio = await toMono16k(blob)
        if (attempt.current !== id) return
        const request: WorkerRequest = { type: 'transcribe', audio }
        ensureWorker().postMessage(request, [audio.buffer as ArrayBuffer])
      } catch {
        if (attempt.current !== id) return
        clearStall()
        setPhase('idle')
        setError('That recording could not be read. Type the medication instead.')
      }
    },
    [clearStall, ensureWorker, watchForStall],
  )

  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: DICTATION_AUDIO_CONSTRAINTS,
      })
      const media = new MediaRecorder(stream)
      chunks.current = []
      media.ondataavailable = (event) => chunks.current.push(event.data)
      media.onstop = () => {
        // Released explicitly. A live microphone track outliving the recording
        // leaves the browser's recording indicator on, which in a consulting
        // room reads as "still listening".
        for (const track of stream.getTracks()) track.stop()
        setLiveStream(null)
        void transcribe(new Blob(chunks.current, { type: media.mimeType }))
      }
      media.start()
      recorder.current = media
      setLiveStream(stream)
      setPhase('recording')
    } catch {
      setError('Microphone access was refused, or no microphone is available.')
    }
  }

  const stopRecording = () => {
    recorder.current?.stop()
    recorder.current = null
  }

  /**
   * The one dispatcher, and the only place either consent control is enforced.
   *
   * Both are read through refs rather than the render closure, because the
   * preference and the tick can each change between render and click. A
   * disabled button is a courtesy; this is the control.
   *
   * **A withheld tick refuses. It does not quietly run the local worker.**
   * Switching paths without saying so hands the doctor a different result with
   * no word that it happened, which is the rule `AudioCapture` states for the
   * mirror case. Choosing the on-device engine is not that: there the local
   * worker is the path the doctor asked for.
   */
  const startDictation = () => {
    setError(null)
    stream.clearError()
    if (!streaming) return startRecording()
    if (!agreedRef.current) {
      setError(NOT_AGREED_ERROR)
      return
    }
    prefix.current = dictation
    void stream.start()
  }

  const stopDictation = () => {
    if (stream.phase !== null) return stream.stop()
    stopRecording()
  }

  useEffect(
    () => () => {
      attempt.current += 1
      if (stall.current !== null) window.clearTimeout(stall.current)
      worker.current?.terminate()
      worker.current = null
      const media = recorder.current
      recorder.current = null
      if (media === null) return
      media.onstop = null
      if (media.state !== 'inactive') media.stop()
      for (const track of media.stream.getTracks()) track.stop()
    },
    [],
  )

  const busy = phase !== 'idle' || stream.phase !== null || parse.isPending
  /** Either engine is holding the microphone open, so Stop is what is offered. */
  const capturing = phase === 'recording' || stream.phase !== null
  // Offsets on a candidate belong to the text the server read. Editing the
  // dictation after a check moves them, so Accept waits for a fresh parse.
  const dirty = parsedFrom !== null && dictation.trim() !== parsedFrom.trim()
  const open = visibleCandidates(candidates, rejected)
  const ready = toPrescription(draft, dictation)
  const started = dictation.trim().length > 0 || draft.drug.trim().length > 0

  const addPrescription = () => {
    if (ready === null) return
    save.mutate([...stored, ready], { onSuccess: () => reset() })
  }

  const statusLine = () => {
    if (stream.phase === 'connecting') return 'Connecting.'
    if (stream.phase === 'streaming') return 'Listening. Press Stop when you have finished.'
    if (stream.phase === 'finishing') return 'Finishing, waiting for the last words.'
    if (phase === 'recording') return 'Listening. Press Stop when you have finished.'
    if (phase === 'loading-model') {
      return progress === null || progress >= 100
        ? 'Opening the speech model.'
        : `Downloading the speech model, ${progress}%.`
    }
    if (phase === 'transcribing') return 'Transcribing on this device.'
    if (parse.isPending) return 'Checking the medication.'
    return ''
  }

  // An empty card on a signed note says nothing worth the space.
  if (!editable && stored.length === 0) return null

  return (
    <Card data-tour="prescription" className="mt-5 p-4">
      <h2 className="text-sm font-semibold text-ink">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          className="flex w-full items-center justify-between gap-4 rounded-control text-left transition-colors duration-150 hover:bg-sunken-soft"
        >
          <span>Prescriptions</span>
          <span className="flex items-center gap-2 font-normal text-2xs text-ink-muted">
            {full
              ? `${stored.length} of ${MAX_PRESCRIPTIONS}, limit reached`
              : count(stored.length, 'prescription')}
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-ink-muted transition-transform duration-150',
                isOpen && 'rotate-180',
              )}
            />
          </span>
        </button>
      </h2>

      <div id={bodyId} data-print="block" className={cn(!isOpen && 'hidden')}>
        {stored.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            Nothing recorded yet. Dictate or type a medication below, check it, and confirm it.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {stored.map((prescription, index) => (
              <li
                key={`${prescription.drug}:${prescription.dictated}`}
                className="flex items-start justify-between gap-3 rounded-control bg-ground p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{prescription.drug}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{summarise(prescription)}</p>
                  <p className="mt-1 text-2xs italic text-ink-muted">
                    Dictated: {prescription.dictated}
                  </p>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant="neutral"
                    icon={<Trash2 aria-hidden className="size-3.5" />}
                    aria-label={`Remove ${prescription.drug}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate(stored.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable && full && (
          <p className="mt-3 text-xs text-ink-muted">
            Ten is the most this record holds. Remove one to add another.
          </p>
        )}

        {editable && !full && (
          <section className="mt-4 border-t border-line pt-4" aria-label="Add a prescription">
            <div className="flex items-baseline justify-between gap-3">
              <span className={FIELD_LABEL} id="dictation-label">
                What You Prescribed
              </span>
              <div className="flex items-center gap-2">
                {/* The engine switch, beside the microphone it governs, and
                    first so that Dictate and Check keep the positions they
                    have always had. The dialog is device scoped and shared
                    with the capture screen, so it carries the same name there
                    and here rather than inventing a second vocabulary for one
                    control. Closed while capturing, for the reason
                    `ConsentGate` is: the engine is not a mid-stream choice. */}
                <Button
                  size="sm"
                  variant="neutral"
                  aria-label="Audio settings"
                  title="Audio settings"
                  disabled={capturing}
                  icon={<Settings2 aria-hidden className="size-3.5" />}
                  onClick={() => setAudioOpen(true)}
                />
                {!thin && !capturing && (
                  <Button
                    size="sm"
                    variant="neutral"
                    icon={<Mic aria-hidden className="size-3.5" />}
                    disabled={busy || (streaming && !agreed)}
                    onClick={() => void startDictation()}
                  >
                    Dictate
                  </Button>
                )}
                {capturing && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Square aria-hidden className="size-3.5" />}
                    disabled={stream.phase === 'finishing'}
                    onClick={stopDictation}
                  >
                    Stop
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
              </div>
            </div>

            {/* Only where audio actually leaves. Offering a tick on the
              on-device path would be an invitation to the cloud on a screen
              that currently mentions none. */}
            {streaming && liveConfig !== null && (
              <div className="mt-2">
                <ConsentGate
                  agreed={agreed}
                  onAgreedChange={setAgreed}
                  disabled={capturing}
                  disclosure={`This dictation leaves this device: streamed from this browser to Soniox and transcribed in ${REGION_LABELS[liveConfig.region]}. Our server issues the session key and never receives the audio. The microphone is open only while you are dictating.`}
                />
              </div>
            )}

            <textarea
              aria-labelledby="dictation-label"
              className="mt-1.5 h-20 w-full resize-y rounded-control border border-line bg-surface p-3 text-sm leading-relaxed transition-colors hover:border-accent focus:border-accent"
              placeholder="amoxicillin 500 mg, three times a day, after food, for five days"
              maxLength={MAX_DICTATED_CHARACTERS}
              value={dictation}
              onChange={(event) => setDictation(event.target.value)}
              disabled={busy}
            />

            {/* Provisional tokens, outside the field on purpose: they are
              rewritten as the doctor speaks, and one truncated at `maxLength`
              would stay truncated once it settled. No `aria-live` either, since
              a region firing per token floods a screen reader; the status line
              below already narrates the phase. */}
            {stream.interim !== '' && (
              <p className="mt-1.5 text-xs text-ink-muted italic">{stream.interim}</p>
            )}

            {(liveStream ?? stream.micStream) && (
              <InputMeter
                stream={(liveStream ?? stream.micStream) as MediaStream}
                className="mt-2"
              />
            )}

            {/* Always mounted, because a live region added to the DOM alongside
              its first content is the shape screen readers miss. Empty it
              carries no margin and so takes no room. */}
            <p
              role="status"
              className={cn('text-xs text-ink-muted', statusLine() !== '' && 'mt-2')}
            >
              {statusLine()}
            </p>

            {(error ?? stream.error) !== null && (
              <p role="alert" className="mt-2 text-xs text-emergency">
                {error ?? stream.error}
              </p>
            )}

            {/* The way back, and it is a second deliberate press rather than an
              automatic switch. Nothing was sent on this path, so the local
              worker is a real alternative; running it without being asked would
              hand the doctor a different engine's result with no word that it
              happened. Offered only for a failure the local path can actually
              answer: a refused microphone is not one. */}
            {stream.error === START_FAILED_ERROR && !capturing && (
              <Button
                size="sm"
                variant="neutral"
                className="mt-2"
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

            {/* A deployment with no provider key, or a network that did not
              answer. Said plainly, with the path that still works, rather than
              a retry on a screen where the working alternative is the same
              button. */}
            {dictationEngine === 'streaming' && configFailure !== null && (
              <p className="mt-2 text-xs text-ink-muted">
                {configFailure === 'unavailable'
                  ? 'Streaming recognition is not available on this deployment, so Dictate transcribes on this device.'
                  : 'Streaming recognition could not be reached, so Dictate transcribes on this device.'}
              </p>
            )}

            {thin && (
              <p className="mt-2 text-xs text-ink-muted">
                This device does not have the memory to run the speech model, so type the medication
                above instead.
              </p>
            )}

            {open.length > 0 && parsedFrom !== null && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-ink">
                  Drug name candidates ({open.length})
                </h3>
                <p className="mt-1 text-xs text-ink-muted">
                  Each is a separate decision, and nothing fills the drug name until you accept one.
                </p>

                <ul className="mt-2 space-y-2">
                  {open.map((candidate) => {
                    const heardIsGeneric = candidate.heard.toLowerCase() === candidate.generic
                    return (
                      <li
                        key={candidateKey(candidate)}
                        className="rounded-control bg-ground p-3 text-xs text-ink-muted"
                      >
                        {/* Sliced from the text the offsets belong to, never from
                          the live box, so the marked span stays truthful while
                          the doctor is mid-edit. */}
                        <p className="font-mono leading-relaxed">
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
                            disabled={dirty}
                            onClick={() =>
                              setDraft((current) => acceptCandidate(current, candidate))
                            }
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
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={FIELD_LABEL}>Drug</span>
                <input
                  className={TEXT_INPUT}
                  value={draft.drug}
                  placeholder="Accept a candidate above, or type the name"
                  onChange={(event) =>
                    setDraft((current) => setDrugByHand(current, event.target.value))
                  }
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Dose</span>
                <input
                  className={TEXT_INPUT}
                  value={draft.dose}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, dose: event.target.value }))
                  }
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Route</span>
                <Select
                  label="Route"
                  value={draft.route}
                  options={ROUTE_OPTIONS}
                  onChange={(route) =>
                    setDraft((current) => ({ ...current, route: route as SigRoute | '' }))
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Frequency</span>
                <Select
                  label="Frequency"
                  value={draft.frequency}
                  options={FREQUENCY_OPTIONS}
                  onChange={(frequency) =>
                    setDraft((current) => ({
                      ...current,
                      frequency: frequency as SigFrequency | '',
                    }))
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>With Food</span>
                <Select
                  label="With Food"
                  value={draft.food}
                  options={FOOD_OPTIONS}
                  onChange={(food) =>
                    setDraft((current) => ({ ...current, food: food as SigFoodTiming | '' }))
                  }
                />
              </div>

              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Duration</span>
                <input
                  className={TEXT_INPUT}
                  value={draft.duration}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, duration: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Check aria-hidden className="size-3.5" />}
                disabled={ready === null || busy}
                loading={save.isPending}
                onClick={addPrescription}
              >
                Confirm Prescription
              </Button>
              {dictation.trim().length > 0 && (
                <Button
                  size="sm"
                  variant="neutral"
                  disabled={busy || save.isPending}
                  onClick={reset}
                >
                  Discard
                </Button>
              )}
              {ready === null && started && (
                <span className="text-xs text-ink-muted">
                  A drug name and what you said are both needed.
                </span>
              )}
            </div>

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
          </section>
        )}
      </div>
    </Card>
  )
}
