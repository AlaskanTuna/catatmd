import type { MedicalRecordNote, NoteTemplate, SoapNote } from '@shared/types'
import { NOT_ESTABLISHED } from '@shared/types'

export const LEGACY_CATEGORY_UNAVAILABLE = 'Not recorded by this analysis version'

export interface MedicalRecordSection {
  key: keyof MedicalRecordNote
  label: string
  value: string
}

const SECTIONS: ReadonlyArray<readonly [keyof MedicalRecordNote, string]> = [
  ['presentingComplaint', 'Presenting Complaint'],
  ['historyOfPresentingComplaint', 'History of Presenting Complaint'],
  ['pastMedicalHistory', 'Past Medical History'],
  ['socialHistory', 'Social History'],
  ['familyHistory', 'Family History'],
  ['objective', 'Objective'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
]

const HISTORY_KEYS: ReadonlySet<keyof MedicalRecordNote> = new Set([
  'presentingComplaint',
  'historyOfPresentingComplaint',
  'pastMedicalHistory',
  'socialHistory',
  'familyHistory',
])

const displayValue = (value: string) => (value.trim().length === 0 ? NOT_ESTABLISHED : value)

export function medicalRecordSections(
  note: MedicalRecordNote | null,
  soapNote: SoapNote,
): MedicalRecordSection[] {
  return SECTIONS.map(([key, label]) => {
    if (note) return { key, label, value: displayValue(note[key]) }
    if (HISTORY_KEYS.has(key)) return { key, label, value: LEGACY_CATEGORY_UNAVAILABLE }
    return {
      key,
      label,
      value: displayValue(
        soapNote[key as keyof Pick<SoapNote, 'objective' | 'assessment' | 'plan'>],
      ),
    }
  })
}

export function formatNoteForClipboard(
  template: NoteTemplate,
  soapNote: SoapNote,
  medicalRecordNote: MedicalRecordNote | null,
): string {
  if (template === 'malaysian') {
    return medicalRecordSections(medicalRecordNote, soapNote)
      .map(({ label, value }) => `${label}\n${value}`)
      .join('\n\n')
  }

  const canonicalValue = (value: string) =>
    medicalRecordNote === null ? value : displayValue(value)

  return [
    `Subjective\n${soapNote.subjective}`,
    `Objective\n${canonicalValue(soapNote.objective)}`,
    `Assessment\n${canonicalValue(soapNote.assessment)}`,
    `Plan\n${canonicalValue(soapNote.plan)}`,
  ].join('\n\n')
}
