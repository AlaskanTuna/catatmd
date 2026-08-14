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
  const decoded = await decoder.decodeAudioData(bytes)
  await decoder.close()

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

type Phase = 'idle' | 'recording' | 'loading-model' | 'transcribing'

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

  /** When the current transcription started, for the remaining-time estimate. */
  const startedAt = useRef<number | null>(null)

  const worker = useRef<Worker | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

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

  const ensureWorker = useCallback(() => {
    if (worker.current) return worker.current
    const instance = new Worker(new URL('./transcribe.worker.js', import.meta.url), {
      type: 'module',
    })
    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        setProgress(Math.round((message.loaded / message.total) * 100))
        setPhase('loading-model')
      }
      if (message.type === 'ready') {
        setProgress(null)
        setPhase('transcribing')
        startedAt.current = Date.now()
      }
      if (message.type === 'transcribing') {
        setChunkProgress({ done: message.done, total: message.total })
      }
      if (message.type === 'result') {
        setPhase('idle')
        setProgress(null)
        setChunkProgress(null)
        startedAt.current = null
        onTranscriptRef.current({ text: message.text, segments: message.segments })
      }
      if (message.type === 'error') {
        setPhase('idle')
        setProgress(null)
        setChunkProgress(null)
        startedAt.current = null
        setError(message.message)
      }
    }
    worker.current = instance
    return instance
  }, [])

  useEffect(() => () => worker.current?.terminate(), [])

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
      setChunkProgress(null)
      try {
        const audio = await toMono16k(blob)
        const request: WorkerRequest = { type: 'transcribe', audio }
        ensureWorker().postMessage(request, [audio.buffer as ArrayBuffer])
      } catch (cause) {
        setPhase('idle')
        setError(cause instanceof Error ? cause.message : 'Could not read that audio.')
      }
    },
    [ensureWorker],
  )

  const start = useCallback(async () => {
    setError(null)
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
    } catch {
      setError('Microphone access was refused, or no microphone is available.')
    }
  }, [transcribe])

  const stop = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
  }, [])

  const busy = phase === 'loading-model' || phase === 'transcribing'

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
    chunkProgress === null || startedAt.current === null
      ? null
      : estimateRemaining(chunkProgress.done, chunkProgress.total, Date.now() - startedAt.current)

  const status =
    phase === 'loading-model'
      ? progress === null
        ? 'Preparing the speech model. The first run downloads it once and the browser caches it.'
        : `Downloading the speech model, ${progress}%. This happens once.`
      : percent === null
        ? 'Transcribing on this device. Longer recordings take a few minutes.'
        : `Transcribing on this device, ${percent}%${remaining === null ? '' : `, ${remaining}`}.`

  const bar = phase === 'loading-model' ? progress : percent

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Recording is transcribed on this device and never uploaded. The result appears below as
        lines with guessed <code className="text-ink">Doctor</code> /{' '}
        <code className="text-ink">Patient</code> labels, drawn from pauses and question marks, not
        from the voices. Check every line, then apply them to the transcript.
      </p>

      {thin && (
        <div className="flex items-start gap-2 rounded-card border border-line bg-sunken p-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-urgent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              This device may not have the memory to run the speech model, which needs roughly
              250&nbsp;MB of weights and holds them in memory. On a constrained machine the browser
              tab can be killed mid-consultation.
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

      {busy && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            {/* `busy-spinner` exempts this from the blanket reduced-motion rule
                in index.css. A spinner frozen mid-turn reads as hung, which is
                the opposite of what it exists to say. */}
            <Loader2 aria-hidden className="busy-spinner size-4 animate-spin" />
            <span role="status">{status}</span>
          </p>

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
        <p role="alert" className="text-sm text-emergency">
          {error}
        </p>
      )}
    </div>
  )
}
