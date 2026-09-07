import { type DraftTurn, type HostedAsrResult, MAX_DRAFT_TEXT_CHARACTERS } from '@shared/types'
import { AlertTriangle, FileAudio, Loader2, Mic, Pause, Play, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { InfoTip } from '../ui/InfoTip.js'
import { ConsentGate } from './ConsentGate.js'
import { InputMeter } from './InputMeter.js'
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
 * labels. That is turn segmentation from timing and punctuation, not
 * diarisation: no voice model runs, and the labels are guesses. The doctor no
 * longer confirms them line by line (#233); `labelsReviewed` travels false
 * instead, so the red-flag engine will not trust a label nobody stood behind.
 *
 * **By default no audio byte reaches the API.** Capture, decode and inference
 * all happen here and in the worker. The only thing that crosses the network is
 * the model download from the HuggingFace CDN, and the text the doctor chooses
 * to submit.
 *
 * **The one exception is the hosted engine, and it takes two keys** (issue
 * #155, split in two by #228 and #254). The Audio dialog holds a standing
 * device preference naming where audio goes; `ConsentGate` below holds a
 * per-consultation tick naming whether this patient's audio may be sent. Only
 * with both does a recording go to the relay in `POST /api/asr/transcriptions`
 * and on to ILMU. The returned text then goes to `POST /api/asr/draft-turns`,
 * where the API de-identifies it and the note model drafts the per-line speaker
 * labels; a labelling failure of any kind falls back to the unlabelled prose
 * (#189).
 *
 * On-device stays the default and the floor: nothing switches the doctor to
 * hosted, and an on-device failure degrades to typing or pasting, never to the
 * cloud (docs/trd.md section 20).
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
  | 'paused'
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
 * What the doctor is told when a hosted recording finishes with no agreement
 * in force (issue #254).
 *
 * Reachable one way only: the engine was on-device when the recording started
 * and was switched to hosted in the Audio dialog before it stopped, so the
 * gate was never on screen to tick. Nothing is sent and nothing is lost, and
 * Try Again carries the same recording once the patient has agreed.
 */
const NOT_AGREED_ERROR =
  'The recording is still on this device and was not sent, because this patient has not agreed to hosted transcription. Agree above and try again, or transcribe on this device instead.'

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

export function AudioCapture({
  onTranscript,
  onBusyChange,
  engine,
  transcript,
}: {
  onTranscript: (result: {
    text: string
    segments: readonly TranscriptSegment[]
    source: 'asr_local' | 'asr_hosted'
    /** Server-drafted labels, hosted path only; absent whenever labelling failed. */
    draftTurns?: readonly DraftTurn[]
  }) => void
  onBusyChange?: (busy: boolean) => void
  /** The device's standing transcription engine, from the Audio dialog. */
  engine: 'local' | 'hosted'
  /** The transcript so far, shown under the meter while recording. */
  transcript: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null)
  /**
   * Seconds spent in the current hosted phase.
   *
   * The relay and the labelling pass are each one request with no progress to
   * report, so neither can honestly show a percentage. That left both phases as
   * a static sentence for twenty seconds or more, which is indistinguishable
   * from a hung screen and was read as one.
   *
   * Elapsed time is the honest alternative: a measured number that proves the
   * run is alive without claiming any fraction of it is done.
   */
  const [hostedSeconds, setHostedSeconds] = useState(0)
  /** The audio behind the current or failed run, so Try Again can rerun it. */
  const [retryBlob, setRetryBlob] = useState<Blob | null>(null)

  useEffect(() => onBusyChange?.(phase !== 'idle'), [onBusyChange, phase])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  /**
   * Whether this patient has agreed to this recording being sent to ILMU.
   *
   * **Plain `useState` on purpose (issue #254).** No `localStorage`, no
   * context, no query cache: consent is given for one consultation and is not
   * transferable to the next patient, so it has to die when this component
   * unmounts. That is the half #228 removed by folding the whole choice into
   * the device preference, which is remembered and therefore cannot ask.
   */
  const [agreed, setAgreed] = useState(false)
  /**
   * The hosted engine, as a ref.
   *
   * The standing engine preference from the Audio dialog, passed in as a prop.
   * The ref exists because `media.onstop` is assigned once per recording and
   * would otherwise fork on whatever the prop read when the recording started.
   */
  const hostedRef = useRef(engine === 'hosted')
  hostedRef.current = engine === 'hosted'
  /**
   * The agreement, as a ref, for exactly the reason above: the dispatcher runs
   * from `media.onstop` and must read the tick as it stands when the recording
   * ends, not as it stood when the recording began.
   */
  const agreedRef = useRef(agreed)
  agreedRef.current = agreed

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
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  /** The in-flight hosted upload, so Cancel and unmount can both abandon it. */
  const upload = useRef<AbortController | null>(null)

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
   * none of that risk and the gate does not apply to it. Choosing hosted
   * therefore reveals the record controls on a floor-gated device without
   * touching `overridden`.
   */
  const thin = belowHardwareFloor() && !overridden && engine !== 'hosted'

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

  // Restarts per phase, so the labelling pass counts from zero rather than
  // carrying the upload's total forward and reading as one long stall.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'labelling') return
    setHostedSeconds(0)
    const id = window.setInterval(() => setHostedSeconds((value) => value + 1), 1000)
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
   *
   * **The tick is enforced here, not only on the controls.** Disabling Start
   * and the file picker cannot close the whole hole, because the engine can
   * change after a recording begins: a run legitimately started on the
   * on-device path becomes a hosted one the moment the Audio dialog is saved
   * mid-recording, and the button that started it was never disabled. This is
   * the last point before egress, so it is the one place the invariant can be
   * stated once. Refusing keeps the blob, so nothing is lost and Try Again
   * sends it once the patient has agreed.
   *
   * It refuses rather than quietly running the local worker. Silently
   * switching paths is what the failure copy above already forbids in both
   * directions, and a doctor who chose hosted for a Malay-dominant
   * consultation would get a worse transcript and no word that it happened.
   */
  const transcribe = useCallback(
    (blob: Blob) => {
      if (hostedRef.current && !agreedRef.current) {
        setPhase('idle')
        setRetryBlob(blob)
        setError(NOT_AGREED_ERROR)
        return
      }
      return hostedRef.current ? transcribeHosted(blob) : transcribeLocal(blob)
    },
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
        // Dropped as the tracks stop, so the meter unmounts with the recording
        // rather than holding a reference to ended tracks.
        setLiveStream(null)
        void transcribe(new Blob(chunks.current, { type: media.mimeType }))
      }
      media.start()
      recorder.current = media
      setLiveStream(stream)
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

  const pause = useCallback(() => {
    const media = recorder.current
    if (!media || media.state !== 'recording') return
    media.pause()
    setPhase('paused')
  }, [])

  const resume = useCallback(() => {
    const media = recorder.current
    if (!media || media.state !== 'paused') return
    media.resume()
    setPhase('recording')
  }, [])

  const busy =
    phase === 'loading-model' ||
    phase === 'transcribing' ||
    phase === 'finishing' ||
    phase === 'uploading' ||
    phase === 'labelling'

  /**
   * Hosted with no agreement in force (issue #254).
   *
   * Blocks the two controls whose only destination is the relay, so the
   * refusal in the dispatcher is a backstop rather than the doctor's first
   * encounter with the rule. Stop is deliberately never blocked: a recording
   * already running must always be stoppable, and what it produces is
   * withheld rather than the recording being trapped.
   */
  const blocked = engine === 'hosted' && !agreed

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
  const elapsed = `${Math.floor(hostedSeconds / 60)}:${String(hostedSeconds % 60).padStart(2, '0')}`

  const status =
    phase === 'uploading'
      ? // Says where the audio is going while it is going there, and does not
        // pretend to a percentage: the relay is one request with no progress
        // to report, and an invented bar here would be the exact dishonesty
        // the measured one below exists to avoid. The elapsed count is the
        // honest substitute, and it is what distinguishes a slow relay from a
        // hung screen.
        `Sending to ILMU · ${elapsed}`
      : phase === 'labelling'
        ? // Progress-free for the same reason as the upload, and honest about
          // the wait and the review gate that follows it.
          `Drafting labels · ${elapsed} · up to 2½ min`
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
              : phase === 'paused'
                ? 'Recording paused'
                : ''

  return (
    <div className="flex flex-col gap-3">
      {/*
        Shown only before a recording. It sets the one expectation the controls
        cannot: speakers are labelled by the machine, so the transcript is worth
        a glance. Once recording starts it is a sentence the doctor has already
        acted on and reads as furniture.
      */}
      {phase === 'idle' && (
        <p className="flex items-start gap-1.5 text-sm text-ink-muted">
          <span>Speakers are labelled automatically, so check the transcript.</span>
          <InfoTip label="About the draft speaker labels" align="right" className="mt-0.5" layered>
            Speakers are guessed from what each sentence says and from segment timing, never from
            the voices: no voice model runs and no speaker identification happens anywhere in this
            product. Labels are applied as the transcript arrives; correct any of them by editing
            the transcript before you submit it.
          </InfoTip>
        </p>
      )}

      {thin && (
        <div className="flex items-start gap-2 rounded-card border border-line bg-sunken p-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-urgent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              This device may not have the memory to run the speech model, which needs roughly 250
              to 590&nbsp;MB of weights depending on how it runs, and holds them in memory. On a
              constrained machine the browser tab can be killed mid-consultation.
            </p>
            <Button
              size="sm"
              variant="neutral"
              className="mt-2"
              onClick={() => setOverridden(true)}
            >
              Enable Recording Anyway
            </Button>
          </div>
        </div>
      )}

      {/*
        Above the controls, not at the foot where docs/trd.md section 20.4
        first put it. A disabled button leaves the tab order, so at the foot a
        keyboard user reaches Start and the file picker only to have them
        skipped, and arrives at the one control that unlocks them last. Read
        the disclosure, agree, and the button lights up.

        Only on the hosted engine. The on-device path sends nothing, so there
        is nothing to agree to, and a tick offered there would put the cloud on
        a screen that otherwise never mentions it.
      */}
      {engine === 'hosted' && (
        <ConsentGate agreed={agreed} onAgreedChange={setAgreed} disabled={phase !== 'idle'} />
      )}

      {/* A grid, not a wrapping row. This card lives in a 380px column, so the
          pair always wrapped, and two content-width buttons stacked on top of
          each other gave the panel two ragged right edges. One column makes
          them equal width and aligns both edges at any width. */}
      {!thin && (
        <div className="grid gap-2">
          {phase === 'recording' || phase === 'paused' ? (
            /*
             * The recording state gets a panel rather than a changed button
             * label. While recording is the one moment the doctor is not
             * looking at the screen, so what it shows has to answer "is this
             * working" from across the room: that it is running, that the
             * microphone is hearing the room, and where the words will land.
             */
            <div className="grid gap-3 rounded-card border border-line bg-sunken p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {/* `animate-pulse` on a dot is the one loop that is honest
                      here: it reports that recording is running, which is
                      state this component owns, not that sound is arriving,
                      which only the meter below may claim. */}
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      phase === 'recording' ? 'animate-pulse bg-emergency' : 'bg-urgent',
                    )}
                  />
                  {phase === 'recording' ? 'Recording…' : 'Paused'}
                </p>
                <span className="font-mono text-sm text-ink-muted tabular-nums">
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </span>
              </div>

              {liveStream && <InputMeter stream={liveStream} />}

              {phase === 'paused' && (
                <p className="text-xs text-ink-muted">
                  Audio is not being added until recording resumes.
                </p>
              )}

              {/* Unlabelled: it is the only field in the panel, directly under
                  a heading that says Recording. The placeholder still says when
                  text arrives rather than implying it is arriving now, because
                  transcription runs on the finished recording. */}
              <div className="max-h-32 min-h-16 overflow-y-auto rounded-control border border-line bg-surface p-2 text-xs leading-relaxed">
                {transcript ? (
                  <span className="whitespace-pre-wrap">{transcript}</span>
                ) : (
                  <span className="text-ink-muted">Text appears when you stop.</span>
                )}
              </div>

              <Button
                className="w-full justify-center"
                variant="neutral"
                onClick={phase === 'paused' ? resume : pause}
              >
                {phase === 'paused' ? (
                  <Play aria-hidden className="size-4" />
                ) : (
                  <Pause aria-hidden className="size-4" />
                )}
                {phase === 'paused' ? 'Resume Recording' : 'Pause Recording'}
              </Button>

              <Button className="w-full justify-center" onClick={stop}>
                <Square aria-hidden className="size-4" />
                Stop and Transcribe
              </Button>
            </div>
          ) : (
            <Button className="w-full justify-center" onClick={start} disabled={busy || blocked}>
              <Mic aria-hidden className="size-4" />
              Start Recording
            </Button>
          )}

          {/* An audio file takes the same on-device path. It is what makes the
              claim demonstrable to a reviewer on a machine with no microphone,
              and what makes it testable without one. */}
          {/*
            Styled as the `neutral` button it has always behaved like. It was
            the last ghost-styled control in the app: a file input with no
            background, sitting directly beside a filled Start Recording and
            presented as its peer. The height matches `SIZES.md` so the pair
            aligns.
          */}
          {/* Hidden while recording, where it is disabled anyway: a control
              that cannot be used is a word the doctor still has to read. */}
          {phase !== 'recording' && phase !== 'paused' && (
            <label
              className={cn(
                'inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line bg-sunken-soft px-4 text-sm font-medium text-ink shadow-raised transition-colors',
                busy || blocked
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-sunken',
              )}
            >
              <FileAudio aria-hidden className="size-4" />
              Use an Audio File
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                disabled={busy || blocked}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void transcribe(file)
                  event.target.value = ''
                }}
              />
            </label>
          )}
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
            <Button size="sm" variant="neutral" onClick={() => abort(null)}>
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
            <Button
              size="sm"
              variant="neutral"
              disabled={blocked}
              onClick={() => void transcribe(retryBlob)}
            >
              Try Again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
