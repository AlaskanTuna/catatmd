import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { PatientList } from './PatientList.js'

vi.mock('../lib/api.js', () => ({
  api: {
    listPatients: vi.fn(),
  },
}))

const PATIENTS = [
  {
    id: 'patient-1',
    name: 'Aisha Rahman',
    age: 36,
    gender: 'female' as const,
    erasedAt: null,
    createdAt: '2026-08-20T06:00:00.000Z',
    updatedAt: '2026-08-27T06:00:00.000Z',
    consultationCount: 2,
    lastSeenAt: '2026-08-26T06:00:00.000Z',
  },
  {
    id: 'patient-2',
    name: 'Kumar Nair',
    age: null,
    gender: null,
    erasedAt: null,
    createdAt: '2026-08-21T06:00:00.000Z',
    updatedAt: '2026-08-21T06:00:00.000Z',
    consultationCount: 0,
    lastSeenAt: null,
  },
]

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <PatientList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PatientList', () => {
  beforeEach(() => {
    vi.mocked(api.listPatients).mockReset()
    vi.mocked(api.listPatients).mockResolvedValue(PATIENTS)
  })

  it('shows the patient directory columns without exposing NRIC', async () => {
    setup()

    expect(await screen.findByText('Aisha Rahman')).toBeTruthy()
    for (const heading of ['Name', 'Age', 'Gender', 'Visits', 'Last Seen']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy()
    }
    expect(screen.queryByRole('columnheader', { name: /nric/i })).toBeNull()
  })

  it('shows the latest visit date and distinguishes patients not yet seen', async () => {
    setup()

    const seen = await screen.findByRole('row', { name: /Aisha Rahman/ })
    const unseen = screen.getByRole('row', { name: /Kumar Nair/ })
    expect(within(seen).getByText('26 Aug 2026')).toBeTruthy()
    expect(within(unseen).getByText('Not seen yet')).toBeTruthy()
  })

  it('searches patients by name', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.change(screen.getByRole('searchbox', { name: /search patients/i }), {
      target: { value: 'kumar' },
    })

    expect(screen.queryByText('Aisha Rahman')).toBeNull()
    expect(screen.getByText('Kumar Nair')).toBeTruthy()
  })

  it('filters by whether a patient has visit history', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.click(screen.getByRole('button', { name: /filter by visit history/i }))
    fireEvent.click(screen.getByRole('option', { name: 'No Visits' }))

    expect(screen.queryByText('Aisha Rahman')).toBeNull()
    expect(screen.getByText('Kumar Nair')).toBeTruthy()
  })

  it('supports selecting several patient rows', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Aisha Rahman' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Kumar Nair' }))

    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Selection' }))
    await waitFor(() => expect(screen.getByText('Select all')).toBeTruthy())
  })
})
