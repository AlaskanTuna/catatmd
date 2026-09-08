import type { CopilotProposal } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../lib/api.js'
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

/*
 * Hoisted out of the mock factory rather than written inline in it (#293).
 *
 * Biome's TSX parser cannot parse an arrow function inside this particular
 * object literal: the `ApiError: class extends Error {}` entry below makes it
 * re-read the whole thing as a destructuring pattern, and it then reports a
 * syntax error on that line rather than on the arrow. Defining the two mocks
 * here keeps the factory arrow-free and the file parseable.
 */
const audioApi = vi.hoisted(() => ({
  // The review page looks for a stored recording on mount. Null is the
  // ordinary answer for every consultation in these fixtures: none was
  // recorded, so none of them offers playback.
  get: vi.fn(() => Promise.resolve(null)),
  put: vi.fn(() => Promise.resolve({ expiresAt: new Date() })),
}))

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    getConsultation: vi.fn(),
    guidelines: vi.fn(),
    patch: vi.fn(),
    analyze: vi.fn(),
    approve: vi.fn(),
    getConsultationAudio: audioApi.get,
    putConsultationAudio: audioApi.put,
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
  RedFlagCard: ({ flag }: { flag: { label: string } }) => (
    <div data-testid="flag">{flag.label}</div>
  ),
  SuggestionCard: () => null,
}))

const livePanes = vi.hoisted(() => ({
  redFlags: [] as unknown[],
  gaps: [] as unknown[],
  answered: [] as unknown[],
  clinicalFacts: null as unknown,
  operational: null as unknown,
  hasContent: false,
}))

vi.mock('../audio/live/use-live-panes.js', () => ({
  useLivePanes: () => ({ panes: livePanes, absorb: vi.fn(), reset: vi.fn() }),
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

  it('re-shapes the empty Draft note the moment the format is saved', async () => {
    const draft = {
      ...APPROVED,
      status: 'draft' as const,
      analysis: null,
      approvedAt: null,
      approvedBy: null,
    }
    vi.mocked(api.getConsultation).mockResolvedValue(draft as never)
    vi.mocked(api.patch).mockResolvedValue({
      ...draft,
      noteTemplate: 'malaysian',
    } as never)
    setup()

    // With nothing analysed, the placeholder previews the shape the note will
    // take, so the selected format has to reach it.
    expect(await screen.findByRole('heading', { name: 'Subjective' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Presenting Complaint' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Consultation Settings' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Malaysian Medical Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('consultation-1', { noteTemplate: 'malaysian' }),
    )
    expect(await screen.findByRole('heading', { name: 'Presenting Complaint' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Family History' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Subjective' })).toBeNull()
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
    vi.mocked(api.analyze).mockReset()
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

  it('keeps the missing-transcript explanation inside the Analyse action boundary', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      approvedAt: null,
      approvedBy: null,
    } as never)
    setup()

    const analyse = await screen.findByRole('button', { name: 'Analyse Consultation' })
    const tip = screen.getByRole('button', { name: 'Why this is not available yet' })
    const wrapper = analyse.parentElement

    expect(tip.parentElement?.parentElement).toBe(wrapper)
    expect(wrapper?.className).toContain('relative')
    expect(wrapper?.className).toContain('inline-flex')
    expect(analyse.contains(tip)).toBe(false)
  })

  it('explains the missing transcript in one short sentence', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      approvedAt: null,
      approvedBy: null,
    } as never)
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Why this is not available yet' }))

    expect(await screen.findByText('Add a transcript first.')).toBeTruthy()
  })

  it('explains a failed analysis without relaying the raw error', async () => {
    vi.mocked(api.analyze).mockRejectedValue(
      new ApiError(503, 'upstream_unavailable', 'Upstream node gpu-7 unreachable'),
    )
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Analyse Consultation' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Analysis could not be completed' }))

    expect(await screen.findByText('Analysis failed. Try again.')).toBeTruthy()
    expect(screen.queryByText(/gpu-7/)).toBeNull()
  })

  it('uses the large action dimensions consistently after approval', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue(APPROVED as never)
    setup()

    const settings = await screen.findByRole('button', { name: 'Consultation Settings' })
    const copy = screen.getByRole('button', { name: 'Copy Note' })
    const exportAction = screen.getByRole('button', { name: 'Export' })

    expect(copy.className).toContain('h-12')
    expect(exportAction.className).toContain('h-12')
    expect(settings.className).toContain('h-12')
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

/**
 * The live panes replace the rail's placeholders while ambient capture runs
 * (#219). The scheduling is `use-live-panes.test.ts`; what matters here is that
 * the review screen renders them, and that the note does **not** become one.
 */
describe('the live panes during ambient capture', () => {
  const DRAFT = { ...APPROVED, status: 'draft' as const, analysis: null, editedNote: null }

  beforeEach(() => {
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue(DRAFT as never)
    livePanes.redFlags = []
    livePanes.gaps = []
    livePanes.answered = []
    livePanes.clinicalFacts = null
    livePanes.operational = null
    livePanes.hasContent = false
  })

  it('shows placeholder bars until capture has said something', async () => {
    setup()

    expect(await screen.findByText('Red Flags')).toBeTruthy()
    expect(screen.queryByTestId('flag')).toBeNull()
    expect(screen.queryByTestId('gap')).toBeNull()
  })

  it('renders live flags and gaps once capture produces them', async () => {
    livePanes.hasContent = true
    livePanes.redFlags = [
      { id: 'haemoptysis', label: 'Coughing up blood', severity: 'emergency', source: 'rule' },
    ]
    livePanes.gaps = [
      { id: 'fever', question: 'Any fever?', rationale: 'Because', priority: 'high' },
    ]
    setup()

    expect(await screen.findByTestId('flag')).toBeTruthy()
    expect(screen.getByTestId('flag').textContent).toBe('Coughing up blood')
    expect(screen.getByTestId('gap').textContent).toBe('Any fever?')
  })

  it('moves an answered prompt rather than letting it vanish', async () => {
    livePanes.hasContent = true
    livePanes.gaps = []
    livePanes.answered = [
      { id: 'fever', question: 'Any fever?', rationale: 'Because', priority: 'high' },
    ]
    setup()

    expect(await screen.findByText(/1 covered so far/)).toBeTruthy()
    expect(screen.getByText(/Any fever\?/)).toBeTruthy()
  })

  it('leaves the note alone, which is the whole decision', async () => {
    livePanes.hasContent = true
    livePanes.redFlags = [
      { id: 'chest-pain', label: 'Chest pain', severity: 'urgent', source: 'rule' },
    ]
    setup()

    await screen.findByTestId('flag')
    // §20.8.1: the note is written once, from the transcript, at Finish. A note
    // folded from a previous note is the less-grounded shape by another route.
    expect(screen.queryByText(NOTE.subjective)).toBeNull()
  })
})

/**
 * Issue #282. `hidden` appended to the note column did nothing above `lg`:
 * Tailwind emits its `lg:flex` inside a `min-width:1024px` block that comes
 * after the base `hidden` rule, and `cn()` keeps both because a variant makes
 * them different utilities. Measured on production at 1440x900, the column
 * carried `hidden` and computed `display: flex`, which wrapped the two-column
 * capture grid onto a second row and overflowed the page by 738px.
 *
 * This asserts the resolved class list rather than a computed style, because a
 * computed style here would pass rather than fail: the suite runs on jsdom with
 * `css` unset, so Tailwind never compiles into the run, and jsdom does not
 * evaluate `@media` rules into the cascade either way. `cn()` runs
 * tailwind-merge, so `className` is already the winning set, which is the
 * closest honest proxy. The computed value belongs to a browser check against
 * the shipped stylesheet.
 */
describe('the note column while capture runs', () => {
  beforeEach(() => {
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      approvedAt: null,
      approvedBy: null,
    } as never)
    // The moment capture starts, before it has said anything. `livePanes` is
    // module state the block above mutates, and a leftover flag would render
    // the prompter's severity chip through a `SafetyCards` mock that has no
    // `SEVERITY` to give it.
    livePanes.redFlags = []
    livePanes.gaps = []
    livePanes.answered = []
    livePanes.clinicalFacts = null
    livePanes.operational = null
    livePanes.hasContent = false
  })

  it('withholds every lg utility while capturing, so none can outrank hidden', async () => {
    setup()

    const note = (await screen.findByRole('heading', { name: 'Clinical Note' })).closest('section')
    const classes = () => note?.className.split(/\s+/) ?? []

    // The review layout, which Stop has to bring back intact.
    expect(classes()).toContain('lg:flex')
    expect(classes()).not.toContain('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Mock Capture Busy' }))

    expect(classes()).toContain('hidden')
    expect(classes().filter((klass) => klass.startsWith('lg:'))).toEqual([])
  })

  /*
   * The mocked CapturePanel reports busy without ever asking for the theatre,
   * which is exactly the shape of the press-to-record path: no live
   * conversation, so no dialog to hold the safety panel.
   *
   * Withholding the companion column on `captureBusy` alone left the prompter
   * with nowhere to render during a manual recording. The rail is hidden by
   * then, so the prompter is the only thing that can carry a red flag.
   */
  it('keeps the safety panel in its own column when nothing opened the theatre', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Clinical Note' })

    // "Ask Next" belongs to the prompter alone; the rail has no such panel.
    expect(screen.queryByText('Ask Next')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mock Capture Busy' }))

    expect(screen.getByText('Ask Next')).toBeTruthy()
  })
})

/**
 * Issue #287. The transcript column is 380px, and the transcript is the one
 * thing on this page that is read rather than scanned. Once the consultation
 * is over the doctor can put it back on a surface worth reading it on.
 */
describe('reopening the settled conversation', () => {
  const WITH_TRANSCRIPT = {
    ...APPROVED,
    transcript: {
      source: 'paste',
      labelsReviewed: true,
      turns: [
        { speaker: 'doctor', text: 'Any blood when you cough?' },
        { speaker: 'patient', text: 'Once or twice, small amount only.' },
      ],
    },
  }

  const conversation = () => document.querySelector('dialog[aria-labelledby="conversation-title"]')

  beforeEach(() => {
    vi.mocked(api.guidelines).mockResolvedValue([])
    vi.mocked(api.getConsultation).mockReset()
    vi.mocked(api.getConsultation).mockResolvedValue(WITH_TRANSCRIPT as never)
  })

  it('opens the conversation on its own surface, and closes again', async () => {
    setup()

    const open = await screen.findByRole('button', { name: /view conversation/i })
    expect(conversation()?.hasAttribute('open')).toBe(false)

    fireEvent.click(open)

    const dialog = conversation()
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.textContent).toContain('2 turns')
    expect(dialog?.textContent).toContain('Any blood when you cough?')
    // Roles are real here, not speaker numbers: `draftHostedTurns` has run by
    // the time a transcript is settled.
    expect(dialog?.textContent).toContain('Doctor')
    expect(dialog?.textContent).toContain('Patient')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(conversation()?.hasAttribute('open')).toBe(false)
  })

  it('offers nothing to reopen before there is a transcript', async () => {
    vi.mocked(api.getConsultation).mockResolvedValue({
      ...APPROVED,
      status: 'draft',
      analysis: null,
      transcript: null,
    } as never)
    setup()

    await screen.findByRole('heading', { name: 'Consultation Review' })
    expect(screen.queryByRole('button', { name: /view conversation/i })).toBeNull()
  })
})
