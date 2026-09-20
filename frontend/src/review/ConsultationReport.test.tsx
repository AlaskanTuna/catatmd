import type {
  ConsultationAnalysis,
  ConsultationDetail,
  MedicalRecordNote,
  Prescription,
  RedFlag,
  SoapNote,
} from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsultationReport } from './ConsultationReport.js'

// All fixture data is synthetic — invented names, no real identifiers.

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

const flag = (id: string, severity: RedFlag['severity'], label: string): RedFlag => ({
  id,
  label,
  severity,
  evidence: 'transcript span behind the flag',
  source: 'rule',
})

afterEach(cleanup)

describe('note sections', () => {
  it('renders eight fields for the malaysian template', () => {
    const { container } = render(
      <ConsultationReport
        detail={detail({
          noteTemplate: 'malaysian',
          analysis: analysis({ medicalRecordNote: mrNote() }),
        })}
      />,
    )

    expect(container.querySelectorAll('.report-field')).toHaveLength(8)
  })

  it('renders four fields for the soap template', () => {
    const { container } = render(<ConsultationReport detail={detail()} />)

    expect(container.querySelectorAll('.report-field')).toHaveLength(4)
  })
})

describe('prescriptions', () => {
  it('omits the section entirely when prescriptions is null', () => {
    render(<ConsultationReport detail={detail({ prescriptions: null })} />)

    expect(screen.queryByRole('heading', { name: 'Prescriptions' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('omits the section entirely when prescriptions is empty', () => {
    render(<ConsultationReport detail={detail({ prescriptions: [] })} />)

    expect(screen.queryByRole('heading', { name: 'Prescriptions' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders one row per prescription, drug name included', () => {
    const { container } = render(
      <ConsultationReport
        detail={detail({
          prescriptions: [prescription(), prescription({ drug: 'cetirizine' })],
        })}
      />,
    )

    expect(container.querySelectorAll('.report-table tbody tr')).toHaveLength(2)
    expect(screen.getByText('amoxicillin')).toBeTruthy()
    expect(screen.getByText('cetirizine')).toBeTruthy()
  })
})

describe('clinical safety review', () => {
  it('omits the section when there are no red flags', () => {
    render(<ConsultationReport detail={detail()} />)

    expect(screen.queryByRole('heading', { name: 'Clinical Safety Review' })).toBeNull()
  })

  it('prints Not reviewed for a flag nobody disposed', () => {
    render(
      <ConsultationReport
        detail={detail({
          analysis: analysis({
            redFlags: [flag('rf-1', 'urgent', 'Exertional Breathlessness')],
          }),
        })}
      />,
    )

    expect(screen.getByText('Exertional Breathlessness')).toBeTruthy()
    expect(screen.getByText('Not reviewed')).toBeTruthy()
  })

  it('renders every flag in flagEntries order without re-sorting', () => {
    const { container } = render(
      <ConsultationReport
        detail={detail({
          analysis: analysis({
            redFlags: [
              flag('rf-c', 'advisory', 'Advisory Finding'),
              flag('rf-a', 'emergency', 'Emergency Finding'),
              flag('rf-b', 'urgent', 'Urgent Finding'),
            ],
          }),
        })}
      />,
    )

    const labels = [...container.querySelectorAll('.report-flag-label')].map(
      (element) => element.textContent,
    )
    expect(labels).toEqual(['Emergency Finding', 'Urgent Finding', 'Advisory Finding'])
  })
})

describe('approval and provenance', () => {
  it('names the approving clinician and shows the approval timestamp', () => {
    render(<ConsultationReport detail={detail()} />)

    expect(screen.getByText('Dr Suria Binti Karim')).toBeTruthy()
    const expected = new Intl.DateTimeFormat('en-MY', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date('2026-09-20T10:00:00+08:00'))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('falls back to a dash when approval fields are null rather than crashing', () => {
    render(<ConsultationReport detail={detail({ approvedBy: null, approvedAt: null })} />)

    expect(screen.getAllByText('—')).not.toHaveLength(0)
  })

  it('states the AI-assisted provenance verbatim', () => {
    render(<ConsultationReport detail={detail()} />)

    expect(
      screen.getByText(
        'This note was drafted with AI assistance from a recorded consultation, then reviewed, edited and approved by the named clinician, who remains responsible for all clinical decisions.',
      ),
    ).toBeTruthy()
  })
})

describe('document structure', () => {
  it('carries the document name in exactly one h1', () => {
    const { container } = render(<ConsultationReport detail={detail()} />)

    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation Report' })).toBeTruthy()
  })

  it('prints Not recorded when the consultation has no patient name', () => {
    render(<ConsultationReport detail={detail({ patient: null })} />)

    expect(screen.getByText('Not recorded')).toBeTruthy()
  })
})

/*
 * The dark-mode regression guard. The report's palette lives inside
 * .report-sheet as explicit values; an app colour token in this tree would
 * invert under [data-theme='dark'] and export an unreadable page. This is the
 * one defect a reviewer would not catch by reading, so it is asserted here.
 */
describe('theme independence', () => {
  const APP_COLOUR_TOKENS = [
    'text-ink',
    'text-ink-muted',
    'bg-surface',
    'border-line',
    'text-accent',
  ]

  it('contains no app colour-token classes anywhere in the tree', () => {
    const { container } = render(
      <ConsultationReport
        detail={detail({
          noteTemplate: 'malaysian',
          analysis: analysis({
            medicalRecordNote: mrNote(),
            redFlags: [flag('rf-1', 'urgent', 'Urgent Finding')],
          }),
          prescriptions: [prescription()],
        })}
      />,
    )

    for (const token of APP_COLOUR_TOKENS) {
      expect(
        container.innerHTML,
        `report markup contains app colour token "${token}"`,
      ).not.toContain(token)
    }
  })
})
