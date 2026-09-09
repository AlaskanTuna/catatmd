import type { GuidelineDocument } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { Guidelines } from './Guidelines.js'

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    guidelineDocuments: vi.fn(),
  },
}))

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
  verbatimAllowed: false,
}

const SORE_THROAT_DOCUMENT: GuidelineDocument = {
  ...URTI_DOCUMENT,
  id: 'cpg-sore-throat',
  title: 'CPG Management of Sore Throat',
  sourceUrl: 'https://example.com/cpg-sore-throat.pdf',
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
    vi.mocked(api.guidelineDocuments).mockReset()
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT])
  })

  it('lists ingested documents in their own section', async () => {
    setup()

    const cpgSection = await screen.findByRole('region', {
      name: 'Malaysian Clinical Practice Guidelines',
    })
    expect(
      await screen.findByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
    expect(screen.getByText('88 pages')).toBeTruthy()
    expect(screen.getByText('1 documents')).toBeTruthy()
    expect(screen.getByRole('link', { name: /open guideline/i }).getAttribute('href')).toBe(
      'https://example.com/cpg-urti.pdf',
    )
    expect(
      within(cpgSection).getByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
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

  it('lists a publisher and filters the documents when selected', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([
      URTI_DOCUMENT,
      { ...SORE_THROAT_DOCUMENT, publisher: 'NICE' },
    ])
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Filter by publisher' }))
    const mohOption = await screen.findByRole('option', { name: 'MOH Malaysia' })
    expect(mohOption).toBeTruthy()

    fireEvent.click(mohOption)

    expect(screen.queryByText('CPG Management of Sore Throat')).toBeNull()
    expect(
      await screen.findByText('CPG Management of Upper Respiratory Tract Infection'),
    ).toBeTruthy()
  })
})

describe('the lead copy', () => {
  it('shows the in-scope document count and omits any curated copy', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([
      URTI_DOCUMENT,
      { ...SORE_THROAT_DOCUMENT, profiles: [] },
    ])
    setup()

    await screen.findByText('CPG Management of Upper Respiratory Tract Infection')
    const leadCopy = screen.getByText(/Free-text references are rejected/)
    expect(leadCopy.textContent).toMatch(/1 of the 2 documents/)
    expect(leadCopy.textContent).not.toMatch(/curated/)
  })

  it('shows when each document was ingested', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT])
    setup()

    expect(await screen.findByText(/Ingested 1 Sept 2026/)).toBeTruthy()
  })
})

describe('the CPG document pagination', () => {
  it('shows the first six documents on page one and the next page reveals the rest', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
    setup()

    for (let index = 1; index <= 6; index++) {
      expect(await screen.findByText(`CPG Document ${index}`)).toBeTruthy()
    }
    expect(screen.queryByText('CPG Document 7')).toBeNull()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(await screen.findByText('CPG Document 7')).toBeTruthy()
    expect(screen.queryByText('CPG Document 1')).toBeNull()
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  })

  it('resets to the first page when the search query changes', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
    setup()

    await screen.findByText('CPG Document 6')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('CPG Document 7')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'Document' },
    })

    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()
    expect(await screen.findByText('CPG Document 1')).toBeTruthy()
    expect(screen.queryByText('CPG Document 7')).toBeNull()
  })

  it('hides pagination for a single page of documents', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(6))
    setup()

    expect(await screen.findByText('CPG Document 6')).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })

  it('does not show pagination when no documents match the search', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([URTI_DOCUMENT])
    setup()

    await screen.findByText('CPG Management of Upper Respiratory Tract Infection')

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'no-such-match' },
    })

    expect(await screen.findByText(/Nothing in the library matches that./)).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
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
      vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
      setup()

      await screen.findByText('CPG Document 1')

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

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
