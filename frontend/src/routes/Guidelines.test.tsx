import type { GuidelineChunk, GuidelineDocument } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { Guidelines } from './Guidelines.js'

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    guidelines: vi.fn(),
    guidelineDocuments: vi.fn(),
  },
}))

const CHUNK: GuidelineChunk = {
  id: 'nice-ng120-cough',
  title: 'NICE Acute Cough Guideline',
  publisher: 'NICE',
  year: 2023,
  url: 'https://example.com/nice-cough',
  summary: 'A curated summary.',
  sourceLicence: 'CC-BY',
  verbatimAllowed: true,
}

const URTI_DOCUMENT: GuidelineDocument = {
  id: 'cpg-urti',
  title: 'CPG Management of Upper Respiratory Tract Infection',
  publisher: 'MOH Malaysia',
  year: 2024,
  sourceUrl: 'https://example.com/cpg-urti.pdf',
  jurisdiction: 'Malaysia',
  sourceLicence: 'All rights reserved',
  pageCount: 88,
  chunkCount: 412,
  ingestedAt: new Date('2026-09-01T00:00:00.000Z'),
}

const SORE_THROAT_DOCUMENT: GuidelineDocument = {
  ...URTI_DOCUMENT,
  id: 'cpg-sore-throat',
  title: 'CPG Management of Sore Throat',
  sourceUrl: 'https://example.com/cpg-sore-throat.pdf',
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Guidelines />
    </QueryClientProvider>,
  )
}

describe('the CPG document library', () => {
  beforeEach(() => {
    vi.mocked(api.guidelines).mockReset()
    vi.mocked(api.guidelines).mockResolvedValue([CHUNK])
    vi.mocked(api.guidelineDocuments).mockReset()
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT])
  })

  it('lists ingested documents in their own section', async () => {
    setup()

    expect(
      await screen.findByRole('heading', { name: 'Malaysian Clinical Practice Guidelines' }),
    ).toBeTruthy()
    expect(
      await screen.findByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
    expect(screen.getByText('88 pages')).toBeTruthy()
    expect(screen.getByText('412 chunks')).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: /source/i })
        .some((link) => link.getAttribute('href') === 'https://example.com/cpg-urti.pdf'),
    ).toBe(true)
  })

  it('says when no CPG documents have been ingested', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    expect(await screen.findByText('No CPG documents ingested yet.')).toBeTruthy()
  })

  it('filters documents by title through the corpus search box', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT, SORE_THROAT_DOCUMENT])
    setup()
    await screen.findByText('CPG Management of Sore Throat')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'respiratory' },
    })

    expect(screen.getByText('CPG Management of Upper Respiratory Tract Infection')).toBeTruthy()
    expect(screen.queryByText('CPG Management of Sore Throat')).toBeNull()
  })
})
