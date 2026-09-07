import { describe, expect, it } from 'vitest'
import {
  CaptureModeSchema,
  ConsultationSchema,
  MedicalRecordNoteSchema,
  NOT_ESTABLISHED,
  NoteTemplateSchema,
  toSoapNote,
} from './index.js'

const MEDICAL_RECORD = {
  presentingComplaint: 'Cough.',
  historyOfPresentingComplaint: 'Three days, worsening.',
  pastMedicalHistory: '',
  socialHistory: 'Does not smoke.',
  familyHistory: '',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care.',
}

describe('medical-record note templates', () => {
  it('accepts only the two supported presentation templates', () => {
    expect(NoteTemplateSchema.safeParse('soap').success).toBe(true)
    expect(NoteTemplateSchema.safeParse('malaysian').success).toBe(true)
    expect(NoteTemplateSchema.safeParse('free-text').success).toBe(false)
  })

  it('accepts only supported capture modes and projects older responses to manual', () => {
    expect(CaptureModeSchema.safeParse('ambient').success).toBe(true)
    expect(CaptureModeSchema.safeParse('manual').success).toBe(true)
    expect(CaptureModeSchema.safeParse('continuous').success).toBe(false)

    const consultation = ConsultationSchema.parse({
      id: 'c1',
      status: 'draft',
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      transcript: null,
      analysis: null,
    })

    expect(consultation.captureMode).toBe('manual')
  })

  it('requires every canonical clinical section', () => {
    expect(MedicalRecordNoteSchema.safeParse(MEDICAL_RECORD).success).toBe(true)
    expect(
      MedicalRecordNoteSchema.safeParse({ ...MEDICAL_RECORD, familyHistory: undefined }).success,
    ).toBe(false)
  })

  it('projects the categorized history into one complete SOAP Subjective section', () => {
    const note = MedicalRecordNoteSchema.parse(MEDICAL_RECORD)

    expect(toSoapNote(note)).toEqual({
      subjective:
        'Presenting Complaint\nCough.\n\n' +
        'History of Presenting Complaint\nThree days, worsening.\n\n' +
        `Past Medical History\n${NOT_ESTABLISHED}\n\n` +
        'Social History\nDoes not smoke.\n\n' +
        `Family History\n${NOT_ESTABLISHED}`,
      objective: 'Temperature 37.2°C.',
      assessment: 'Acute cough under review.',
      plan: 'Supportive care.',
    })
  })
})
