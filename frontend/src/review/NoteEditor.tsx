import type { SoapNote } from '@shared/types'
import { useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

const SECTIONS: { key: keyof SoapNote; label: string }[] = [
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
]

/**
 * The note, with AI-generated and clinician-edited kept visually distinct
 * (#10, and it must survive into print).
 *
 * The distinction is drawn from comparing the doctor's copy against the AI's
 * original, which the API preserves byte-identical: `editedNote` is written,
 * `analysis.note` never is. That is what makes the label truthful rather than
 * a flag someone remembered to set.
 *
 * In print the marker becomes a dotted underline rather than a colour, because
 * clinic printers are monochrome and "which parts did the AI write" must not
 * depend on a colour cartridge.
 */
export function NoteEditor({
  note,
  aiNote,
  readOnly,
  saving,
  onSave,
}: {
  note: SoapNote
  aiNote: SoapNote
  readOnly: boolean
  saving: boolean
  onSave: (edited: Partial<SoapNote>) => void
}) {
  const [editing, setEditing] = useState<keyof SoapNote | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <Card className="divide-y divide-line">
      {SECTIONS.map(({ key, label }) => {
        const value = note[key]
        const edited = value !== aiNote[key]
        const isEditing = editing === key

        return (
          <section key={key} className="p-4 page-break-avoid">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {label}
              </h3>
              <div className="flex items-center gap-2">
                <span
                  data-provenance={edited ? 'edited' : 'ai'}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-2xs font-medium',
                    edited ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted',
                  )}
                >
                  {edited ? 'You Edited This' : 'AI Generated'}
                </span>
                {!readOnly && !isEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-print="hide"
                    onClick={() => {
                      setEditing(key)
                      setDraft(value)
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>

            {isEditing ? (
              <div className="mt-2" data-print="hide">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={5}
                  className="w-full rounded-control border border-line bg-surface p-3 text-sm leading-relaxed focus:border-accent"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    onClick={() => {
                      onSave({ [key]: draft })
                      setEditing(null)
                    }}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p
                data-provenance={edited ? 'edited' : 'ai'}
                className="mt-2 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-ink"
              >
                {value || (
                  <span className="text-ink-muted">
                    Blank. The assessment is cleared when it names a diagnosis, which this system
                    does not produce.
                  </span>
                )}
              </p>
            )}
          </section>
        )
      })}
    </Card>
  )
}
