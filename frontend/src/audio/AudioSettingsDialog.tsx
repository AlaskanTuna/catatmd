import { Cpu, Radio, Server } from 'lucide-react'
import { type Ref, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { InfoTip } from '../ui/InfoTip.js'
import { Select } from '../ui/Select.js'
import {
  type AudioSettings,
  type DictationEngine,
  saveAudioSettings,
  type TranscriptionEngine,
  toConstraints,
} from './audio-settings.js'
import { InputMeter } from './InputMeter.js'

/**
 * The two transcription engines, named the way the Record tab's picker named
 * them so the two screens cannot drift into different vocabularies. The
 * summaries state the real tradeoff in one line each; the elaboration sits
 * behind the tip.
 */
const ENGINES: {
  id: TranscriptionEngine
  name: string
  Icon: typeof Cpu
  detail: React.ReactNode
}[] = [
  {
    id: 'local',
    name: 'On this device (whisper-small · WebGPU)',
    Icon: Cpu,
    detail: 'Runs on this device. Audio is not uploaded.',
  },
  {
    id: 'hosted',
    name: 'ILMU (Malaysia) · ilmu-asr-v4.2',
    Icon: Server,
    detail: 'Sends audio to ILMU in Malaysia. Review the transcript carefully.',
  },
]

/**
 * Where a dictated prescription phrase is recognised (#357).
 *
 * **The region is deliberately not named here.** It comes from the API, and a
 * copy in this dialog would be a residency claim made by a component that
 * cannot see the socket. This dialog has shipped exactly that kind of outlived
 * claim once before, so the consent disclosure on the review page keeps the
 * job of saying where the audio goes, and the sentence below points at it.
 */
const DICTATION_ENGINES: {
  id: DictationEngine
  name: string
  Icon: typeof Cpu
  summary: string
  detail: React.ReactNode
}[] = [
  {
    id: 'local',
    name: 'On-device recognition (whisper-small)',
    Icon: Cpu,
    summary: 'The audio never leaves this device. Text appears when you stop speaking.',
    detail:
      'Runs the speech model in this browser. Nothing is uploaded, and a device without the memory for it falls back to typing.',
  },
  {
    id: 'streaming',
    name: 'Streaming recognition (Soniox)',
    Icon: Radio,
    summary: 'The audio leaves this device. Words appear as you speak them.',
    detail:
      'Streams from this browser straight to Soniox under a key our server issues; the server never receives the audio. Each patient is asked separately on the review page, and that agreement is never remembered.',
  },
]

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
          <InfoTip label={`About ${label}`} layered>
            {detail}
          </InfoTip>
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
 * Capture settings for this device, including which transcription engine
 * recordings use (a standing preference, on the owner's decision 2026-09-02).
 *
 * **Consent is deliberately absent from this dialog.** Everything here is
 * remembered for this device, and a remembered agreement is one the patient
 * after the consenting one never gave. Whether a given patient's audio may be
 * sent is asked on the Record tab, by `audio/ConsentGate.tsx`, and dies with
 * that screen. A reader must not be able to leave here believing they have
 * agreed to anything on a patient's behalf, which is why the note saying so
 * sits in visible copy rather than behind a tip.
 *
 * The engine choice is the half that belongs here: it names where the audio
 * goes rather than whether it may go, and the hosted option states that in its
 * own copy.
 *
 * **`ambient` is read, never written.** The mode is the consultation's, set in
 * the hero's Consultation Settings, and this dialog does not own it. It is
 * taken as a prop only so the list can say which engine is actually running:
 * the two options below are press-to-record's, and a doctor mid-ambient
 * consultation was otherwise reading "the audio never leaves this device" off a
 * card that governs nothing while the room was being streamed (#289). A
 * sentence under the list said so already and was not enough, because two live
 * looking cards outrank a muted line.
 */
export function AudioSettingsDialog({
  ref,
  settings,
  onApply,
  ambient,
}: {
  ref: Ref<HTMLDialogElement>
  settings: AudioSettings
  onApply: (next: AudioSettings) => void
  /** True while the Record tab is showing the ambient panel. */
  ambient: boolean
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

  return (
    <dialog
      ref={(node) => {
        self.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: HTMLDialogElement | null }).current = node
      }}
      data-print="hide"
      aria-labelledby="audio-title"
      onClose={() => setDraft(settings)}
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
          <legend className="mb-2 font-semibold text-xs">Transcription Engine</legend>
          <div className="grid gap-2">
            {/*
              First, and not a control. Ambient streams to Soniox whatever is
              picked below, so this states what is running rather than offering
              a choice: no button, no `aria-pressed`, nothing to press that
              would do nothing.

              While this row is showing, it is the only filled card in the list.
              A green fill here means one thing, that the engine is running, and
              the selected card below drops to an outline for as long as that is
              true: it is the press-to-record choice for when this stops, not a
              second live engine. Bordering this one and tinting both was tried
              first (#290) and was too quiet to carry the difference, because
              the fill is what the eye reads (#291).

              It names the provider but not the region or the model, which the
              ILMU option does name. Both come from `api.liveAsrConfig()`, which
              `AmbientCapture` holds; a second copy here would be a residency
              claim made by a component that cannot see the socket, and this
              dialog has already shipped a claim that outlived what it
              described. The Record tab's consent disclosure keeps that job, and
              the sentence below points at it.
            */}
            {ambient && (
              <div className="flex gap-2.5 rounded-card border border-accent/30 bg-accent-soft p-3 text-left">
                <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-sm">Soniox (streaming)</span>
                    <span className="rounded-pill bg-surface px-2 py-0.5 font-medium text-2xs text-accent">
                      In Use
                    </span>
                  </span>
                  <span className="mt-0.5 block text-ink-muted text-xs">
                    The audio leaves this device as it happens. Set by this consultation's Capture
                    Mode, and the Record tab names where it is processed.
                  </span>
                </div>
                <Radio aria-hidden className="mt-0.5 size-4 shrink-0" />
                {/* Holds the column the tips below occupy, so all three icons
                    line up rather than this one sitting 30px further out. */}
                <span aria-hidden className="size-5 shrink-0" />
              </div>
            )}
            {ENGINES.map((engine) => {
              const selected = draft.engine === engine.id
              return (
                <div
                  key={engine.id}
                  className={cn(
                    'flex gap-2.5 rounded-card border p-3 text-left transition-colors',
                    !selected && 'border-line',
                    selected && ambient && 'border-accent',
                    selected && !ambient && 'border-transparent bg-accent-soft',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft({ ...draft, engine: engine.id })}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none"
                  >
                    <span className="block font-semibold text-sm">{engine.name}</span>
                    <span className="mt-0.5 block text-ink-muted text-xs">
                      {engine.id === 'local'
                        ? 'The audio never leaves this device.'
                        : 'The audio leaves this device, processed in Malaysia. Better on Malay-dominant consultations.'}
                    </span>
                  </button>
                  <engine.Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <InfoTip label={`About ${engine.name} transcription`} align="right" layered>
                    {engine.detail}
                  </InfoTip>
                </div>
              )
            })}
          </div>
          {/* The claim and the control it describes must live or die together.
              This sentence outlived its control once already: the tick was
              removed in #228 and the copy stayed, so the dialog told the doctor
              each patient was asked while nothing asked. Pinned by a test that
              renders both. */}
          <p className="mt-2.5 text-ink-muted text-xs">
            Applies to Press To Record. Ambient capture always uses Soniox. Choosing ILMU does not
            send anything on its own. Each patient is asked on the Record tab, and that agreement is
            never remembered.
          </p>
        </fieldset>

        {/* A second section rather than a third option above, because that
            picker answers "where does a whole recording go" and this answers a
            different question about a different surface. Folding them together
            would make one control mean ILMU in Malaysia on the Record tab and
            Soniox in the United States on the review page. */}
        <fieldset className="mt-5">
          <legend className="mb-2 font-semibold text-xs">Prescription Dictation</legend>
          <div className="grid gap-2">
            {DICTATION_ENGINES.map((option) => {
              const selected = draft.dictationEngine === option.id
              return (
                <div
                  key={option.id}
                  className={cn(
                    'flex gap-2.5 rounded-card border p-3 text-left transition-colors',
                    selected ? 'border-transparent bg-accent-soft' : 'border-line',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft({ ...draft, dictationEngine: option.id })}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none"
                  >
                    <span className="block font-semibold text-sm">{option.name}</span>
                    <span className="mt-0.5 block text-ink-muted text-xs">{option.summary}</span>
                  </button>
                  <option.Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <InfoTip label={`About ${option.name}`} align="right" layered>
                    {option.detail}
                  </InfoTip>
                </div>
              )
            })}
          </div>
          {/* Same pairing rule as the sentence above, pinned in a different
              file. `AudioSettingsDialog.test.tsx` binds the Record tab's claim
              to the controls it can render; this claim's control lives on the
              review page, which needs an API mock that file does not carry, so
              `PrescriptionBlock.test.tsx` pins this half. The wording therefore
              deliberately avoids "each patient is asked": that phrase is
              asserted to appear exactly once here, and a second copy would make
              the first test pass for the wrong reason. */}
          <p className="mt-2.5 text-ink-muted text-xs">
            Applies to the microphone on the review page. Choosing streaming does not send anything
            on its own. The patient agrees there, for one consultation, and that agreement is never
            remembered.
          </p>
        </fieldset>

        <div className="mt-5">
          <label htmlFor="mic-device" className="mb-2 block font-semibold text-xs">
            Microphone
          </label>
          <Select
            label="Microphone"
            value={draft.deviceId ?? ''}
            options={[
              { value: '', label: 'System default' },
              ...devices.map((device) => ({
                value: device.deviceId,
                label: device.label || 'Microphone',
              })),
            ]}
            onChange={(value) => setDraft({ ...draft, deviceId: value || null })}
          />
          <InputMeter className="mt-2" constraints={toConstraints(draft)} />
        </div>

        <fieldset className="mt-4">
          <legend className="mb-1 font-semibold text-xs">Noise Handling</legend>
          <Toggle
            checked={draft.suppressNoise}
            onChange={(next) => setDraft({ ...draft, suppressNoise: next })}
            label="Suppress Room Noise"
            detail="Reduces steady background noise. Turn it off if quiet speech sounds clipped."
          />
          <Toggle
            checked={draft.boostQuietSpeech}
            onChange={(next) => setDraft({ ...draft, boostQuietSpeech: next })}
            label="Boost Quiet Speech"
            detail="Makes quiet speech louder. It may also amplify room noise."
          />
        </fieldset>

        <div className="mt-5 flex justify-end gap-2 border-line border-t pt-4">
          <Button onClick={() => self.current?.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              saveAudioSettings(draft)
              onApply(draft)
              self.current?.close()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </dialog>
  )
}
