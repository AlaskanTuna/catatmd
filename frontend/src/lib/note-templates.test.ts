import type { MedicalRecordNote, SoapNote } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  formatNoteForClipboard,
  LEGACY_CATEGORY_UNAVAILABLE,
  medicalRecordSections,
} from './note-templates.js'

const SOAP: SoapNote = {
  subjective: 'Cough for three days.',
  objective: 'Normal observations.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care.',
}

const MEDICAL_RECORD: MedicalRecordNote = {
  presentingComplaint: 'Cough.',
  historyOfPresentingComplaint: 'Three days.',
  pastMedicalHistory: '',
  socialHistory: 'Does not smoke.',
  familyHistory: '',
  objective: SOAP.objective,
  assessment: SOAP.assessment,
  plan: SOAP.plan,
}

describe('note clipboard templates', () => {
  it('preserves the established SOAP clipboard order', () => {
    expect(formatNoteForClipboard('soap', SOAP, MEDICAL_RECORD)).toBe(
      'Subjective\nCough for three days.\n\n' +
        'Objective\nNormal observations.\n\n' +
        'Assessment\nAcute cough under review.\n\n' +
        'Plan\nSupportive care.',
    )
  })

  it('formats every Malaysian section in order and makes empty categories explicit', () => {
    expect(formatNoteForClipboard('malaysian', SOAP, MEDICAL_RECORD)).toBe(
      'Presenting Complaint\nCough.\n\n' +
        'History of Presenting Complaint\nThree days.\n\n' +
        'Past Medical History\nNot established\n\n' +
        'Social History\nDoes not smoke.\n\n' +
        'Family History\nNot established\n\n' +
        'Objective\nNormal observations.\n\n' +
        'Assessment\nAcute cough under review.\n\n' +
        'Plan\nSupportive care.',
    )
  })

  it('distinguishes an old analysis from a transcript-silent category', () => {
    const sections = medicalRecordSections(null, SOAP)

    expect(sections.slice(0, 5).map((section) => section.value)).toEqual(
      Array.from({ length: 5 }, () => LEGACY_CATEGORY_UNAVAILABLE),
    )
    expect(sections.map((section) => section.label)).toEqual([
      'Presenting Complaint',
      'History of Presenting Complaint',
      'Past Medical History',
      'Social History',
      'Family History',
      'Objective',
      'Assessment',
      'Plan',
    ])
    expect(formatNoteForClipboard('malaysian', SOAP, null)).toContain(
      `Family History\n${LEGACY_CATEGORY_UNAVAILABLE}`,
    )
  })
})
