import {
  formatSoapSubjective,
  type MedicalRecordNote,
  NOT_ESTABLISHED,
  type NoteTemplate,
  type SoapNote,
} from '@shared/types'
import { useState } from 'react'
import { cn } from '../lib/cn.js'
import { LEGACY_CATEGORY_UNAVAILABLE, medicalRecordSections } from '../lib/note-templates.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

const HISTORY_SECTIONS = [
  { key: 'presentingComplaint', label: 'Presenting Complaint' },
  { key: 'historyOfPresentingComplaint', label: 'History of Presenting Complaint' },
  { key: 'pastMedicalHistory', label: 'Past Medical History' },
  { key: 'socialHistory', label: 'Social History' },
  { key: 'familyHistory', label: 'Family History' },
] as const satisfies ReadonlyArray<{ key: keyof MedicalRecordNote; label: string }>

const CLINICAL_SECTIONS = [
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
] as const satisfies ReadonlyArray<{ key: keyof MedicalRecordNote; label: string }>

const MALAYSIAN_SECTIONS = [...HISTORY_SECTIONS, ...CLINICAL_SECTIONS]

type HistoryKey = (typeof HISTORY_SECTIONS)[number]['key']
type EditTarget = keyof MedicalRecordNote | 'subjective'

function ProvenanceMarker({ edited }: { edited: boolean }) {
  return (
    <span
      data-provenance={edited ? 'edited' : 'ai'}
      className={cn(
        'rounded-full px-2 py-0.5 text-2xs font-medium',
        edited ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted',
      )}
    >
      {edited ? 'You Edited This' : 'AI Generated'}
    </span>
  )
}

const displayValue = (value: string) => (value.trim().length === 0 ? NOT_ESTABLISHED : value)

export function MedicalRecordNoteEditor({
  note,
  aiNote,
  template,
  readOnly,
  saving,
  onSave,
}: {
  note: MedicalRecordNote
  aiNote: MedicalRecordNote
  template: NoteTemplate
  readOnly: boolean
  saving: boolean
  onSave: (edited: Partial<MedicalRecordNote>) => void
}) {
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState(note)

  const beginEdit = (target: EditTarget) => {
    setDraft(note)
    setEditing(target)
  }

  const updateDraft = (key: keyof MedicalRecordNote, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const saveSection = (key: keyof MedicalRecordNote) => {
    onSave({ [key]: draft[key] })
    setEditing(null)
  }

  const renderHeader = (label: string, target: EditTarget, edited: boolean) => (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</h3>
      <div className="flex items-center gap-2">
        <ProvenanceMarker edited={edited} />
        {!readOnly && editing !== target && (
          <Button
            size="sm"
            variant="neutral"
            data-print="hide"
            aria-label={`Edit ${label}`}
            onClick={() => beginEdit(target)}
          >
            Edit
          </Button>
        )}
      </div>
    </div>
  )

  const renderSingleSection = (key: keyof MedicalRecordNote, label: string) => {
    const edited = note[key] !== aiNote[key]
    const isEditing = editing === key

    return (
      <section key={key} className="p-4 page-break-avoid">
        {renderHeader(label, key, edited)}
        {isEditing ? (
          <div className="mt-2" data-print="hide">
            <label htmlFor={`medical-record-${key}`} className="sr-only">
              {label}
            </label>
            <textarea
              id={`medical-record-${key}`}
              value={draft[key]}
              onChange={(event) => updateDraft(key, event.target.value)}
              rows={5}
              className="w-full rounded-control border border-line bg-surface p-3 text-sm leading-relaxed focus:border-accent"
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                aria-label={`Save ${label}`}
                onClick={() => saveSection(key)}
              >
                Save
              </Button>
              <Button size="sm" variant="neutral" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p
            data-provenance={edited ? 'edited' : 'ai'}
            className="mt-2 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-ink"
          >
            {displayValue(note[key])}
          </p>
        )}
      </section>
    )
  }

  if (template === 'malaysian') {
    return (
      <Card className="divide-y divide-line">
        {MALAYSIAN_SECTIONS.map(({ key, label }) => renderSingleSection(key, label))}
      </Card>
    )
  }

  const subjectiveEdited = HISTORY_SECTIONS.some(({ key }) => note[key] !== aiNote[key])
  const editingSubjective = editing === 'subjective'

  return (
    <Card className="divide-y divide-line">
      <section className="p-4 page-break-avoid">
        {renderHeader('Subjective', 'subjective', subjectiveEdited)}
        {editingSubjective ? (
          <div className="mt-3 space-y-3" data-print="hide">
            {HISTORY_SECTIONS.map(({ key, label }) => (
              <div key={key}>
                <label
                  htmlFor={`medical-record-${key}`}
                  className="mb-1 block text-xs font-medium text-ink-muted"
                >
                  {label}
                </label>
                <textarea
                  id={`medical-record-${key}`}
                  value={draft[key]}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  rows={3}
                  className="w-full rounded-control border border-line bg-surface p-3 text-sm leading-relaxed focus:border-accent"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                aria-label="Save Subjective"
                onClick={() => {
                  onSave(
                    Object.fromEntries(
                      HISTORY_SECTIONS.map(({ key }) => [key, draft[key]]),
                    ) as Pick<MedicalRecordNote, HistoryKey>,
                  )
                  setEditing(null)
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="neutral" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p
            data-provenance={subjectiveEdited ? 'edited' : 'ai'}
            className="mt-2 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-ink"
          >
            {formatSoapSubjective(note)}
          </p>
        )}
      </section>
      {CLINICAL_SECTIONS.map(({ key, label }) => renderSingleSection(key, label))}
    </Card>
  )
}

export function LegacyMedicalRecordView({ note, aiNote }: { note: SoapNote; aiNote: SoapNote }) {
  return (
    <Card className="divide-y divide-line">
      {medicalRecordSections(null, note).map(({ key, label, value }) => {
        const unavailable = value === LEGACY_CATEGORY_UNAVAILABLE
        const edited =
          !unavailable &&
          (key === 'objective' || key === 'assessment' || key === 'plan') &&
          note[key] !== aiNote[key]

        return (
          <section key={key} className="p-4 page-break-avoid">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {label}
              </h3>
              {unavailable ? (
                <span className="rounded-full bg-sunken px-2 py-0.5 text-2xs font-medium text-ink-muted">
                  Older Analysis
                </span>
              ) : (
                <ProvenanceMarker edited={edited} />
              )}
            </div>
            <p className="mt-2 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {value}
            </p>
          </section>
        )
      })}
    </Card>
  )
}
