import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsultationReportPage } from './ConsultationReportPage.js'

vi.mock('../demo/DemoTour.js', () => ({ DEMO_CONSULTATION_ID: 'demo-ephemeral' }))

const unapprovedDetail = {
  id: 'demo-ephemeral',
  status: 'awaiting_review',
  title: null,
  createdAt: '2026-09-20T01:00:00.000Z',
  updatedAt: '2026-09-20T01:00:00.000Z',
  transcript: null,
  analysis: null,
  editedNote: null,
  approvedAt: null,
  approvedBy: null,
  acknowledgedRedFlagIds: [],
  reviewedGapIds: [],
  redFlagDispositions: [],
  gapDispositions: [],
}

describe('ephemeral consultation report', () => {
  it('sends an unapproved handover back to review', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/consultations/demo-ephemeral/report',
              state: { detail: unapprovedDetail },
            },
          ]}
        >
          <Routes>
            <Route path="/consultations/:id/report" element={<ConsultationReportPage />} />
            <Route path="/consultations/:id" element={<p>Review page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Review page')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Consultation Report' })).toBeNull()
  })
})
