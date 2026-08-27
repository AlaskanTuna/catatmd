import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { PatientDetail } from './PatientDetail.js'

vi.mock('../lib/api.js', () => ({
  api: {
    getPatient: vi.fn(),
    createConsultation: vi.fn(),
    erasePatient: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const PATIENT = {
  id: 'patient-1',
  name: 'Aisha Rahman',
  nric: null,
  age: null,
  gender: null,
  erasedAt: null,
  createdAt: '2026-08-20T06:00:00.000Z',
  updatedAt: '2026-08-27T06:00:00.000Z',
  consultations: [
    {
      id: 'consultation-1',
      status: 'approved' as const,
      title: 'Acute cough',
      createdAt: new Date('2026-08-26T06:00:00.000Z'),
      updatedAt: new Date('2026-08-26T06:00:00.000Z'),
    },
  ],
}

afterEach(cleanup)

/* jsdom 27 ships `<dialog>` without `showModal` or `close`; see PatientList.test.tsx. */
const nativeDialog = {
  showModal: HTMLDialogElement.prototype.showModal,
  close: HTMLDialogElement.prototype.close,
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})
afterAll(() => Object.assign(HTMLDialogElement.prototype, nativeDialog))

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/patients/patient-1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PatientDetail', () => {
  beforeEach(() => {
    vi.mocked(api.getPatient).mockReset()
    vi.mocked(api.getPatient).mockResolvedValue(PATIENT)
    vi.mocked(api.createConsultation).mockReset()
    vi.mocked(api.createConsultation).mockResolvedValue({
      id: 'consultation-1',
    } as Awaited<ReturnType<typeof api.createConsultation>>)
    vi.mocked(api.erasePatient).mockReset()
    navigate.mockReset()
  })

  it('renders unrecorded patient fields honestly', async () => {
    setup()

    expect(await screen.findByText('Aisha Rahman')).toBeTruthy()
    expect(screen.getAllByText('Not recorded')).toHaveLength(3)
  })

  it('shows this patient consultation history as consultation rows', async () => {
    setup()

    const history = await screen.findByRole('link', { name: /acute cough/i })
    expect(history.getAttribute('href')).toBe('/consultations/consultation-1')
    expect(screen.getByText('Approved')).toBeTruthy()
  })
})

/**
 * Filing used to be asserted on the capture page, which passed a `patientId`
 * query parameter into the create request. Capture no longer creates anything
 * — the record exists first — so the property moved here with the behaviour
 * rather than being dropped.
 *
 * It is worth pinning in its new home for the same reason it was worth pinning
 * in the old one: a consultation filed to nobody cannot be found again by
 * patient, and a consultation filed to the *wrong* patient is worse than that.
 */
describe('starting a consultation from a patient profile', () => {
  it('creates the record against this patient, with no transcript yet', async () => {
    setup()

    const [start] = await screen.findAllByRole('button', { name: /start consultation/i })
    if (!start) throw new Error('expected a start control')
    fireEvent.click(start)

    await waitFor(() => expect(api.createConsultation).toHaveBeenCalledWith(undefined, 'patient-1'))
  })
})

/**
 * Single-patient erasure, using the same dialog the list uses. What is worth
 * pinning here is the placement and the guard, not the copy, which
 * `PatientList.test.tsx` already covers.
 */
describe('erasing this patient record', () => {
  const openDialog = async () => {
    setup()
    await screen.findByText('Aisha Rahman')
    fireEvent.click(screen.getByRole('button', { name: /erase patient record/i }))
    return screen.getByRole('dialog')
  }

  it('states this patient consultation count before erasing', async () => {
    const dialog = await openDialog()

    expect(within(dialog).getByText(/1 consultation filed to them/i)).toBeTruthy()
  })

  it('requires the acknowledgement before the record can be erased', async () => {
    const dialog = await openDialog()
    const confirm = within(dialog).getByRole('button', { name: 'Erase 1' })

    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirm)
    expect(api.erasePatient).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I understand this erases/i }))
    expect(confirm.hasAttribute('disabled')).toBe(false)
  })

  it('erases the record and leaves the profile it just emptied', async () => {
    vi.mocked(api.erasePatient).mockResolvedValue({
      patientId: 'patient-1',
      erasedConsultationIds: ['consultation-1'],
    })

    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I understand this erases/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Erase 1' }))

    await waitFor(() => expect(api.erasePatient).toHaveBeenCalledWith('patient-1'))
    // Staying would leave the doctor reading a page of blanked fields, which
    // looks like a failure rather than like the erasure working.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/patients'))
  })

  it('keeps the destructive control away from Start Consultation', async () => {
    // Both are consequential and they point in opposite directions, so the
    // erase control sits at the foot of the page rather than in the header
    // beside the button a doctor presses on every visit.
    setup()
    await screen.findByText('Aisha Rahman')

    const start = screen.getAllByRole('button', { name: /start consultation/i })[0]
    const erase = screen.getByRole('button', { name: /erase patient record/i })
    if (!start) throw new Error('expected a start control')

    expect(start.compareDocumentPosition(erase) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
