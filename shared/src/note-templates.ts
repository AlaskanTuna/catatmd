import type { MedicalRecordNote, SoapNote } from './index.js'

export const NOT_ESTABLISHED = 'Not established'

const HISTORY_SECTIONS = [
  ['presentingComplaint', 'Presenting Complaint'],
  ['historyOfPresentingComplaint', 'History of Presenting Complaint'],
  ['pastMedicalHistory', 'Past Medical History'],
  ['socialHistory', 'Social History'],
  ['familyHistory', 'Family History'],
] as const satisfies ReadonlyArray<readonly [keyof MedicalRecordNote, string]>

const establishedOrFallback = (value: string) =>
  value.trim().length === 0 ? NOT_ESTABLISHED : value

export function formatSoapSubjective(note: MedicalRecordNote): string {
  return HISTORY_SECTIONS.map(
    ([key, label]) => `${label}\n${establishedOrFallback(note[key])}`,
  ).join('\n\n')
}

export function toSoapNote(note: MedicalRecordNote): SoapNote {
  return {
    subjective: formatSoapSubjective(note),
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan,
  }
}
