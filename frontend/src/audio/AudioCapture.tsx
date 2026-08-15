import { AlertTriangle, FileAudio, Loader2, Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button.js'
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
 * **No audio byte reaches the API.** Capture, decode and inference all happen
 * here and in the worker. The only thing that crosses the network is the model
 * download from the HuggingFace CDN, and the text the doctor chooses to submit.
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

type Phase = 'idle' | 'recording' | 'loading-model' | 'transcribing' | 'finishing'

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
}: {
  onTranscript: (result: { text: string; segments: readonly TranscriptSegment[] }) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null)
  /** The audio behind the current or failed run, so Try Again can rerun it. */
  const [retryBlob, setRetryBlob] = useState<Blob | null>(null)

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

  const thin = belowHardwareFloor() && !overridden

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
          onTranscriptRef.current({ text: message.text, segments: message.segments })
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

  const transcribe = useCallback(
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

  const start = useCallback(async () => {
    setError(null)
    // A stale blob must not survive into a fresh microphone run: a refused
    // microphone would otherwise offer Try Again on the previous recording.
    setRetryBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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

  const busy = phase === 'loading-model' || phase === 'transcribing' || phase === 'finishing'

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
    phase === 'loading-model'
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
    phase === 'loading-model'
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
        Recording is transcribed on this device and never uploaded. The result appears below as
        lines with guessed <code className="text-ink">Doctor</code> /{' '}
        <code className="text-ink">Patient</code> labels, drawn from what each sentence says, not
        from the voices. Check every line, then apply them to the transcript.
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
    </div>
  )
}
