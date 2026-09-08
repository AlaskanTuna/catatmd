import type { GuidelineChunk, GuidelineDocument } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  profiles: ['adult-acute-urti'],
  verbatimAllowed: true,
}

const SORE_THROAT_DOCUMENT: GuidelineDocument = {
  ...URTI_DOCUMENT,
  id: 'cpg-sore-throat',
  title: 'CPG Management of Sore Throat',
  sourceUrl: 'https://example.com/cpg-sore-throat.pdf',
}

function makeChunks(count: number): GuidelineChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    ...CHUNK,
    id: `chunk-${index + 1}`,
    title: `Guideline ${index + 1}`,
    summary: `Summary ${index + 1}`,
  }))
}

function makeDocuments(count: number): GuidelineDocument[] {
  return Array.from({ length: count }, (_, index) => ({
    ...URTI_DOCUMENT,
    id: `cpg-${index + 1}`,
    title: `CPG Document ${index + 1}`,
  }))
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

describe('the curated corpus pagination', () => {
  it('shows the first twelve chunks on page one and the next page reveals the rest', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(13))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    for (let index = 1; index <= 12; index++) {
      expect(await screen.findByText(`Guideline ${index}`)).toBeTruthy()
    }
    expect(screen.queryByText('Guideline 13')).toBeNull()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(await screen.findByText('Guideline 13')).toBeTruthy()
    expect(screen.queryByText('Guideline 1')).toBeNull()
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  })

  it('resets to the first page when the search query changes', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(13))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    await screen.findByText('Guideline 12')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Guideline 13')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'Guideline' },
    })

    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()
    expect(await screen.findByText('Guideline 1')).toBeTruthy()
    expect(screen.queryByText('Guideline 13')).toBeNull()
  })

  it('hides pagination for a single page of chunks', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(12))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    expect(await screen.findByText('Guideline 12')).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })
})

describe('the CPG document pagination', () => {
  it('pages documents independently of the curated corpus', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(13))
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(16))
    setup()

    await screen.findByText('CPG Document 1')

    const cpgSection = screen.getByRole('region', {
      name: 'Malaysian Clinical Practice Guidelines',
    })
    const corpusSection = screen.getByRole('region', { name: 'Curated corpus pagination' })

    for (let index = 1; index <= 15; index++) {
      expect(screen.getByText(`CPG Document ${index}`)).toBeTruthy()
    }
    expect(screen.queryByText('CPG Document 16')).toBeNull()
    expect(within(cpgSection).getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(within(cpgSection).getByRole('button', { name: 'Next page' }))

    expect(await within(cpgSection).findByText('CPG Document 16')).toBeTruthy()
    expect(within(cpgSection).queryByText('CPG Document 1')).toBeNull()
    expect(within(cpgSection).getByText('Page 2 of 2')).toBeTruthy()

    expect(screen.getByText('Guideline 1')).toBeTruthy()
    expect(screen.queryByText('Guideline 13')).toBeNull()

    fireEvent.click(within(corpusSection).getByRole('button', { name: 'Next page' }))

    expect(await screen.findByText('Guideline 13')).toBeTruthy()
    expect(within(cpgSection).getByText('Page 2 of 2')).toBeTruthy()
  })

  it('does not show pagination when no documents match the search', async () => {
    vi.mocked(api.guidelines).mockResolvedValue([CHUNK])
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT])
    setup()

    await screen.findByText('CPG Management of Upper Respiratory Tract Infection')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'no-such-match' },
    })

    expect(await screen.findByText('No CPG documents match that search.')).toBeTruthy()
    expect(screen.queryByText('Page 1 of 1')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })
})
