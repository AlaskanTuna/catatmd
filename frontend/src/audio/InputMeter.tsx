import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

type MeterState = 'starting' | 'live' | 'denied'

/** Below this the meter reads as silence, in both renderings. */
const SILENCE = 0.06

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
 *
 * `variant="wave"` draws the same reading as an icon-sized wave with no words,
 * for a header that has no room for a sentence. Its state moves into the
 * accessible name rather than disappearing.
 */
export function InputMeter({
  constraints,
  stream: provided,
  className,
  variant = 'bar',
}: {
  constraints?: MediaTrackConstraints
  stream?: MediaStream
  className?: string
  variant?: 'bar' | 'wave'
}) {
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<MeterState>('starting')

  useEffect(() => {
    let owned: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    async function listen() {
      try {
        const source =
          provided ?? (await navigator.mediaDevices.getUserMedia({ audio: constraints }))
        // Only a stream this component opened is a stream this component may
        // stop. A provided one outlives the meter by design.
        if (!provided) owned = source
        if (cancelled) {
          // Granted after the cleanup ran, so nothing else will ever stop it.
          for (const track of owned?.getTracks() ?? []) track.stop()
          return
        }
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

  if (variant === 'wave') return <LevelWave level={level} state={state} className={className} />

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
        {state === 'live' && (level > SILENCE ? 'Hearing you now' : 'Silent')}
        {state === 'starting' && 'Checking the microphone'}
        {state === 'denied' && 'No microphone access'}
      </span>
    </div>
  )
}

/**
 * Centre-out: the middle bar is the level now and each step outward is the
 * level a moment earlier, so speech ripples from the middle. Every bar is
 * still a loudness reading and never the shape of the sound, which is the
 * distinction the bar above was rebuilt to keep.
 */
const WAVE = [
  { id: 'outer-left', weight: 0.55, lag: 2 },
  { id: 'inner-left', weight: 0.8, lag: 1 },
  { id: 'centre', weight: 1, lag: 0 },
  { id: 'inner-right', weight: 0.8, lag: 1 },
  { id: 'outer-right', weight: 0.55, lag: 2 },
] as const

const BAR_MIN = 3
const BAR_MAX = 16
const ECHO_MS = 90
/** The shape held wherever the wave cannot or should not move. */
const STILL = 0.7

/** The in-app preference wins over the OS in both directions, as `index.css` reads it. */
function prefersReducedMotion(): boolean {
  const chosen = document.documentElement.dataset.motion
  if (chosen === 'reduced') return true
  if (chosen === 'full') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function LevelWave({
  level,
  state,
  className,
}: {
  level: number
  state: MeterState
  className?: string
}) {
  const [reduced] = useState(prefersReducedMotion)
  const [echo, setEcho] = useState<readonly [number, number]>([0, 0])
  const latest = useRef(level)

  useEffect(() => {
    latest.current = level
  }, [level])

  useEffect(() => {
    if (state !== 'live' || reduced) return
    const timer = window.setInterval(() => setEcho(([near]) => [latest.current, near]), ECHO_MS)
    return () => window.clearInterval(timer)
  }, [state, reduced])

  const hearing = state === 'live' && level > SILENCE

  /*
   * Reduced motion keeps the state change and drops the movement: the wave
   * steps between flat and one still shape instead of following every frame.
   */
  const lift = (lag: 0 | 1 | 2): number => {
    if (state === 'denied') return STILL
    if (state === 'starting') return 0
    if (reduced) return hearing ? STILL : 0
    const sample = lag === 0 ? level : echo[lag - 1]
    return sample !== undefined && sample > SILENCE ? Math.min(1, Math.sqrt(sample)) : 0
  }

  const label = `Microphone level: ${
    state === 'live'
      ? hearing
        ? 'hearing you'
        : 'silent'
      : state === 'starting'
        ? 'checking'
        : 'not connected'
  }`

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('relative inline-flex h-4 shrink-0 items-center gap-0.5', className)}
    >
      {WAVE.map(({ id, weight, lag }) => (
        <span
          key={id}
          className={cn(
            'w-[3px] rounded-pill',
            state === 'live' ? 'bg-accent' : 'bg-ink-muted',
            state === 'denied' && 'opacity-35',
            !reduced && 'transition-[height] duration-100 ease-out',
          )}
          style={{ height: `${BAR_MIN + (BAR_MAX - BAR_MIN) * lift(lag) * weight}px` }}
        />
      ))}
      {/* Shape as well as colour, so "no microphone" never reads as a quiet
          room to someone who cannot tell the accent from the grey. */}
      {state === 'denied' && (
        <span
          data-strike
          className="absolute top-1/2 left-1/2 h-[1.5px] w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-pill bg-ink-muted"
        />
      )}
    </span>
  )
}
