import { type DraftTurn, type HostedAsrResult, MAX_DRAFT_TEXT_CHARACTERS } from '@shared/types'
import { AlertTriangle, CircleHelp, FileAudio, Loader2, Mic, Square } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Button } from '../ui/Button.js'
import { Checkbox } from '../ui/Checkbox.js'
import {
  TARGET_SAMPLE_RATE,
  type TranscriptSegment,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.js'

/**
 * Record a consultation and transcribe it on the device (issue #2).
 *
 * **Audio is a button that fills a textarea, not a second pipeline.** The
 * transcript still lands in the same box as the paste path and goes through
 * the same `Doctor:` / `Patient:` parser. Since #118 the worker also returns
 * Whisper's segment timing, from which the caller drafts per-line speaker
 * labels for the doctor to review and apply. That is turn segmentation from
 * timing and punctuation, not diarisation: no voice model runs, and the
 * labels are guesses the doctor confirms line by line before anything enters
 * the transcript.
 *
 * **By default no audio byte reaches the API.** Capture, decode and inference
 * all happen here and in the worker. The only thing that crosses the network is
 * the model download from the HuggingFace CDN, and the text the doctor chooses
 * to submit.
 *
 * **The one exception is opt-in, per consultation, and never remembered**
 * (issue #155). Ticking the hosted-transcription box below sends that single
 * recording to the relay in `POST /api/asr/transcriptions`, which forwards it
 * to ILMU. The returned text then goes to `POST /api/asr/draft-turns`, where
 * the API de-identifies it and the note model drafts the same per-line
 * speaker labels for review; a labelling failure of any kind falls back to
 * the unlabelled prose (#189). The tick lives in plain `useState`, so it dies
 * with the component and cannot carry from one patient to the next. On-device
 * stays the default and the floor: nothing switches the doctor to hosted, and
 * an on-device failure degrades to typing or pasting, never to the cloud
 * (docs/trd.md section 20).
 */

/**
 * `whisper-small` on WASM against a browser on a thin machine is a plausible
 * out-of-memory kill in the middle of a consultation, which is a far worse
 * failure than not offering the feature (docs/prd.md §12).
 *
 * So the floor is a default, not a lock: a doctor who knows their machine can
 * proceed. Both signals are advisory. `deviceMemory` is coarse and Chromium
 * only, and `hardwareConcurrency` is missing on some browsers, so an unknown
 * value is treated as capable rather than blocked. The check is there to stop
 * someone stumbling into a crash, not to police hardware.
 */
function belowHardwareFloor() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = navigator.hardwareConcurrency
  const memory = nav.deviceMemory
  return (cores !== undefined && cores < 4) || (memory !== undefined && memory < 8)
}

/**
 * Whisper wants 16 kHz mono. `OfflineAudioContext` does the resample and the
 * channel downmix in one pass, which is both less code and more correct than
 * decimating by hand.
 */
async function toMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const decoder = new AudioContext()
  // Closed in a finally: browsers cap live AudioContexts, so one leaked by a
  // throwing decode would cost a later recording its decoder.
  const decoded = await decoder.decodeAudioData(bytes).finally(() => void decoder.close())

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/**
 * The silence budget: how long the record path may go without a worker
 * message before the run is declared wedged and terminated (issue #139).
 *
 * A budget on silence rather than on the whole job, because a
 * consultation-length recording legitimately transcribes for many minutes
 * (docs/trd.md section 20.1 measures a real-time factor of 1.5 to 3.0) and a
 * total deadline would abort exactly the recordings most expensive to lose.
 * The floor is set by ONNX session creation, which blocks the worker thread
 * on a roughly 240 MB decoder and is legitimately silent throughout.
 */
export const STALL_TIMEOUT_MS = 180_000

/**
 * How long a hosted upload may run before it is abandoned (issue #155).
 *
 * A total deadline, unlike the on-device silence budget above, because the
 * relay is one request with no progress to listen to: there is no midpoint at
 * which it can report that it is still working. 180 s covers a
 * consultation-length recording over a clinic connection plus the provider's
 * own 120 s upstream timeout, and expiring is a failure the doctor is told
 * about rather than a silent fall back to the on-device path.
 */
export const UPLOAD_TIMEOUT_MS = 180_000

/**
 * How long the labelling pass after a hosted transcription may run (#189).
 *
 * A total deadline like the upload's, and for the same reason: one request
 * with no progress to listen to. Sized to the LLM adapter's own bounds, a
 * 60 s timeout with one retry, plus headroom. Expiring is not reported as a
 * failure: the transcription is already in hand, so the doctor gets the
 * unlabelled prose rather than an error about the labels.
 */
export const LABEL_TIMEOUT_MS = 150_000

type Phase =
  | 'idle'
  | 'recording'
  | 'loading-model'
  | 'transcribing'
  | 'finishing'
  | 'uploading'
  | 'labelling'

/**
 * What the doctor is told when the budget expires or the worker dies. Both
 * point back at typing or pasting: on-device failure degrades to the paste
 * path, never to a hosted fallback (docs/trd.md section 20).
 */
const STALL_ERROR = `Transcription was stopped after ${Math.round(
  STALL_TIMEOUT_MS / 60_000,
)} minutes with no sign of progress. The speech model may be unreachable from this network. Try again, or type or paste the transcript instead.`

const WORKER_DIED_ERROR =
  'Speech recognition stopped unexpectedly. Try again, or type or paste the transcript instead.'

/**
 * What the doctor is told when the hosted relay fails or the upload bound
 * expires.
 *
 * **It degrades toward privacy, and it leads with where the audio still is.**
 * The recording has not been lost, and the two ways forward it offers are the
 * on-device path and the paste path. Nothing here switches the doctor
 * automatically in either direction: a hosted failure never silently runs the
 * local worker, exactly as a local failure never silently uploads
 * (docs/trd.md section 20).
 *
 * Deliberately one message for every upstream reason. The relay's own codes
 * separate rejected audio from a billing state from a timeout, but none of
 * those change what the doctor can do next, and naming them would leak the
 * provider's operational state onto a consulting-room screen.
 */
const HOSTED_FAILED_ERROR =
  'The recording is still on this device. Try again, transcribe on this device instead, or type or paste the transcript.'

/**
 * Roughly how much longer, from how long the finished chunks actually took.
 *
 * **Silent until it has two chunks to reason from.** One chunk is not a rate:
 * the first carries the session warm-up, so extrapolating from it overstates
 * the total badly, and a countdown that starts at nine minutes and then drops
 * to four teaches people to disbelieve it. No estimate reads better than a
 * wrong one.
 *
 * Rounded up to whole minutes above a minute, because the underlying rate is
 * not steady enough to justify "3:47" and displaying seconds would imply a
 * precision this cannot deliver.
 */
function estimateRemaining(done: number, total: number, elapsedMs: number): string | null {
  if (done < 2 || done >= total) return null

  const remainingMs = (elapsedMs / done) * (total - done)
  if (remainingMs < 45_000) return 'under a minute left'

  return `about ${Math.ceil(remainingMs / 60_000)} min left`
}

/**
 * The supplementary disclaimer beside the model name (issue #155).
 *
 * **A disclosure, not a hover tooltip.** It toggles on click and stays open, so
 * it works on touch, where hover does not exist and a doctor on a tablet would
 * otherwise never reach it. Focus and Escape behave the way `ui/Select.tsx`
 * establishes for this codebase.
 *
 * Hand-rolled for the reason `ui/Select.tsx` gives at length: nothing here uses
 * a headless UI library, and one disclosure is a poor reason to add a
 * dependency. It stays local to this file rather than moving to `ui/` because
 * there is exactly one of them; it earns a promotion when there is a second.
 *
 * **Nothing load-bearing lives in here.** The consent facts the doctor is
 * agreeing to are in the paragraph itself, because the tradeoff has to be
 * stated in the same breath as the choice rather than hidden behind an
 * interaction (docs/trd.md section 20).
 */
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const wrap = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // `pointerdown` rather than `click`, so a press that begins outside closes
    // the panel before it can also activate whatever it landed on.
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <span ref={wrap} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-5 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          // Anchored above and left-aligned so a panel this wide cannot push the
          // Record tab into a horizontal scroll on a narrow screen.
          className="absolute bottom-full left-0 z-10 mb-1.5 w-72 max-w-[80vw] rounded-card border border-line bg-surface p-3 text-xs leading-relaxed font-normal text-ink-muted shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}

export function AudioCapture({
  onTranscript,
}: {
  onTranscript: (result: {
    text: string
    segments: readonly TranscriptSegment[]
    source: 'asr_local' | 'asr_hosted'
    /** Server-drafted labels, hosted path only; absent whenever labelling failed. */
    draftTurns?: readonly DraftTurn[]
  }) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null)
  /** The audio behind the current or failed run, so Try Again can rerun it. */
  const [retryBlob, setRetryBlob] = useState<Blob | null>(null)
  /**
   * The per-consultation hosted-transcription consent (issue #155).
   *
   * **Plain `useState` on purpose.** No `localStorage`, no context, no query
   * cache: consent is given for one consultation and is not transferable to the
   * next patient, so it has to die when this component unmounts. Persisting it
   * would turn a per-consultation decision into a standing one, which is the
   * failure mode the whole control exists to prevent.
   */
  const [hosted, setHosted] = useState(false)

  /** When the current transcription started, for the remaining-time estimate. */
  const startedAt = useRef<number | null>(null)

  /** The armed silence-budget timer, if any. */
  const stall = useRef<number | null>(null)
  /**
   * Which run is current. Bumped by every abort and by unmount, and
   * snapshotted by everything asynchronous, so a cancelled run's late decode
   * or queued worker message can never resurrect state or build an orphan
   * worker.
   */
  const attempt = useRef(0)

  const worker = useRef<Worker | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  /** The in-flight hosted upload, so Cancel and unmount can both abandon it. */
  const upload = useRef<AbortController | null>(null)

  /*
   * The consent tick as a ref, because `media.onstop` is assigned once per
   * recording and would otherwise fork on whatever the checkbox read when the
   * recording started. The checkbox is disabled while recording, so the two
   * agree on that path today, but the file-picker and Try Again paths both run
   * against the current tick, and one source of truth is cheaper than
   * reasoning about which closure each caller captured.
   */
  const hostedRef = useRef(hosted)
  hostedRef.current = hosted

  /** Ties the consent label to its checkbox without wrapping the disclosure. */
  const consentId = useId()

  /**
   * True from the prewarm `load` posted at record start until the real
   * transcribe request is posted, or the run is torn down. While set, every
   * worker message is background chatter: nothing it says may change phase,
   * render progress, surface an error, or arm the silence budget (issue #145).
   */
  const prewarming = useRef(false)

  /*
   * Always the latest prop, never the closure the worker was created with.
   * The worker is created once and its onmessage assigned once, so a plain
   * closure would freeze the first render's onTranscript for every later
   * recording. The caller's handler reads state (is the transcript empty,
   * is a draft pending) to decide whether timestamps are trustworthy, and a
   * stale read there re-attaches offsets from a restarted timebase, which is
   * exactly the wrong-evidence-time bug the offsets rule exists to prevent.
   */
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  /*
   * The floor guards one thing: a 250-590 MB model held in memory by this tab.
   * A hosted recording opens no session and loads no weights, so it carries
   * none of that risk and the gate does not apply to it. Ticking hosted
   * therefore reveals the record controls on a floor-gated device without
   * touching `overridden`, which means unticking restores the gate rather than
   * leaving the doctor permanently past a warning they never accepted.
   */
  const thin = belowHardwareFloor() && !overridden && !hosted

  const clearStall = useCallback(() => {
    if (stall.current !== null) {
      window.clearTimeout(stall.current)
      stall.current = null
    }
  }, [])

  /**
   * The only way out of a run other than the worker answering. Terminate, not
   * a cancel message: a worker wedged inside a fetch that never settles will
   * not read one. A null message is the doctor cancelling; a string is a
   * failure they need to hear about.
   */
  const abort = useCallback(
    (message: string | null) => {
      attempt.current += 1
      clearStall()
      prewarming.current = false
      worker.current?.terminate()
      worker.current = null
      // The hosted equivalent of the terminate above. The bumped attempt makes
      // the upload's own catch fall through silently, so a cancel shows no
      // error, while the 180 s bound aborts without bumping and is therefore
      // still reported as the failure it is.
      upload.current?.abort()
      upload.current = null
      setPhase('idle')
      setProgress(null)
      setChunkProgress(null)
      startedAt.current = null
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
    const instance = new Worker(new URL('./transcribe.worker.js', import.meta.url), {
      type: 'module',
    })
    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      // A terminated worker's already-queued message must not resurrect
      // state: a result racing a cancel loses to the cancel.
      if (attempt.current !== id) return
      // Prewarm chatter: the doctor is still recording, and nothing the load
      // says may disturb that. The transcribe path clears the flag at its
      // post, so a load reply landing later reads as that run's own.
      if (prewarming.current) return
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
          startedAt.current = Date.now()
          break
        case 'transcribing':
          watchForStall()
          setChunkProgress({ done: message.done, total: message.total })
          break
        case 'alive':
          watchForStall()
          break
        case 'finishing':
          // The merge tail blocks the worker thread, so nothing can rearm the
          // budget until the result. Cleared rather than capped: any safe cap
          // would sit minutes past what Cancel already offers, and a wrong
          // one destroys a finished transcription.
          clearStall()
          setPhase('finishing')
          break
        case 'result':
          clearStall()
          setPhase('idle')
          setProgress(null)
          setChunkProgress(null)
          startedAt.current = null
          setRetryBlob(null)
          onTranscriptRef.current({
            text: message.text,
            segments: message.segments,
            source: 'asr_local',
          })
          break
        case 'error':
          // The worker survives an inference error with the model warm, so a
          // retry is cheap. A stalled or dead worker is terminated in `abort`
          // instead, and its retry rebuilds one.
          clearStall()
          setPhase('idle')
          setProgress(null)
          setChunkProgress(null)
          startedAt.current = null
          setError(message.message)
          break
        default: {
          const unhandled: never = message
          void unhandled
        }
      }
    }
    // The only channels a dying worker has: a failed module fetch, a CSP
    // block or an out-of-memory kill fires no `message`, only these. Without
    // them a death is indistinguishable from a slow load.
    const died = () => {
      if (attempt.current !== id) return
      if (prewarming.current && recorder.current !== null) {
        // The warm-up died while the doctor is still recording. Say nothing:
        // the recording is what matters, and the stop path rebuilds a fresh
        // worker and reloads from scratch. The bump drops any message this
        // worker already queued, which would otherwise land once the flag
        // clears. Not `abort`, which would reset the phase and drop the
        // recording UI. The `recorder` gate keeps the post-stop decode window
        // on the loud path: bumping there would strand the in-flight decode.
        attempt.current += 1
        clearStall()
        instance.terminate()
        worker.current = null
        prewarming.current = false
        return
      }
      abort(WORKER_DIED_ERROR)
    }
    instance.onerror = died
    instance.onmessageerror = died
    worker.current = instance
    return instance
  }, [abort, clearStall, watchForStall])

  useEffect(
    () => () => {
      // Closing the record tab mid-run must strand nothing: no timer left
      // armed, no worker left running, and a decode still in flight sees the
      // bumped attempt and builds nothing.
      attempt.current += 1
      if (stall.current !== null) window.clearTimeout(stall.current)
      worker.current?.terminate()
      worker.current = null
      // A hosted upload is a live request carrying consultation audio. Leaving
      // it in flight past the tab the doctor closed would keep sending audio
      // for a consent gesture that is no longer on screen.
      upload.current?.abort()
      upload.current = null
      // A recording still running owns the microphone, and nothing above
      // releases it: `onstop` does that, and only the Stop button reaches
      // `onstop`. Leaving it live keeps the browser's recording indicator on
      // after the doctor has moved to another tab (issue #140).
      //
      // Detached before stopping, because a stop the doctor did not ask for
      // must free the device without also queueing a transcription: that
      // handler would build a fresh worker moments after the terminate above,
      // for a component that is already gone.
      const media = recorder.current
      recorder.current = null
      if (media === null) return
      media.onstop = null
      if (media.state !== 'inactive') media.stop()
      for (const track of media.stream.getTracks()) track.stop()
    },
    [],
  )

  // A visible elapsed counter, because a recording with no indication it is
  // running is how a consultation gets captured that nobody meant to capture.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [phase])

  const transcribeLocal = useCallback(
    async (blob: Blob) => {
      setError(null)
      setPhase('loading-model')
      setProgress(null)
      setChunkProgress(null)
      startedAt.current = null
      setRetryBlob(blob)
      const id = attempt.current
      // Armed before the decode: a malformed container can hang
      // `decodeAudioData` before any worker exists, and that wait is bounded
      // like every other one on this path.
      watchForStall()
      try {
        const audio = await toMono16k(blob)
        if (attempt.current !== id) return
        // Cleared here rather than at the top: a prewarm `error` delivered
        // during the decode must stay swallowed, or its banner would outlive
        // a successful run, which never calls `setError(null)` itself.
        prewarming.current = false
        const request: WorkerRequest = { type: 'transcribe', audio }
        ensureWorker().postMessage(request, [audio.buffer as ArrayBuffer])
      } catch (cause) {
        if (attempt.current !== id) return
        clearStall()
        setPhase('idle')
        setError(cause instanceof Error ? cause.message : 'Could not read that audio.')
      }
    },
    [clearStall, ensureWorker, watchForStall],
  )

  /**
   * The hosted path: upload the recording to the relay and wait (issue #155).
   *
   * No decode and no worker. The blob goes up in the container the recorder
   * produced it in, because the relay forwards bytes rather than interpreting
   * them, and resampling here would cost a minute of CPU to hand the provider
   * something it did not ask for.
   *
   * Every failure lands on one message. The `attempt` guard is what separates a
   * cancel from a failure: `abort` bumps it before aborting the controller, so
   * a cancelled upload returns before it can raise a banner, while the 180 s
   * bound aborts without bumping and is reported.
   */
  /**
   * The labelling pass that follows a successful relay (#189). It sends only
   * text the relay just returned, so nothing new leaves the device; the API
   * de-identifies it before its model sees it. Never throws: every failure,
   * the timeout included, resolves to null and the caller delivers the
   * unlabelled prose it already holds. A cancel is the one exception, and the
   * caller's attempt guard is what separates it.
   *
   * The controller takes the `upload` slot, so Cancel and unmount abort a
   * labelling request exactly as they abort the upload before it.
   */
  const labelHostedTurns = useCallback(
    async (transcribed: string): Promise<readonly DraftTurn[] | null> => {
      if (transcribed.trim() === '' || transcribed.length > MAX_DRAFT_TEXT_CHARACTERS) return null
      setPhase('labelling')
      const controller = new AbortController()
      upload.current = controller
      const bound = window.setTimeout(() => controller.abort(), LABEL_TIMEOUT_MS)
      try {
        return await api.draftHostedTurns(transcribed, controller.signal)
      } catch {
        return null
      } finally {
        window.clearTimeout(bound)
        if (upload.current === controller) upload.current = null
      }
    },
    [],
  )

  const transcribeHosted = useCallback(
    async (blob: Blob) => {
      setError(null)
      setPhase('uploading')
      setProgress(null)
      setChunkProgress(null)
      startedAt.current = null
      setRetryBlob(blob)

      const id = attempt.current
      const controller = new AbortController()
      upload.current = controller
      const bound = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

      let result: HostedAsrResult
      try {
        result = await api.transcribeHostedAsr(blob, controller.signal)
      } catch {
        if (attempt.current !== id) return
        setPhase('idle')
        setError(HOSTED_FAILED_ERROR)
        return
      } finally {
        window.clearTimeout(bound)
        // Only if it is still ours: a later run may already have installed its
        // own controller, and clearing that one would strand its Cancel.
        if (upload.current === controller) upload.current = null
      }
      if (attempt.current !== id) return

      // Labels are a bonus on top of a transcription already in hand, so a
      // labelling failure delivers the raw text with no banner and no Try
      // Again: retrying would re-upload audio the relay already billed for.
      const draftTurns = await labelHostedTurns(result.text)
      if (attempt.current !== id) return
      setPhase('idle')
      setRetryBlob(null)
      onTranscriptRef.current({
        text: result.text,
        segments: result.segments,
        source: 'asr_hosted',
        ...(draftTurns && draftTurns.length > 0 ? { draftTurns } : {}),
      })
    },
    [labelHostedTurns],
  )

  /**
   * The single fork every audio source goes through: the Stop button, the file
   * picker and Try Again all land here, so all three honour the tick the
   * checkbox currently shows and none of them can drift apart.
   */
  const transcribe = useCallback(
    (blob: Blob) => (hostedRef.current ? transcribeHosted(blob) : transcribeLocal(blob)),
    [transcribeHosted, transcribeLocal],
  )

  const start = useCallback(async () => {
    setError(null)
    // A stale blob must not survive into a fresh microphone run: a refused
    // microphone would otherwise offer Try Again on the previous recording.
    setRetryBlob(null)
    try {
      /*
       * Dictation constraints, not the defaults: the browser's voice-call DSP
       * attenuates exactly the low-energy consonant bursts that separate b/p
       * and d/t, the devoicing family docs/trd.md §20.3 measured on both ASR
       * arms ("patut" for "batuk"), and echo cancellation has no far end to
       * cancel here. Gain control stays on because two speakers sit at
       * different distances from one microphone, and a quiet track costs more
       * than gain pumping. Values are ideals per the mediacapture spec, never
       * OverconstrainedError; track.getSettings() reports what was actually
       * applied, which every TRD §20 measurement must record.
       */
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      const media = new MediaRecorder(stream)
      chunks.current = []
      media.ondataavailable = (event) => chunks.current.push(event.data)
      media.onstop = () => {
        // Released explicitly. A live microphone track outliving the recording
        // leaves the browser's recording indicator on, which in a consulting
        // room reads as "still listening".
        for (const track of stream.getTracks()) track.stop()
        void transcribe(new Blob(chunks.current, { type: media.mimeType }))
      }
      media.start()
      recorder.current = media
      setSeconds(0)
      setPhase('recording')
      if (hostedRef.current) {
        // Nothing local will run for this recording, so there is nothing to
        // warm. Any worker still warm from an earlier on-device run is
        // terminated rather than left holding roughly 250 MB of weights for a
        // path that will not use them (issue #155).
        worker.current?.terminate()
        worker.current = null
        return
      }
      // Prewarm: the model downloads and opens while the doctor is still
      // speaking, so the stop is answered by a warm session instead of a cold
      // load (issue #145). Last in the block, so a throwing recorder setup
      // never leaves a prewarm behind on a run that failed to start.
      prewarming.current = true
      const request: WorkerRequest = { type: 'load' }
      ensureWorker().postMessage(request)
    } catch {
      setError('Microphone access was refused, or no microphone is available.')
    }
  }, [ensureWorker, transcribe])

  const stop = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
  }, [])

  const busy =
    phase === 'loading-model' ||
    phase === 'transcribing' ||
    phase === 'finishing' ||
    phase === 'uploading' ||
    phase === 'labelling'

  /*
   * One line that always says what is actually happening, and a bar only when
   * there is a measured number behind it.
   *
   * The download half already had a real percentage. The transcribe half had
   * nothing but prose, which on a consultation-length recording meant several
   * minutes of a screen that could not be told apart from a hung one.
   */
  const percent =
    chunkProgress === null ? null : Math.round((chunkProgress.done / chunkProgress.total) * 100)

  const remaining =
    phase !== 'transcribing' || chunkProgress === null || startedAt.current === null
      ? null
      : estimateRemaining(chunkProgress.done, chunkProgress.total, Date.now() - startedAt.current)

  /*
   * Download-complete is not ready: the backend import and the ONNX session
   * open both happen after the last byte, and a bar claiming a finished
   * download through them is how a healthy load reads as a hang. So 100 gets
   * its own honest sentence, as does the merge tail after the last chunk.
   */
  const status =
    phase === 'uploading'
      ? // Says where the audio is going while it is going there, and does not
        // pretend to a percentage: the relay is one request with no progress
        // to report, and an invented bar here would be the exact dishonesty
        // the measured one below exists to avoid.
        'Sending this recording to ILMU for transcription. It is leaving this device.'
      : phase === 'labelling'
        ? // Progress-free for the same reason as the upload, and honest about
          // the wait and the review gate that follows it.
          'Drafting Doctor / Patient labels from the transcript. This can take up to two and a half minutes, and you will review every line before anything is applied.'
        : phase === 'loading-model'
          ? progress === null
            ? 'Preparing the speech model. The first run downloads it once and the browser caches it.'
            : progress >= 100
              ? 'Opening the speech model. On a first run this can take a couple of minutes.'
              : `Downloading the speech model, ${progress}%. This happens once.`
          : phase === 'finishing'
            ? 'Finishing up. Joining the transcribed chunks into one transcript.'
            : percent === null
              ? 'Transcribing on this device. Longer recordings take a few minutes.'
              : `Transcribing on this device, ${percent}%${remaining === null ? '' : `, ${remaining}`}.`

  const bar = phase === 'loading-model' ? progress : phase === 'finishing' ? 100 : percent

  /** The short phase headline the live region announces; sentences stay visual. */
  const headline =
    phase === 'uploading'
      ? 'Sending the recording to ILMU'
      : phase === 'labelling'
        ? 'Drafting speaker labels'
        : phase === 'loading-model'
          ? progress === null
            ? 'Preparing the speech model'
            : progress >= 100
              ? 'Opening the speech model'
              : 'Downloading the speech model'
          : phase === 'transcribing'
            ? 'Transcribing on this device'
            : phase === 'finishing'
              ? 'Finishing up'
              : ''

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Recording is transcribed on this device and not uploaded unless you choose hosted
        transcription below for this consultation. The result appears below as lines with guessed{' '}
        <code className="text-ink">Doctor</code> / <code className="text-ink">Patient</code> labels,
        drawn from what each sentence says, not from the voices. Check every line, then apply them
        to the transcript. On-device transcription is tuned for English and Manglish, and a
        consultation held mainly in Malay can come back rewritten in English rather than
        transcribed; for Malay-dominant consultations, the hosted option below may work better.
      </p>

      {thin && (
        <div className="flex items-start gap-2 rounded-card border border-line bg-sunken p-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-urgent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              This device may not have the memory to run the speech model, which needs roughly 250
              to 590&nbsp;MB of weights depending on how it runs, and holds them in memory. On a
              constrained machine the browser tab can be killed mid-consultation.
            </p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOverridden(true)}>
              Enable Recording Anyway
            </Button>
          </div>
        </div>
      )}

      {!thin && (
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'recording' ? (
            <Button onClick={stop}>
              <Square aria-hidden className="size-4" />
              Stop and Transcribe · {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </Button>
          ) : (
            <Button onClick={start} disabled={busy}>
              <Mic aria-hidden className="size-4" />
              Start Recording
            </Button>
          )}

          {/* An audio file takes the same on-device path. It is what makes the
              claim demonstrable to a reviewer on a machine with no microphone,
              and what makes it testable without one. */}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-control px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken">
            <FileAudio aria-hidden className="size-4" />
            Use an Audio File
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              disabled={busy || phase === 'recording'}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void transcribe(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {/* Mounted before it has anything to say: a live region inserted into
          the DOM already populated is not announced, so the container is
          permanent and only its text changes. It carries the short phase
          headline rather than the full sentence, so screen readers hear state
          changes, not every percentage tick. */}
      <span aria-live="polite" className="sr-only">
        {headline}
      </span>

      {busy && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              {/* `busy-spinner` exempts this from the blanket reduced-motion rule
                  in index.css. A spinner frozen mid-turn reads as hung, which is
                  the opposite of what it exists to say. */}
              <Loader2 aria-hidden className="busy-spinner size-4 animate-spin" />
              <span>{status}</span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => abort(null)}>
              Cancel
            </Button>
          </div>

          {/* A real bar, driven by measured chunk completions rather than by an
              animation, so its position means something. Width is a transition
              rather than an animation, which the reduced-motion rule leaves
              alone, so it still moves for everyone. */}
          {bar !== null && (
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-sunken"
              role="progressbar"
              aria-valuenow={bar}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Transcription progress"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${bar}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-emergency">
            {error}
          </p>
          {/* Only when there is audio to rerun. A consultation recording is
              unrecoverable, so a failed run keeps its blob rather than
              pointing the doctor at recording the consultation again. */}
          {retryBlob !== null && (
            <Button size="sm" variant="ghost" onClick={() => void transcribe(retryBlob)}>
              Try Again
            </Button>
          )}
        </div>
      )}

      {/*
        Findable, but never funnelled (docs/trd.md section 20).

        Always rendered, in the same muted styling, in the same place, whether
        the doctor arrived here fresh or after an on-device failure. It is not a
        button and carries no accent: a doctor who has just watched
        transcription fail must not find the cloud option newly highlighted in
        front of them, because a choice offered at the moment of frustration is
        not a freely given one. This is why the local failure copy above never
        mentions it.
      */}
      <div className="mt-1 flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">Transcription options.</span> By default this
          recording is transcribed on this device and the audio never leaves it. For this
          consultation only, you can instead send the recording to ILMU, a Malaysian transcription
          service built for Malaysian speech. The audio passes through our server in Singapore to
          ILMU and is processed in Malaysia. We have not agreed separate retention or training terms
          with ILMU, so their standard early-access terms apply. After transcription, the returned
          text is de-identified and sent to the note model to draft{' '}
          <code className="text-ink">Doctor</code> / <code className="text-ink">Patient</code>{' '}
          labels, which you review line by line before anything enters the transcript. This choice
          is optional, applies to this one consultation, and is recorded in the audit trail.
        </p>

        {/*
          Associated by id rather than by wrapping, because the disclosure below
          is a button: nested inside a `<label>`, every press of it would also
          toggle the consent it is trying to explain.
        */}
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={consentId}
            className="mt-0.5"
            checked={hosted}
            // Idle only. Flipping it mid-run would leave the fork the recording
            // already took disagreeing with what the box shows.
            disabled={phase !== 'idle'}
            onChange={(event) => setHosted(event.target.checked)}
          />
          <div className="min-w-0 flex-1">
            <label htmlFor={consentId} className="text-sm text-ink-muted">
              Send this consultation&apos;s recording to ILMU for transcription
            </label>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
              <code className="text-ink">ilmu-asr-v4.2</code>
              <InfoTip label="About hosted transcription with ILMU">
                An early-access service. On our scripted Malay consultation it kept code-switched
                sentences intact, but sometimes hardened the first consonant of a Malay clinical
                word, hearing batuk as patut and demam as teman, so check those words when you
                review the draft (TRD 20.3). The recording travels from this browser, to our server
                in Singapore, to ILMU in Malaysia. Retention and training follow ILMU&apos;s
                standard early-access terms, which we have not varied by agreement. Handled under
                the PDPA as amended in 2024, under which voice is biometric data and therefore
                sensitive personal data requiring explicit consent.
              </InfoTip>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
