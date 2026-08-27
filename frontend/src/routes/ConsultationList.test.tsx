import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { ConsultationList } from './ConsultationList.js'

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    listConsultations: vi.fn(),
    eraseConsultations: vi.fn(),
    patch: vi.fn(),
    // Reached through the start dialog this page now mounts. Its query stays
    // disabled until the dialog is opened and asked for an existing patient,
    // but the hook still wants a function to exist.
    listPatients: vi.fn(),
    createConsultation: vi.fn(),
  },
}))

const CONSULTATIONS = [
  {
    id: 'draft-1',
    status: 'draft' as const,
    title: 'Draft visit',
    createdAt: new Date('2026-08-24T06:00:00.000Z'),
    updatedAt: new Date('2026-08-24T06:00:00.000Z'),
  },
  {
    id: 'review-1',
    status: 'awaiting_review' as const,
    title: 'Review visit',
    createdAt: new Date('2026-08-25T06:00:00.000Z'),
    updatedAt: new Date('2026-08-25T06:00:00.000Z'),
  },
  {
    id: 'analysing-1',
    status: 'analyzing' as const,
    title: 'Analysing visit',
    createdAt: new Date('2026-08-26T06:00:00.000Z'),
    updatedAt: new Date('2026-08-26T06:00:00.000Z'),
  },
  {
    id: 'approved-1',
    status: 'approved' as const,
    title: 'Filed visit',
    createdAt: new Date('2026-08-27T06:00:00.000Z'),
    updatedAt: new Date('2026-08-27T06:00:00.000Z'),
  },
]

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ConsultationList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ConsultationList work queue', () => {
  beforeEach(() => {
    vi.mocked(api.listConsultations).mockReset()
    vi.mocked(api.listConsultations).mockResolvedValue(CONSULTATIONS)
  })

  it('defaults to drafts and consultations awaiting review', async () => {
    setup()

    expect(await screen.findByText('Draft visit')).toBeTruthy()
    expect(screen.getByText('Review visit')).toBeTruthy()
    expect(screen.queryByText('Analysing visit')).toBeNull()
    expect(screen.queryByText('Filed visit')).toBeNull()
  })

  it('offers a visible control to show all consultations', async () => {
    setup()
    await screen.findByText('Draft visit')

    fireEvent.click(screen.getByRole('button', { name: 'Consultation View' }))
    fireEvent.click(screen.getByRole('option', { name: 'All Consultations' }))

    expect(screen.getByText('Analysing visit')).toBeTruthy()
    expect(screen.getByText('Filed visit')).toBeTruthy()
  })

  it('explains where filed work belongs when nothing needs attention', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue(CONSULTATIONS.slice(3))
    setup()

    expect(await screen.findByText('No Consultations Need Attention')).toBeTruthy()
    expect(screen.getByText(/approved filing belongs on patient profiles/i)).toBeTruthy()
  })
})
