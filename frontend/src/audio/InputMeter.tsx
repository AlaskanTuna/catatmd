import { useEffect, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * A live input meter, driven by the actual stream.
 *
 * **It must never be decorative.** An animation on a loop would tell a doctor
 * the microphone is working while nothing is being captured, which is worse
 * than showing nothing at all: the whole reason this exists is to answer "is it
 * hearing me" before a consultation rather than after one is lost. So it reads
 * a real `AnalyserNode` and shows silence as silence.
 *
 * Two callers, and the difference between them is who owns the microphone:
 *
 * - **`constraints`** opens a stream of its own and stops it on unmount. This is
 *   the Audio dialog, checking a device before anything is recorded.
 * - **`stream`** attaches to one that is already open and never stops it. This
 *   is the recording panel, where the `MediaRecorder` owns the track and
 *   releasing it here would end the recording the meter is reporting on.
 *
 * Opening a second stream during a recording would be the obvious way to reuse
 * the first form and the wrong one: it takes a second handle on the same device
 * and, on the browsers that allow it at all, leaves a second recording
 * indicator lit in a consulting room.
 */
export function InputMeter({
  constraints,
  stream: provided,
  className,
}: {
  constraints?: MediaTrackConstraints
  stream?: MediaStream
  className?: string
}) {
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'starting' | 'live' | 'denied'>('starting')

  useEffect(() => {
    let owned: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    async function listen() {
      try {
        const source =
          provided ?? (await navigator.mediaDevices.getUserMedia({ audio: constraints }))
        if (cancelled) return
        // Only a stream this component opened is a stream this component may
        // stop. A provided one outlives the meter by design.
        if (!provided) owned = source
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(source).connect(analyser)
        const bins = new Uint8Array(analyser.frequencyBinCount)
        setState('live')

        const tick = () => {
          analyser.getByteTimeDomainData(bins)
          // Peak deviation from the 128 midpoint, which tracks loudness closely
          // enough for a "can you hear me" check and costs nothing per frame.
          let peak = 0
          for (const value of bins) peak = Math.max(peak, Math.abs(value - 128))
          setLevel(Math.min(1, peak / 90))
          frame = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        if (!cancelled) setState('denied')
      }
    }

    void listen()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      for (const track of owned?.getTracks() ?? []) track.stop()
      void context?.close()
    }
  }, [constraints, provided])

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* One horizontal bar, filled by the measured level. The twelve rising
          bars this replaced read as a waveform, and a waveform implies the
          shape of the sound rather than its loudness, which is not what the
          `AnalyserNode` behind it measures. A level meter says the one thing
          this control exists to answer. */}
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-75 ease-out"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-ink-muted">
        {state === 'live' && (level > 0.06 ? 'Hearing you now' : 'Silent')}
        {state === 'starting' && 'Checking the microphone'}
        {state === 'denied' && 'No microphone access'}
      </span>
    </div>
  )
}
