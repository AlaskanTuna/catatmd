import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { PatientDetail } from './PatientDetail.js'

vi.mock('../lib/api.js', () => ({
  api: {
    getPatient: vi.fn(),
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
  })

  it('renders unrecorded patient fields honestly', async () => {
    setup()

    expect(await screen.findByText('Aisha Rahman')).toBeTruthy()
    expect(screen.getAllByText('Not recorded')).toHaveLength(3)
  })

  it('starts a consultation filed to this patient', async () => {
    setup()

    const start = await screen.findByRole('link', { name: 'Start Consultation' })
    expect(start.getAttribute('href')).toBe('/consultations/new?patientId=patient-1')
  })

  it('shows this patient consultation history as consultation rows', async () => {
    setup()

    const history = await screen.findByRole('link', { name: /acute cough/i })
    expect(history.getAttribute('href')).toBe('/consultations/consultation-1')
    expect(screen.getByText('Approved')).toBeTruthy()
  })
})
