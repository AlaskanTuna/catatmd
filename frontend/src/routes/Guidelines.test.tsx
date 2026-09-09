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

const ALL_SOURCES = 'All Sources'
const MINISTRY_OF_HEALTH_MALAYSIA = 'Ministry of Health Malaysia'
const ABDULLAH_ET_AL = 'Abdullah et al., Infection and Drug Resistance'
const OOI_ET_AL = 'Ooi et al., Malaysian Family Physician'
const MALAYSIAN_CPG = 'Malaysian Clinical Practice Guidelines'

const MOH_DOCUMENT: GuidelineDocument = {
  id: 'moh-nag-2024',
  title: 'National Antimicrobial Guideline (NAG) 2024, 4th Edition',
  publisher: 'MOH Malaysia',
  year: 2024,
  sourceUrl: 'https://sites.google.com/moh.gov.my/nag',
  jurisdiction: 'Malaysia',
  sourceLicence: 'MOH-ARR',
  pageCount: 623,
  chunkCount: 100,
  ingestedAt: new Date('2026-09-09T00:00:00.000Z'),
  profiles: ['adult-acute-urti', 'adult-acute-uncomplicated-uti'],
  verbatimAllowed: false,
}

const ABDULLAH_DOCUMENT: GuidelineDocument = {
  id: 'abdullah-2024-idr-sore-throat',
  title:
    'Treatment of Acute Sore Throat in Malaysia: A Consensus of Multidisciplinary Recommendations Using Modified Delphi Methodology',
  publisher: 'Dove Medical Press',
  year: 2024,
  sourceUrl: 'https://doi.org/10.2147/IDR.S477038',
  jurisdiction: 'Malaysia',
  sourceLicence: 'CC-BY-NC-3.0',
  pageCount: 10,
  chunkCount: 5,
  ingestedAt: new Date('2026-09-08T00:00:00.000Z'),
  profiles: ['adult-acute-urti'],
  verbatimAllowed: true,
}

const OOI_DOCUMENT: GuidelineDocument = {
  id: 'ooi-2022-mfp-urti',
  title:
    'Patient Profile and Antibiotic Use in a Dedicated Upper Respiratory Tract Infection Clinic Based in a Primary Healthcare Setting During COVID-19 Pandemic in Malaysia: A Cross Sectional Study',
  publisher: 'Malaysian Family Physician',
  year: 2022,
  sourceUrl: 'https://doi.org/10.51866/oa.38',
  jurisdiction: 'Malaysia',
  sourceLicence: 'CC-BY-4.0',
  pageCount: 8,
  chunkCount: 4,
  ingestedAt: new Date('2026-09-07T00:00:00.000Z'),
  profiles: ['adult-acute-urti'],
  verbatimAllowed: true,
}

const CPG_DOCUMENT: GuidelineDocument = {
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

function makeDocuments(count: number): GuidelineDocument[] {
  return Array.from({ length: count }, (_, index) => ({
    ...CPG_DOCUMENT,
    id: `cpg-${index + 1}`,
    title: `CPG Document ${index + 1}`,
    sourceUrl: `https://example.com/cpg-${index + 1}.pdf`,
    ingestedAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Guidelines />
    </QueryClientProvider>,
  )
}

describe('the source dropdown', () => {
  beforeEach(() => {
    vi.mocked(api.guidelineDocuments).mockReset()
  })

  it('lists the required source options in order when every source is present', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([
      MOH_DOCUMENT,
      ABDULLAH_DOCUMENT,
      OOI_DOCUMENT,
      CPG_DOCUMENT,
    ])
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Filter by source' }))

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      ALL_SOURCES,
      MINISTRY_OF_HEALTH_MALAYSIA,
      ABDULLAH_ET_AL,
      OOI_ET_AL,
      MALAYSIAN_CPG,
    ])
  })

  it('only shows sources that have at least one document', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT, CPG_DOCUMENT])
    setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Filter by source' }))

    expect(screen.queryByRole('option', { name: ABDULLAH_ET_AL })).toBeNull()
    expect(screen.queryByRole('option', { name: OOI_ET_AL })).toBeNull()
    expect(screen.getByRole('option', { name: MINISTRY_OF_HEALTH_MALAYSIA })).toBeTruthy()
    expect(screen.getByRole('option', { name: MALAYSIAN_CPG })).toBeTruthy()
  })
})

describe('the document list', () => {
  beforeEach(() => {
    vi.mocked(api.guidelineDocuments).mockReset()
    vi.mocked(api.guidelineDocuments).mockResolvedValue([
      MOH_DOCUMENT,
      ABDULLAH_DOCUMENT,
      OOI_DOCUMENT,
      CPG_DOCUMENT,
    ])
  })

  it.each([
    [MINISTRY_OF_HEALTH_MALAYSIA, [MOH_DOCUMENT.title]],
    [ABDULLAH_ET_AL, [ABDULLAH_DOCUMENT.title]],
    [OOI_ET_AL, [OOI_DOCUMENT.title]],
    [MALAYSIAN_CPG, [CPG_DOCUMENT.title]],
  ])('filters to only %s documents', async (source, expectedTitles) => {
    setup()
    await screen.findByText(MOH_DOCUMENT.title)

    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('option', { name: source }))

    for (const title of expectedTitles) {
      expect(await screen.findByText(title)).toBeTruthy()
    }

    for (const document of [MOH_DOCUMENT, ABDULLAH_DOCUMENT, OOI_DOCUMENT, CPG_DOCUMENT]) {
      if (!expectedTitles.includes(document.title)) {
        expect(screen.queryByText(document.title)).toBeNull()
      }
    }
  })

  it('filters by the search box across the whole list', async () => {
    setup()
    await screen.findByText(MOH_DOCUMENT.title)

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'sore throat' },
    })

    expect(await screen.findByText(ABDULLAH_DOCUMENT.title)).toBeTruthy()
    expect(screen.queryByText(MOH_DOCUMENT.title)).toBeNull()
    expect(screen.queryByText(OOI_DOCUMENT.title)).toBeNull()
    expect(screen.queryByText(CPG_DOCUMENT.title)).toBeNull()
  })
})

describe('the document cards', () => {
  beforeEach(() => {
    vi.mocked(api.guidelineDocuments).mockReset()
  })

  it('shows the year, description, id chip, licence, profile chips and Source link', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT])
    setup()

    const card = await screen.findByText(MOH_DOCUMENT.title)
    const article = card.closest('article') ?? card.closest('[class*="rounded-card"]') ?? card

    expect(screen.getByText('2024')).toBeTruthy()
    expect(
      screen.getByText(/Ministry of Health Malaysia guideline, 623 pages, ingested 9 Sept 2026\./),
    ).toBeTruthy()
    expect(
      screen.getByText(/Tagged for adult acute URTI and adult acute uncomplicated UTI\./),
    ).toBeTruthy()
    expect(screen.getByText('moh-nag-2024')).toBeTruthy()
    expect(screen.getByText('MOH-ARR')).toBeTruthy()
    expect(screen.getByText('adult-acute-urti')).toBeTruthy()
    expect(screen.getByText('adult-acute-uncomplicated-uti')).toBeTruthy()

    const sourceLink = within(article as HTMLElement).getByRole('link', { name: 'Source' })
    expect(sourceLink.getAttribute('href')).toBe(MOH_DOCUMENT.sourceUrl)
    expect(sourceLink.getAttribute('target')).toBe('_blank')
    expect(sourceLink.getAttribute('rel')).toBe('noreferrer noopener')
  })

  it('describes an untagged document as not retrievable', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([{ ...CPG_DOCUMENT, profiles: [] }])
    setup()

    await screen.findByText(CPG_DOCUMENT.title)
    expect(
      screen.getByText(/Malaysian Clinical Practice Guidelines, 88 pages, ingested 1 Sept 2026\./),
    ).toBeTruthy()
    expect(
      screen.getByText(/Not yet tagged for a consultation scope, so it is not retrieved\./),
    ).toBeTruthy()
  })
})

describe('the count line', () => {
  beforeEach(() => {
    vi.mocked(api.guidelineDocuments).mockReset()
  })

  it('shows the total document count when not filtering', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT, CPG_DOCUMENT])
    setup()

    expect(await screen.findByText('2 documents')).toBeTruthy()
  })

  it('shows the filtered count when a source is selected', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT, CPG_DOCUMENT])
    setup()
    await screen.findByText(MOH_DOCUMENT.title)

    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('option', { name: MINISTRY_OF_HEALTH_MALAYSIA }))

    expect(await screen.findByText('Showing 1 of 2 documents')).toBeTruthy()
  })

  it('shows the filtered count when the search matches a subset', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT, CPG_DOCUMENT])
    setup()
    await screen.findByText(MOH_DOCUMENT.title)

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'sore throat' },
    })

    expect(await screen.findByText('Showing 0 of 2 documents')).toBeTruthy()
  })
})

describe('the pagination', () => {
  beforeEach(() => {
    vi.mocked(api.guidelineDocuments).mockReset()
    vi.stubGlobal('scrollTo', vi.fn())
  })

  it('shows six cards per page and advances to the next page', async () => {
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

  it('hides pagination when only one page matches', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(6))
    setup()

    expect(await screen.findByText('CPG Document 6')).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })

  it('hides pagination when no documents match the search', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([CPG_DOCUMENT])
    setup()
    await screen.findByText(CPG_DOCUMENT.title)

    fireEvent.change(screen.getByLabelText('Search the guideline corpus'), {
      target: { value: 'no-such-match' },
    })

    expect(await screen.findByText(/Nothing in the library matches that./)).toBeTruthy()
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
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

  it('resets to the first page when the source dropdown changes', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue([MOH_DOCUMENT, ...makeDocuments(7)])
    setup()

    await screen.findByText('CPG Document 5')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('CPG Document 7')

    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('option', { name: MALAYSIAN_CPG }))

    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()
    expect(await screen.findByText('CPG Document 6')).toBeTruthy()
    expect(screen.queryByText('CPG Document 7')).toBeNull()
    expect(screen.queryByText(MOH_DOCUMENT.title)).toBeNull()
  })

  it('scrolls to the top of the list on page change', async () => {
    vi.mocked(api.guidelineDocuments).mockResolvedValue(makeDocuments(7))
    setup()

    await screen.findByText('CPG Document 1')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('CPG Document 7')

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})
