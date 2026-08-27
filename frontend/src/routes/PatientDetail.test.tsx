import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { PatientDetail } from './PatientDetail.js'

vi.mock('../lib/api.js', () => ({
  api: {
    getPatient: vi.fn(),
    createConsultation: vi.fn(),
  },
}))

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
