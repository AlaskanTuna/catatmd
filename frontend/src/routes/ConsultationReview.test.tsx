import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { ConsultationReview, formatSoapNoteForClipboard } from './ConsultationReview.js'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))

vi.mock('react-hot-toast', () => ({
  default: { success: toastSuccess, error: vi.fn() },
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

vi.mock('../copilot/CatatAI.js', () => ({ CatatAI: () => null }))
vi.mock('../review/ApproveBar.js', () => ({ ApproveBar: () => null }))
vi.mock('../review/ChecklistPanel.js', () => ({ ChecklistPanel: () => null }))
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

const APPROVED = {
  id: 'consultation-1',
  status: 'approved' as const,
  title: 'Acute cough',
  createdAt: new Date('2026-08-27T06:00:00.000Z'),
  updatedAt: new Date('2026-08-27T06:00:00.000Z'),
  transcript: null,
  analysis: {
    note: NOTE,
    redFlags: [],
    gaps: [],
    suggestions: [],
    clinicalFacts: {},
    operational: {},
    evidenceLinks: [],
  },
  editedNote: null,
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
    expect(formatSoapNoteForClipboard(NOTE)).toBe(
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
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(formatSoapNoteForClipboard(NOTE)),
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(toastSuccess).toHaveBeenCalledWith('Note copied.')
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
