import type { NoteTemplate } from '@shared/types'
import { cn } from '../lib/cn.js'

const OPTIONS: ReadonlyArray<{ value: NoteTemplate; label: string }> = [
  { value: 'soap', label: 'SOAP' },
  { value: 'malaysian', label: 'Malaysian Medical Record' },
]

export function NoteTemplateSelector({
  value,
  saving,
  onChange,
  className,
  legend = 'Note Format',
}: {
  value: NoteTemplate
  saving: boolean
  onChange: (template: NoteTemplate) => void
  className?: string
  legend?: string
}) {
  return (
    <fieldset className={cn('mb-3', className)} data-print="hide" disabled={saving}>
      <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
        {legend}
      </legend>
      <div
        role="radiogroup"
        aria-label="Clinical note template"
        aria-busy={saving || undefined}
        className="grid grid-cols-2 gap-1 rounded-control bg-sunken-soft p-1"
      >
        {OPTIONS.map((option) => {
          const selected = value === option.value

          return (
            <label key={option.value} className="cursor-pointer has-[:disabled]:cursor-not-allowed">
              <input
                type="radio"
                name="note-template"
                value={option.value}
                checked={selected}
                aria-checked={selected}
                disabled={saving}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span
                className={cn(
                  'flex min-h-9 items-center justify-center rounded-control px-3 text-center text-xs font-medium transition-colors',
                  selected
                    ? 'bg-surface text-accent shadow-raised'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                  saving && 'text-ink-muted opacity-70',
                )}
              >
                {option.label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
