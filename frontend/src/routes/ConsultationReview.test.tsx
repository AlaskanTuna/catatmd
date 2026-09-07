import type { CopilotProposal } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { formatNoteForClipboard } from '../lib/note-templates.js'
import { ConsultationReview } from './ConsultationReview.js'

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: toastSuccess, error: toastError },
}))

vi.mock('../demo/DemoTour.js', () => ({
  DEMO_CONSULTATION_ID: 'demo-consultation',
  useDemoTour: () => ({ ephemeral: null, updateEphemeral: vi.fn() }),
}))

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    getConsultation: vi.fn(),
    guidelines: vi.fn(),
    patch: vi.fn(),
    analyze: vi.fn(),
    approve: vi.fn(),
  },
}))

vi.mock('../copilot/CatatAI.js', () => ({
  CatatAI: ({ onApply }: { onApply: (proposal: CopilotProposal) => Promise<void> }) => (
    <>
      <button
        type="button"
        onClick={() =>
          void onApply({
            tool: 'edit_note_section',
            section: 'plan',
            text: 'Updated safety-net advice.',
            rationale: 'The doctor requested clearer follow-up advice.',
          })
        }
      >
        Apply Copilot Plan Edit
      </button>
      <button
        type="button"
        onClick={() =>
          void onApply({
            tool: 'edit_note_section',
            section: 'subjective',
            text: 'Replacement subjective.',
            rationale: 'The doctor requested a history rewrite.',
          }).catch(() => undefined)
        }
      >
        Apply Copilot Subjective Edit
      </button>
    </>
  ),
}))
vi.mock('../review/ApproveBar.js', () => ({ ApproveBar: () => null }))
vi.mock('../review/ChecklistPanel.js', () => ({ ChecklistPanel: () => null }))
vi.mock('./CapturePanel.js', () => ({
  CapturePanel: ({ onCaptureBusyChange }: { onCaptureBusyChange: (busy: boolean) => void }) => (
    <button type="button" onClick={() => onCaptureBusyChange(true)}>
      Mock Capture Busy
    </button>
  ),
}))
vi.mock('../review/NoteEditor.js', () => ({
  NoteEditor: ({ note }: { note: { subjective: string } }) => <p>{note.subjective}</p>,
}))
vi.mock('../review/SafetyCards.js', () => ({
  // Renders its question so a test can read the order gaps come out in. The
  // real card is covered by SafetyCards.test.tsx; what matters here is sequence.
  GapCard: ({ gap }: { gap: { question: string } }) => <div data-testid="gap">{gap.question}</div>,
  RedFlagCard: () => null,
  SuggestionCard: () => null,
}))

const NOTE = {
  subjective: 'Cough for three days.',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care and safety-net advice.',
}

const MEDICAL_RECORD_NOTE = {
  presentingComplaint: 'Cough.',
  historyOfPresentingComplaint: 'Three days.',
  pastMedicalHistory: '',
  socialHistory: '',
  familyHistory: '',
  objective: NOTE.objective,
  assessment: NOTE.assessment,
  plan: NOTE.plan,
}

const LEGACY_EDITED_NOTE = {
  ...NOTE,
  subjective: 'Clinician-revised SOAP history.',
  objective: 'Clinician-revised observations.',
}

const APPROVED = {
  id: 'consultation-1',
  status: 'approved' as const,
  noteTemplate: 'soap' as const,
  captureMode: 'manual' as const,
  title: 'Acute cough',
  createdAt: new Date('2026-08-27T06:00:00.000Z'),
  updatedAt: new Date('2026-08-27T06:00:00.000Z'),
  transcript: null,
  analysis: {
    note: NOTE,
    medicalRecordNote: MEDICAL_RECORD_NOTE,
    redFlags: [],
    gaps: [],
    suggestions: [],
    clinicalFacts: {},
    operational: {},
    evidenceLinks: [],
  },
  editedNote: null,
  editedMedicalRecordNote: null,
  approvedAt: new Date('2026-08-27T07:00:00.000Z'),
  approvedBy: 'Dr Lim',
  acknowledgedRedFlagIds: [],
  reviewedGapIds: [],
  redFlagDispositions: [],
  gapDispositions: [],
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/consultations/consultation-1']}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationReview />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('approved note copy', () => {
  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.getConsultation).mockResolvedValue(APPROVED as never)
    vi.mocked(api.guidelines).mockResolvedValue([])
    toastSuccess.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('formats a plain-text SOAP note for clinic CMS paste', () => {
    expect(formatNoteForClipboard('soap', NOTE, MEDICAL_RECORD_NOTE)).toBe(
      'Subjective\nCough for three days.\n\n' +
        'Objective\nTemperature 37.2°C.\n\n' +
        'Assessment\nAcute cough under review.\n\n' +
        'Plan\nSupportive care and safety-net advice.',
    )
  })

  it('copies the final approved note and keeps Export available', async () => {
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy Note' }))

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        formatNoteForClipboard('soap', NOTE, MEDICAL_RECORD_NOTE),
      ),
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(toastSuccess).toHaveBeenCalledWith('Note copied.')
  })
})

describe('consultation note template', () => {
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.getConsultation).mockResolvedValue(APPROVED as never)
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.patch).mockReset()
    toastError.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
  })

  it('moves the layout control out of Clinical Note and saves both changed settings', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      ...APPROVED,
      noteTemplate: 'malaysian',
      captureMode: 'ambient',
    } as never)
    setup()

    await screen.findByRole('heading', { name: 'Clinical Note' })
    expect(screen.queryByRole('radio', { name: 'Malaysian Medical Record' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Consultation Settings' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Malaysian Medical Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ambient' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('consultation-1', {
        noteTemplate: 'malaysian',
        captureMode: 'ambient',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Family History' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit Family History/ })).toBeNull()
  })

  it('persists one canonical category edit and updates its provenance', async () => {
    const awaitingReview = {
      ...APPROVED,
      status: 'awaiting_review' as const,
      noteTemplate: 'malaysian' as const,
      approvedAt: null,
      approvedBy: null,
    }
    vi.mocked(api.getConsultation).mockResolvedValue(awaitingReview as never)
    vi.mocked(api.patch).mockResolvedValue({
      ...awaitingReview,
      editedMedicalRecordNote: {
        ...MEDICAL_RECORD_NOTE,
        familyHistory: 'Mother has asthma.',
      },
    } as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Family History' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Family History' }), {
      target: { value: 'Mother has asthma.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Family History' }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('consultation-1', {
        editedMedicalRecordNote: { familyHistory: 'Mother has asthma.' },
      }),
    )
    const section = (await screen.findByText('Mother has asthma.')).closest('section')
    expect(section?.textContent).toContain('You Edited This')
  })

  it('copies an approved Malaysian record in the selected order', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      noteTemplate: 'malaysian',
    } as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy Note' }))

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        formatNoteForClipboard('malaysian', NOTE, MEDICAL_RECORD_NOTE),
      ),
    )
    expect(screen.getByRole('heading', { name: 'Presenting Complaint' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Subjective' })).toBeNull()
  })

  it('opens Consultation Settings while awaiting review', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'awaiting_review',
      approvedAt: null,
      approvedBy: null,
    } as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Consultation Settings' }))

    expect(screen.getByRole('dialog', { name: 'Consultation Settings' })).toBeTruthy()
  })

  it('surfaces a settings save failure inline without changing the selected layout', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Unsupported by deployed API'))
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Consultation Settings' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Malaysian Medical Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be saved/i)
    expect(screen.getByRole('dialog', { name: 'Consultation Settings' })).toBeTruthy()
    expect(
      screen.getByRole('radio', { name: 'Malaysian Medical Record' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('renders an existing SOAP-only edit instead of hiding it behind canonical AI text', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      editedNote: LEGACY_EDITED_NOTE,
    } as never)
    setup()

    expect(await screen.findByText('Clinician-revised SOAP history.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Family History' })).toBeNull()
  })

  it('copies an existing SOAP-only edit without mixing in canonical AI categories', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      noteTemplate: 'malaysian',
      editedNote: LEGACY_EDITED_NOTE,
    } as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy Note' }))

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        formatNoteForClipboard('malaysian', LEGACY_EDITED_NOTE, null),
      ),
    )
    expect(screen.getAllByText('Not recorded by this analysis version')).toHaveLength(5)
  })
})

describe('consultation hero actions', () => {
  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      approvedAt: null,
      approvedBy: null,
      transcript: {
        source: 'paste',
        labelsReviewed: true,
        turns: [{ speaker: 'patient', text: 'Cough for three days.' }],
      },
    } as never)
  })

  it('shows no routine information tooltip beside an enabled Analyse action', async () => {
    setup()

    expect(await screen.findByRole('button', { name: 'Analyse Consultation' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'What happens when you analyse' })).toBeNull()
  })

  it('disables Consultation Settings while capture owns unsent audio', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      approvedAt: null,
      approvedBy: null,
    } as never)
    setup()

    const settings = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Consultation Settings',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mock Capture Busy' }))

    expect(settings.disabled).toBe(true)
  })
})

describe('copilot note edits', () => {
  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.patch).mockReset()
  })

  it('routes a new-analysis OAP proposal through the canonical note', async () => {
    const awaitingReview = {
      ...APPROVED,
      status: 'awaiting_review' as const,
      approvedAt: null,
      approvedBy: null,
    }
    vi.mocked(api.getConsultation).mockResolvedValue(awaitingReview as never)
    vi.mocked(api.patch).mockResolvedValue(awaitingReview as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Apply Copilot Plan Edit' }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('consultation-1', {
        editedMedicalRecordNote: { plan: 'Updated safety-net advice.' },
      }),
    )
  })

  it('refuses an opaque Subjective proposal when the canonical categories exist', async () => {
    const awaitingReview = {
      ...APPROVED,
      status: 'awaiting_review' as const,
      approvedAt: null,
      approvedBy: null,
    }
    vi.mocked(api.getConsultation).mockResolvedValue(awaitingReview as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Apply Copilot Subjective Edit' }))

    await waitFor(() => expect(api.patch).not.toHaveBeenCalled())
  })

  it('keeps older analyses on the legacy SOAP proposal path', async () => {
    const legacy = {
      ...APPROVED,
      status: 'awaiting_review' as const,
      approvedAt: null,
      approvedBy: null,
      analysis: { ...APPROVED.analysis, medicalRecordNote: undefined },
    }
    vi.mocked(api.getConsultation).mockResolvedValue(legacy as never)
    vi.mocked(api.patch).mockResolvedValue(legacy as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Apply Copilot Plan Edit' }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('consultation-1', {
        editedNote: { ...NOTE, plan: 'Updated safety-net advice.' },
      }),
    )
  })
})

/**
 * Issue #211. `priority` is documented as a volume and ordering signal with no
 * safety meaning, so this pins the one thing it is used for and nothing more:
 * the list is ordered, never filtered, and the heading keeps the true total.
 */
describe('missing information order', () => {
  const gap = (id: string, priority: 'high' | 'medium' | 'low') => ({
    id,
    question: `Q-${id}`,
    rationale: 'Because',
    priority,
  })

  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      analysis: {
        ...APPROVED.analysis,
        // Deliberately worst-case: the API order is the exact reverse of the
        // order a doctor should read them in.
        gaps: [gap('low-1', 'low'), gap('med-1', 'medium'), gap('high-1', 'high')],
      },
    } as never)
  })

  it('shows high-priority gaps first, whatever order the API returned', async () => {
    setup()

    const rendered = await screen.findAllByTestId('gap')
    expect(rendered.map((node) => node.textContent)).toEqual(['Q-high-1', 'Q-med-1', 'Q-low-1'])
  })

  it('keeps the API order inside a priority band', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      analysis: {
        ...APPROVED.analysis,
        gaps: [gap('b', 'medium'), gap('a', 'medium'), gap('c', 'high')],
      },
    } as never)
    setup()

    const rendered = await screen.findAllByTestId('gap')
    expect(rendered.map((node) => node.textContent)).toEqual(['Q-c', 'Q-b', 'Q-a'])
  })

  it('counts every gap on the heading, not just the ones above the fold', async () => {
    setup()

    expect(await screen.findByText('Missing Information')).toBeTruthy()
    // Three gaps in, three gaps out — sorting must never drop one.
    expect(screen.getAllByTestId('gap')).toHaveLength(3)
  })
})

/*
 * jsdom 27 ships `<dialog>` without `showModal`; see PatientList.test.tsx. The
 * stand-in sets `open` so `getByRole('dialog')` can find it.
 */
describe('the full missing-information list', () => {
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close

  const gap = (id: string) => ({
    id,
    question: `Q-${id}`,
    rationale: 'Because',
    priority: 'medium' as const,
  })
  // Seven, so four sit past the three-item preview.
  const SEVEN = Array.from({ length: 7 }, (_, i) => gap(String(i)))

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      analysis: { ...APPROVED.analysis, gaps: SEVEN },
    } as never)
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
  })

  it('keeps every gap in the rail so print is never truncated', async () => {
    setup()

    // All seven render; the two past the preview are hidden in CSS rather than
    // sliced out, which is what `print:block` brings back on paper.
    expect(await screen.findAllByTestId('gap')).toHaveLength(7)
  })

  it('opens the full list in a dialog rather than expanding the rail', async () => {
    setup()

    const cta = await screen.findByText('Show All 7 Missing Items')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(cta)

    const dialog = await screen.findByRole('dialog')
    // Every gap, in the dialog, on top of the seven still in the rail.
    expect(screen.getAllByTestId('gap')).toHaveLength(14)
    expect(dialog.textContent).toContain('Missing Information')
  })

  it('puts focus on the dialog rather than leaving it where the trigger was', async () => {
    setup()

    fireEvent.click(await screen.findByText('Show All 7 Missing Items'))

    // The content is gated on state, so it is absent when `showModal()` runs
    // its native autofocus pass. Without the open effect, focus would still be
    // on the trigger, which is now behind a modal.
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    expect((document.activeElement as HTMLElement).textContent).toBe('Close')
  })

  it('does not put the cards in the DOM twice while it is closed', async () => {
    setup()

    await screen.findByText('Show All 7 Missing Items')
    // The rail's seven and nothing else: the dialog's copy is gated on state,
    // not merely hidden, so a closed dialog contributes no duplicate controls.
    expect(screen.getAllByTestId('gap')).toHaveLength(7)
  })
})

describe('the panel overflow threshold', () => {
  const gap = (id: string) => ({
    id,
    question: `Q-${id}`,
    rationale: 'Because',
    priority: 'medium' as const,
  })

  const withGaps = (n: number) => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      analysis: {
        ...APPROVED.analysis,
        gaps: Array.from({ length: n }, (_, i) => gap(String(i))),
      },
    } as never)
  }

  it('shows no CTA at the preview size, where nothing is hidden', async () => {
    withGaps(3)
    setup()

    expect(await screen.findByText('Missing Information')).toBeTruthy()
    expect(screen.queryByText(/show all/i)).toBeNull()
  })

  it('offers the CTA as soon as one finding is past the preview', async () => {
    withGaps(4)
    setup()

    expect(await screen.findByText('Show All 4 Missing Items')).toBeTruthy()
  })

  it('counts every finding on the CTA, not just the hidden ones', async () => {
    withGaps(9)
    setup()

    expect(await screen.findByText('Show All 9 Missing Items')).toBeTruthy()
    // All nine stay in the rail; four are visible and the rest are hidden in
    // CSS so `print:block` can bring them back.
    expect(screen.getAllByTestId('gap')).toHaveLength(9)
  })
})

describe('the header identifies the consultation', () => {
  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
  })

  it('names the patient in the breadcrumb rather than the word Review', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      patient: { id: 'patient-1', name: 'Siti binti Ahmad' },
    } as never)
    setup()

    expect(await screen.findByText('Siti binti Ahmad')).toBeTruthy()
    expect(screen.queryByText('Review')).toBeNull()
  })

  it('falls back to Review when the consultation has no patient', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue(APPROVED as never)
    setup()

    expect(await screen.findByText('Review')).toBeTruthy()
  })

  it('never shows the record id, which means nothing to a doctor', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue(APPROVED as never)
    setup()

    await screen.findByText('Consultation Review')
    expect(screen.queryByText('consultation-1')).toBeNull()
  })
})
