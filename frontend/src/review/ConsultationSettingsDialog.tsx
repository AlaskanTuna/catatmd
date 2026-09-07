import type { CaptureMode, NoteTemplate } from '@shared/types'
import { Mic, Radio, X } from 'lucide-react'
import { type Ref, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { NoteTemplateSelector } from './NoteTemplateSelector.js'

export type ConsultationSettingsPatch = {
  noteTemplate?: NoteTemplate
  captureMode?: CaptureMode
}

const CAPTURE_MODES: ReadonlyArray<{
  value: CaptureMode
  label: string
  detail: string
  Icon: typeof Mic
}> = [
  {
    value: 'ambient',
    label: 'Ambient',
    detail: 'Streams the consultation as it happens.',
    Icon: Radio,
  },
  {
    value: 'manual',
    label: 'Press To Record',
    detail: 'Records one controlled pass at a time.',
    Icon: Mic,
  },
]

export function ConsultationSettingsDialog({
  ref,
  noteTemplate,
  captureMode,
  captureModeLocked,
  saving,
  error,
  onSave,
}: {
  ref: Ref<HTMLDialogElement>
  noteTemplate: NoteTemplate
  captureMode: CaptureMode
  captureModeLocked: boolean
  saving: boolean
  error: string | null
  onSave: (changes: ConsultationSettingsPatch) => void
}) {
  const self = useRef<HTMLDialogElement>(null)
  const [draftTemplate, setDraftTemplate] = useState(noteTemplate)
  const [draftCaptureMode, setDraftCaptureMode] = useState(captureMode)

  const changes = useMemo<ConsultationSettingsPatch>(
    () => ({
      ...(draftTemplate === noteTemplate ? {} : { noteTemplate: draftTemplate }),
      ...(captureModeLocked || draftCaptureMode === captureMode
        ? {}
        : { captureMode: draftCaptureMode }),
    }),
    [captureMode, captureModeLocked, draftCaptureMode, draftTemplate, noteTemplate],
  )
  const unchanged = Object.keys(changes).length === 0

  const reset = () => {
    setDraftTemplate(noteTemplate)
    setDraftCaptureMode(captureMode)
  }

  const close = () => {
    reset()
    self.current?.close()
  }

  return (
    <dialog
      ref={(node) => {
        self.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: HTMLDialogElement | null }).current = node
      }}
      data-print="hide"
      aria-labelledby="consultation-settings-title"
      onClose={reset}
      className="glass-panel m-auto w-[32rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="consultation-settings-title" className="font-display text-lg font-semibold">
              Consultation Settings
            </h2>
            <p className="mt-0.5 text-ink-muted text-xs">Applies only to this consultation.</p>
          </div>
          <button
            type="button"
            aria-label="Close Consultation Settings"
            onClick={close}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-sunken-soft text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <NoteTemplateSelector
          value={draftTemplate}
          saving={saving}
          onChange={setDraftTemplate}
          className="mt-6 mb-0"
          legend="Clinical Note Layout"
        />

        <fieldset className="mt-6" disabled={captureModeLocked || saving}>
          <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
            Capture Mode
          </legend>
          <div role="radiogroup" aria-label="Capture Mode" className="grid grid-cols-2 gap-2">
            {CAPTURE_MODES.map(({ value, label, detail, Icon }) => {
              const selected = draftCaptureMode === value
              return (
                <label
                  key={value}
                  className={cn(
                    'rounded-control border p-3 transition-colors',
                    captureModeLocked || saving
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer',
                    selected
                      ? 'border-accent/30 bg-accent-soft text-accent'
                      : 'border-line bg-surface text-ink hover:bg-sunken-soft',
                  )}
                >
                  <input
                    type="radio"
                    name="capture-mode"
                    value={value}
                    aria-label={label}
                    checked={selected}
                    disabled={captureModeLocked || saving}
                    onChange={() => setDraftCaptureMode(value)}
                    className="sr-only"
                  />
                  <Icon aria-hidden className="size-4" />
                  <span className="mt-1.5 block font-semibold text-sm">{label}</span>
                  <span className="block text-ink-muted text-xs">{detail}</span>
                </label>
              )
            })}
          </div>
          <p className="mt-2.5 text-ink-muted text-xs">
            {captureModeLocked
              ? 'Capture Mode is locked once a transcript exists.'
              : 'Choose how audio is captured before this consultation has a transcript.'}
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 text-sm text-emergency">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2 border-line border-t pt-4">
          <Button variant="neutral" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={unchanged}
            onClick={() => onSave(changes)}
          >
            Save Settings
          </Button>
        </div>
      </div>
    </dialog>
  )
}
