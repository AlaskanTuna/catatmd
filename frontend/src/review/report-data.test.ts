import type {
  ConsultationAnalysis,
  ConsultationDetail,
  Disposition,
  MedicalRecordNote,
  Prescription,
  RedFlag,
  SoapNote,
} from '@shared/types'
import { NOT_ESTABLISHED } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { LEGACY_CATEGORY_UNAVAILABLE } from '../lib/note-templates.js'
import { flagEntries, prescriptionRows, reportSections } from './report-data.js'

const soapNote = (over: Partial<SoapNote> = {}): SoapNote => ({
  subjective: 'Cough for three days, worse at night',
  objective: 'Throat mildly erythematous, no exudate',
  assessment: 'Likely viral URTI',
  plan: 'Symptomatic treatment, review if worsening',
  ...over,
})

const mrNote = (over: Partial<MedicalRecordNote> = {}): MedicalRecordNote => ({
  presentingComplaint: 'Cough',
  historyOfPresentingComplaint: 'Three days, worse at night',
  pastMedicalHistory: 'Childhood asthma',
  socialHistory: 'Non-smoker',
  familyHistory: 'Unremarkable',
  objective: 'Throat mildly erythematous',
  assessment: 'Likely viral URTI',
  plan: 'Symptomatic treatment',
  ...over,
})

const analysis = (over: Partial<ConsultationAnalysis> = {}): ConsultationAnalysis => ({
  note: soapNote(),
  gaps: [],
  redFlags: [],
  suggestions: [],
  ...over,
})

const detail = (over: Partial<ConsultationDetail> = {}): ConsultationDetail => ({
  id: 'c-001',
  status: 'approved',
  noteTemplate: 'soap',
  captureMode: 'manual',
  title: null,
  createdAt: new Date('2026-09-20T09:00:00+08:00'),
  updatedAt: new Date('2026-09-20T10:00:00+08:00'),
  transcript: null,
  analysis: analysis(),
  editedNote: null,
  editedMedicalRecordNote: null,
  prescriptions: null,
  approvedAt: new Date('2026-09-20T10:00:00+08:00'),
  approvedBy: 'Dr Suria Binti Karim',
  patient: { id: 'p-001', name: 'Aisha Rahman' },
  acknowledgedRedFlagIds: [],
  reviewedGapIds: [],
  redFlagDispositions: [],
  gapDispositions: [],
  ...over,
})

const prescription = (over: Partial<Prescription> = {}): Prescription => ({
  drug: 'amoxicillin',
  dose: '500 mg',
  route: 'oral',
  frequency: 'three-times-daily',
  duration: '5 days',
  food: 'after',
  dictated: 'amoxicillin 500 mg three times a day after food for five days',
  ...over,
})

const flag = (id: string, severity: RedFlag['severity']): RedFlag => ({
  id,
  label: id,
  severity,
  evidence: 'said so',
  source: 'rule',
})

const disposition = (over: Partial<Disposition> = {}): Disposition => ({
  id: 'a',
  state: 'acknowledged',
  decidedAt: new Date('2026-09-20T10:30:00+08:00'),
  ...over,
})

const decidedAtFormat = new Intl.DateTimeFormat('en-MY', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const stamped = decidedAtFormat.format(new Date('2026-09-20T10:30:00+08:00'))

describe('reportSections', () => {
  it('returns nothing while there is no analysis', () => {
    expect(reportSections(detail({ analysis: null }))).toEqual([])
  })

  it('returns eight sections for the malaysian template', () => {
    const sections = reportSections(
      detail({ noteTemplate: 'malaysian', analysis: analysis({ medicalRecordNote: mrNote() }) }),
    )

    expect(sections.map(({ key }) => key)).toEqual([
      'presentingComplaint',
      'historyOfPresentingComplaint',
      'pastMedicalHistory',
      'socialHistory',
      'familyHistory',
      'objective',
      'assessment',
      'plan',
    ])
  })

  it('returns four sections for the soap template', () => {
    const sections = reportSections(detail())

    expect(sections.map(({ key }) => key)).toEqual([
      'subjective',
      'objective',
      'assessment',
      'plan',
    ])
    expect(sections.map(({ label }) => label)).toEqual([
      'Subjective',
      'Objective',
      'Assessment',
      'Plan',
    ])
  })

  it('prefers the edited medical record note over the analysis note', () => {
    const sections = reportSections(
      detail({
        noteTemplate: 'malaysian',
        editedMedicalRecordNote: mrNote({ presentingComplaint: 'Sore throat, edited' }),
        analysis: analysis({ medicalRecordNote: mrNote({ presentingComplaint: 'Cough' }) }),
      }),
    )

    expect(sections[0]?.value).toBe('Sore throat, edited')
  })

  it('prefers the edited soap note over the analysis note', () => {
    const sections = reportSections(
      detail({
        editedNote: soapNote({ assessment: 'Bacterial pharyngitis, edited' }),
        analysis: analysis({ note: soapNote({ assessment: 'Likely viral URTI' }) }),
      }),
    )

    expect(sections.find(({ key }) => key === 'assessment')?.value).toBe(
      'Bacterial pharyngitis, edited',
    )
  })

  it('reads the legacy constant for history fields when a malaysian analysis has no categorized note', () => {
    const sections = reportSections(
      detail({ noteTemplate: 'malaysian', analysis: analysis({ note: soapNote() }) }),
    )

    for (const key of [
      'presentingComplaint',
      'historyOfPresentingComplaint',
      'pastMedicalHistory',
      'socialHistory',
      'familyHistory',
    ]) {
      expect(sections.find((section) => section.key === key)?.value).toBe(
        LEGACY_CATEGORY_UNAVAILABLE,
      )
    }
    expect(sections.find(({ key }) => key === 'objective')?.value).toBe(
      'Throat mildly erythematous, no exudate',
    )
  })

  it('renders NOT_ESTABLISHED for an empty section value', () => {
    const sections = reportSections(
      detail({ analysis: analysis({ note: soapNote({ plan: '   ' }) }) }),
    )

    expect(sections.find(({ key }) => key === 'plan')?.value).toBe(NOT_ESTABLISHED)
  })

  it('renders NOT_ESTABLISHED for an empty subjective too', () => {
    // `formatNoteForClipboard` emits subjective raw; the printed report cannot,
    // because a blank section on paper reads as lost content.
    const sections = reportSections(
      detail({ analysis: analysis({ note: soapNote({ subjective: '' }) }) }),
    )

    expect(sections.find(({ key }) => key === 'subjective')?.value).toBe(NOT_ESTABLISHED)
  })
})

describe('prescriptionRows', () => {
  it('numbers rows from one', () => {
    const rows = prescriptionRows([prescription(), prescription({ drug: 'cetirizine' })])

    expect(rows.map(({ position }) => position)).toEqual([1, 2])
  })

  it('prints As directed when every direction field is null', () => {
    const [row] = prescriptionRows([prescription({ route: null, frequency: null, food: null })])

    expect(row?.directions).toBe('As directed')
  })

  it('prints only the field that is set, with no stray separators', () => {
    const [row] = prescriptionRows([
      prescription({ route: 'inhaled', frequency: null, food: null }),
    ])

    expect(row?.directions).toBe('Inhaled')
  })

  it('orders route, frequency, food when all three are set', () => {
    const [row] = prescriptionRows([prescription()])

    expect(row?.directions).toBe('Oral · Three Times Daily · After Food')
  })

  it('renders null dose and duration as empty cells, never the string null', () => {
    const [row] = prescriptionRows([prescription({ dose: null, duration: null })])

    expect(row?.dose).toBe('')
    expect(row?.duration).toBe('')
    expect(row?.directions).not.toContain('500 mg')
    expect(row?.directions).not.toContain('5 days')
  })
})

describe('flagEntries', () => {
  it('returns nothing while there is no analysis', () => {
    expect(flagEntries(detail({ analysis: null }))).toEqual([])
  })

  it('prints an acknowledged disposition with its timestamp', () => {
    const [entry] = flagEntries(
      detail({
        analysis: analysis({ redFlags: [flag('a', 'urgent')] }),
        redFlagDispositions: [disposition({ id: 'a' })],
      }),
    )

    expect(entry?.disposition).toBe(`Acknowledged · ${stamped}`)
  })

  it('prints a dismissed disposition with its reason', () => {
    const [entry] = flagEntries(
      detail({
        analysis: analysis({ redFlags: [flag('a', 'urgent')] }),
        redFlagDispositions: [
          disposition({ id: 'a', state: 'dismissed', reason: 'Home oxygen already arranged' }),
        ],
      }),
    )

    expect(entry?.disposition).toBe('Dismissed · Home oxygen already arranged')
  })

  it('prints a not_applicable disposition with its timestamp', () => {
    const [entry] = flagEntries(
      detail({
        analysis: analysis({ redFlags: [flag('a', 'urgent')] }),
        redFlagDispositions: [disposition({ id: 'a', state: 'not_applicable' })],
      }),
    )

    expect(entry?.disposition).toBe(`Not applicable · ${stamped}`)
  })

  it('prints Acknowledged with no timestamp for a flag in acknowledgedRedFlagIds', () => {
    const [entry] = flagEntries(
      detail({
        analysis: analysis({ redFlags: [flag('a', 'urgent')] }),
        acknowledgedRedFlagIds: ['a'],
      }),
    )

    expect(entry?.disposition).toBe('Acknowledged')
  })

  it('prints Not reviewed for a flag nobody disposed', () => {
    const [entry] = flagEntries(detail({ analysis: analysis({ redFlags: [flag('a', 'urgent')] }) }))

    expect(entry?.disposition).toBe('Not reviewed')
  })

  it('orders emergency before urgent before advisory', () => {
    const entries = flagEntries(
      detail({
        analysis: analysis({
          redFlags: [flag('c', 'advisory'), flag('a', 'emergency'), flag('b', 'urgent')],
        }),
      }),
    )

    expect(entries.map(({ flag: f }) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps an entry for every flag, including undisposed ones', () => {
    const entries = flagEntries(
      detail({
        analysis: analysis({ redFlags: [flag('a', 'emergency'), flag('b', 'advisory')] }),
        redFlagDispositions: [disposition({ id: 'a' })],
      }),
    )

    expect(entries).toHaveLength(2)
    expect(entries.map(({ flag: f }) => f.id)).toEqual(['a', 'b'])
    expect(entries[1]?.disposition).toBe('Not reviewed')
  })
})
