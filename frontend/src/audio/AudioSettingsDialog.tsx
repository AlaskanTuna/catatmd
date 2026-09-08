import { Cpu, Radio, Server } from 'lucide-react'
import { type Ref, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { InfoTip } from '../ui/InfoTip.js'
import { Select } from '../ui/Select.js'
import {
  type AudioSettings,
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
    detail:
      'Runs in this browser on the GPU where one is available, and falls back to the CPU where it is not. The model weights are downloaded once from a public CDN and then cached; that request carries no audio, no transcript and no identifier, because it happens before any of them exist. Tuned for English and Manglish. A consultation held mainly in Malay can come back rewritten in English rather than transcribed, which is the case the other option exists for.',
  },
  {
    id: 'hosted',
    name: 'ILMU (Malaysia) · ilmu-asr-v4.2',
    Icon: Server,
    detail:
      'The audio leaves this device. An early-access service: on our scripted Malay consultation it kept code-switched sentences intact, but sometimes hardened the first consonant of a Malay clinical word, hearing batuk as patut and demam as teman, so check those words when you review the draft. We have not agreed separate retention or training terms with ILMU, so their standard early-access terms apply. The returned text is de-identified before the note model drafts the Doctor and Patient labels, which are applied unreviewed and marked as such so the red-flag engine will not trust them, and your choice is recorded in the audit trail. Handled under the PDPA as amended in 2024, under which voice is biometric data and therefore sensitive personal data requiring explicit consent.',
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
          <legend className="mb-2 font-semibold text-xs">Transcription Engine</legend>
          <div className="grid gap-2">
            {/*
              First, and not a control. Ambient streams to Soniox whatever is
              picked below, so this states what is running rather than offering
              a choice: no button, no `aria-pressed`, nothing to press that
              would do nothing.

              Bordered as well as tinted, which the selected card below is not.
              Both are green and they mean different things, so the fill alone
              read as two live engines: this one is running, and that one is the
              press-to-record choice for when it is not. `border-accent/30` on
              `accent-soft` is the same emphasis `ApproveBar` uses.

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
                    selected ? 'border-transparent bg-accent-soft' : 'border-line',
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
