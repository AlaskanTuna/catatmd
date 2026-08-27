import { Mic, Radio } from 'lucide-react'
import { type Ref, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { InfoTip } from '../ui/InfoTip.js'
import {
  type AudioSettings,
  type CaptureMode,
  saveAudioSettings,
  toConstraints,
} from './audio-settings.js'

/**
 * How many bars the input meter draws. Enough to read as a level rather than as
 * a state, few enough that each one is wide enough to see.
 */
const BARS = 12

/**
 * A live input meter, driven by the actual stream.
 *
 * **It must never be decorative.** An animation on a loop would tell a doctor
 * the microphone is working while nothing is being captured, which is worse
 * than showing nothing at all: the whole reason this exists is to answer "is it
 * hearing me" before a consultation rather than after one is lost. So it reads
 * a real `AnalyserNode` and shows silence as silence.
 */
function InputMeter({ constraints }: { constraints: MediaTrackConstraints }) {
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'starting' | 'live' | 'denied'>('starting')

  useEffect(() => {
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    async function listen() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        if (cancelled) return
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(stream).connect(analyser)
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
      for (const track of stream?.getTracks() ?? []) track.stop()
      void context?.close()
    }
  }, [constraints])

  const lit = Math.round(level * BARS)

  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="flex h-4 items-end gap-[3px]" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => `bar-${i}`).map((id, i) => (
          <span
            key={id}
            className={cn(
              'w-[3px] rounded-full transition-colors duration-75',
              i < lit ? 'bg-accent' : 'bg-line',
            )}
            style={{ height: `${6 + i * 0.8}px` }}
          />
        ))}
      </div>
      <span className="text-xs text-ink-muted">
        {state === 'live' && (level > 0.06 ? 'Hearing you now' : 'Silent')}
        {state === 'starting' && 'Checking the microphone'}
        {state === 'denied' && 'No microphone access'}
      </span>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  detail: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm">{label}</span>
          <InfoTip label={`About ${label}`}>{detail}</InfoTip>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
          checked ? 'bg-accent' : 'bg-sunken-soft',
        )}
      >
        <span
          className={cn(
            'absolute top-1 size-4 rounded-full bg-surface transition-[left] duration-200',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

/**
 * Capture settings for this device.
 *
 * **Consent is deliberately absent from this dialog.** Ambient mode decides how
 * the microphone behaves; it never decides whether a patient is recorded. That
 * question is asked on the consultation screen, per patient, and is never
 * remembered — which is why the note below sits in visible copy rather than
 * behind a tip. A reader must not be able to leave here believing they have
 * agreed to anything on a patient's behalf.
 */
export function AudioSettingsDialog({
  ref,
  settings,
  onApply,
}: {
  ref: Ref<HTMLDialogElement>
  settings: AudioSettings
  onApply: (next: AudioSettings) => void
}) {
  const [draft, setDraft] = useState(settings)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const self = useRef<HTMLDialogElement>(null)

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]))
  }, [])

  const close = () => {
    self.current?.close()
    if (ref && typeof ref === 'object' && ref.current) ref.current.close()
  }

  return (
    <dialog
      ref={(node) => {
        self.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: HTMLDialogElement | null }).current = node
      }}
      data-print="hide"
      aria-labelledby="audio-title"
      className="glass-panel m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id="audio-title" className="font-display text-lg font-semibold">
          Audio
        </h2>
        <p className="mt-0.5 text-ink-muted text-xs">
          Applies to this device, for every consultation.
        </p>

        <fieldset className="mt-5">
          <legend className="mb-2 font-semibold text-xs">Capture Mode</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  id: 'ambient',
                  Icon: Radio,
                  name: 'Ambient',
                  line: 'Listens for the whole session.',
                },
                {
                  id: 'manual',
                  Icon: Mic,
                  name: 'Press To Record',
                  line: 'One consultation at a time.',
                },
              ] as const
            ).map(({ id, Icon, name, line }) => (
              <button
                key={id}
                type="button"
                aria-pressed={draft.mode === id}
                onClick={() => setDraft({ ...draft, mode: id as CaptureMode })}
                className={cn(
                  'rounded-control border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  draft.mode === id
                    ? 'border-transparent bg-accent-soft text-accent'
                    : 'border-line hover:bg-sunken-soft',
                )}
              >
                <Icon aria-hidden className="size-4" />
                <span className="mt-1.5 block font-semibold text-sm">{name}</span>
                <span className="block text-ink-muted text-xs">{line}</span>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-ink-muted text-xs">
            Either way, each patient is asked before anything is kept.
          </p>
        </fieldset>

        <div className="mt-5">
          <label htmlFor="mic-device" className="mb-2 block font-semibold text-xs">
            Microphone
          </label>
          <select
            id="mic-device"
            value={draft.deviceId ?? ''}
            onChange={(e) => setDraft({ ...draft, deviceId: e.target.value || null })}
            className="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm focus:border-accent focus-visible:outline-none"
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'Microphone'}
              </option>
            ))}
          </select>
          <InputMeter constraints={toConstraints(draft)} />
        </div>

        <fieldset className="mt-4">
          <legend className="mb-1 font-semibold text-xs">Noise Handling</legend>
          <Toggle
            checked={draft.suppressNoise}
            onChange={(next) => setDraft({ ...draft, suppressNoise: next })}
            label="Suppress Room Noise"
            detail="Filters steady background sound such as fans, air-conditioning and corridor noise. Turn it off if speech is being clipped at the start or end of sentences, which happens when the filter mistakes a quiet voice for background."
          />
          <Toggle
            checked={draft.boostQuietSpeech}
            onChange={(next) => setDraft({ ...draft, boostQuietSpeech: next })}
            label="Boost Quiet Speech"
            detail="Raises the input level automatically, for softly spoken or elderly patients. It lifts room noise along with the voice, so leave it off unless a patient is genuinely hard to hear."
          />
        </fieldset>

        <div className="mt-5 flex justify-end gap-2 border-line border-t pt-4">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              saveAudioSettings(draft)
              onApply(draft)
              close()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </dialog>
  )
}
