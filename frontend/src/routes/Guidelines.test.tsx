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

    const cpgSection = screen.getByRole('region', {
      name: 'Malaysian Clinical Practice Guidelines',
    })
    expect(
      await screen.findByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
    expect(screen.getByText('88 pages')).toBeTruthy()
    expect(within(cpgSection).getByText(/1 documents/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /open guideline/i }).getAttribute('href')).toBe(
      'https://example.com/cpg-urti.pdf',
    )
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

  it('renders profile chips and an Open Guideline link on each document card', async () => {
    setup()

    await screen.findByText('CPG Management of Upper Respiratory Tract Infection')
    expect(screen.getByText('adult-acute-urti')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Guideline' })).toBeTruthy()
  })

  it('lists a publisher that exists only in documents and filters both sections when selected', async () => {
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Filter by publisher' }))
    const mohOption = await screen.findByRole('option', { name: 'MOH Malaysia' })
    expect(mohOption).toBeTruthy()

    fireEvent.click(mohOption)

    expect(screen.queryByText('NICE Acute Cough Guideline')).toBeNull()
    expect(
      await screen.findByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
  })
})

describe('the lead copy', () => {
  it('shows both curated and document counts', async () => {
    vi.mocked(api.guidelines).mockResolvedValue([
      CHUNK,
      { ...CHUNK, id: 'nice-2', title: 'NICE 2' },
    ])
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT, SORE_THROAT_DOCUMENT])
    setup()

    await screen.findByText('NICE Acute Cough Guideline')
    const leadCopy = screen.getByText(/Free-text references are rejected/)
    expect(leadCopy.textContent).toMatch(/2 curated entries/)
    expect(leadCopy.textContent).toMatch(/2 documents/)
  })
})

describe('the curated corpus pagination', () => {
  it('shows the first six chunks on page one and the next page reveals the rest', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(7))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    for (let index = 1; index <= 6; index++) {
      expect(await screen.findByText(`Guideline ${index}`)).toBeTruthy()
    }
    expect(screen.queryByText('Guideline 7')).toBeNull()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(await screen.findByText('Guideline 7')).toBeTruthy()
    expect(screen.queryByText('Guideline 1')).toBeNull()
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  })

  it('resets to the first page when the search query changes', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(7))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    await screen.findByText('Guideline 6')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Guideline 7')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'Guideline' },
    })

    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()
    expect(await screen.findByText('Guideline 1')).toBeTruthy()
    expect(screen.queryByText('Guideline 7')).toBeNull()
  })

  it('hides pagination for a single page of chunks', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(6))
    vi.mocked(api.guidelineDocuments).mockResolvedValue([])
    setup()

    expect(await screen.findByText('Guideline 6')).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })
})

describe('the CPG document pagination', () => {
  it('pages documents independently of the curated corpus', async () => {
    vi.mocked(api.guidelines).mockResolvedValue(makeChunks(7))
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
    setup()

    await screen.findByText('CPG Document 1')

    const cpgSection = screen.getByRole('region', {
      name: 'Malaysian Clinical Practice Guidelines',
    })
    const corpusSection = screen.getByRole('region', { name: 'Curated corpus pagination' })

    for (let index = 1; index <= 6; index++) {
      expect(screen.getByText(`CPG Document ${index}`)).toBeTruthy()
    }
    expect(screen.queryByText('CPG Document 7')).toBeNull()
    expect(within(cpgSection).getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(within(cpgSection).getByRole('button', { name: 'Next page' }))

    expect(await within(cpgSection).findByText('CPG Document 7')).toBeTruthy()
    expect(within(cpgSection).queryByText('CPG Document 1')).toBeNull()
    expect(within(cpgSection).getByText('Page 2 of 2')).toBeTruthy()

    expect(screen.getByText('Guideline 1')).toBeTruthy()
    expect(screen.queryByText('Guideline 7')).toBeNull()

    fireEvent.click(within(corpusSection).getByRole('button', { name: 'Next page' }))

    expect(await screen.findByText('Guideline 7')).toBeTruthy()
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

  it('scrolls the section heading into view when paging documents', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const scrollIntoViewSpy = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoViewSpy,
      configurable: true,
      writable: true,
    })
    try {
      vi.mocked(api.guidelines).mockResolvedValue([CHUNK])
      vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
      setup()

      await screen.findByText('CPG Document 1')

      const cpgSection = screen.getByRole('region', {
        name: 'Malaysian Clinical Practice Guidelines',
      })
      fireEvent.click(within(cpgSection).getByRole('button', { name: 'Next page' }))

      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
      expect(scrollIntoViewSpy.mock.instances[0]).toBe(
        screen.getByRole('heading', { name: 'Malaysian Clinical Practice Guidelines' }),
      )
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalDescriptor)
      } else {
        delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView
      }
    }
  })
})
