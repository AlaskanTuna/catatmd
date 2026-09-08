import type { ConsultationListItem, ConsultationStatus } from '@shared/types'
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

const row = (status: ConsultationStatus, n: number): ConsultationListItem => ({
  id: `${status}-${n}`,
  status,
  title: `${status} visit ${n}`,
  createdAt: new Date(2026, 7, n),
  updatedAt: new Date(2026, 7, n),
})

const rows = (status: ConsultationStatus, n: number): ConsultationListItem[] =>
  Array.from({ length: n }, (_, i) => row(status, i + 1))

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

function pickCategory(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Consultation View' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}

describe('ConsultationList categories', () => {
  beforeEach(() => {
    vi.mocked(api.listConsultations).mockReset()
    vi.mocked(api.listConsultations).mockResolvedValue([])
  })

  it('offers Draft, Awaiting Review and Approved, in that order, defaulting to Draft', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue([row('approved', 1)])
    setup()

    const trigger = screen.getByRole('button', { name: 'Consultation View' })
    expect(trigger.textContent).toContain('Draft')

    fireEvent.click(trigger)
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Draft',
      'Awaiting Review',
      'Approved',
    ])
  })

  it('shows analysing consultations under Draft', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue([
      row('draft', 1),
      row('analyzing', 1),
      row('awaiting_review', 1),
      row('approved', 1),
    ])
    setup()

    expect(await screen.findByText('draft visit 1')).toBeTruthy()
    expect(screen.getByText('analyzing visit 1')).toBeTruthy()
    expect(screen.queryByText('awaiting_review visit 1')).toBeNull()
    expect(screen.queryByText('approved visit 1')).toBeNull()
  })

  it('paginates a category at fifteen rows and resets to page one on category change', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue([
      ...rows('awaiting_review', 16),
      ...rows('approved', 16),
    ])
    setup()
    await screen.findByText('No drafts. Start a consultation to begin one.')

    pickCategory('Awaiting Review')

    expect(await screen.findAllByText(/awaiting_review visit/)).toHaveLength(15)
    expect(screen.getByText('awaiting_review visit 1')).toBeTruthy()
    expect(screen.queryByText('awaiting_review visit 16')).toBeNull()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('awaiting_review visit 16')).toBeTruthy()
    expect(screen.queryByText('awaiting_review visit 1')).toBeNull()
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()

    pickCategory('Approved')
    expect(await screen.findByText('approved visit 1')).toBeTruthy()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    expect(screen.queryByText('approved visit 16')).toBeNull()
  })

  it('hides the pagination control when a category fits on one page', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue(rows('awaiting_review', 15))
    setup()

    pickCategory('Awaiting Review')

    expect(await screen.findByText('awaiting_review visit 15')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull()
  })

  it('says the draft empty sentence when no drafts or analyses exist', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue([row('awaiting_review', 1)])
    setup()

    expect(await screen.findByText('No drafts. Start a consultation to begin one.')).toBeTruthy()
  })

  it('says the review and approved empty sentences when those views hold no rows', async () => {
    vi.mocked(api.listConsultations).mockResolvedValue([row('draft', 1)])
    setup()
    await screen.findByText('draft visit 1')

    pickCategory('Awaiting Review')
    expect(await screen.findByText('Nothing is waiting for review.')).toBeTruthy()

    pickCategory('Approved')
    expect(await screen.findByText('No approved consultations yet.')).toBeTruthy()
  })
})
