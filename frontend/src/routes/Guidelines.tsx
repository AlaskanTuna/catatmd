import type { GuidelineDocument } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'
import { clampPage, Pagination, paginate } from '../ui/Pagination.js'
import { Select } from '../ui/Select.js'

/**
 * The citation corpus, made browsable.
 *
 * This page exists because the corpus is the load-bearing half of a safety
 * claim the product makes everywhere else. "The model may only cite guideline
 * IDs supplied to it" is a strong statement, and it is only checkable if the
 * reader can see the supplied set.
 */

const ALL_SOURCES = 'all'

const SOURCE_ORDER = [
  'Ministry of Health Malaysia',
  'Abdullah et al., Infection and Drug Resistance',
  'Ooi et al., Malaysian Family Physician',
  'Malaysian Clinical Practice Guidelines',
]

const DOCUMENT_PAGE_SIZE = 6

const formatIngested = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    value,
  )

function sourceOf(document: GuidelineDocument): string {
  if (document.id === 'moh-nag-2024') return 'Ministry of Health Malaysia'
  if (document.id === 'abdullah-2024-idr-sore-throat')
    return 'Abdullah et al., Infection and Drug Resistance'
  if (document.id === 'ooi-2022-mfp-urti') return 'Ooi et al., Malaysian Family Physician'
  return 'Malaysian Clinical Practice Guidelines'
}

function formatProfile(profile: string): string {
  return profile
    .split('-')
    .map((token) => {
      if (token === 'urti') return 'URTI'
      if (token === 'uti') return 'UTI'
      return token
    })
    .join(' ')
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0] ?? ''} and ${items[1] ?? ''}`
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

function formatDescription(document: GuidelineDocument): string {
  const source = sourceOf(document)
  const sourceLabel = source.endsWith('Guidelines') ? source : `${source} guideline`
  const pagePhrase = document.pageCount > 0 ? `${document.pageCount} pages` : 'no page count'
  const ingested = formatIngested(document.ingestedAt)
  const tagSentence =
    document.profiles.length > 0
      ? `Tagged for ${formatList(document.profiles.map(formatProfile))}.`
      : 'Not yet tagged for a consultation scope, so it is not retrieved.'
  return `${sourceLabel}, ${pagePhrase}, ingested ${ingested}. ${tagSentence}`
}

function matchesDocument(document: GuidelineDocument, query: string) {
  const haystack =
    `${document.id} ${document.title} ${sourceOf(document)} ${document.sourceLicence}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function Guidelines() {
  const documents = useQuery({
    queryKey: ['guideline-documents'],
    queryFn: api.guidelineDocuments,
  })
  const [query, setQuery] = useState('')
  const [source, setSource] = useState(ALL_SOURCES)
  const [documentPage, setDocumentPage] = useState(1)

  const allDocuments = useMemo(() => documents.data ?? [], [documents.data])

  const sources = useMemo(() => {
    const present = new Set(allDocuments.map(sourceOf))
    return [
      { value: ALL_SOURCES, label: 'All Sources' },
      ...SOURCE_ORDER.filter((name) => present.has(name)).map((name) => ({
        value: name,
        label: name,
      })),
    ]
  }, [allDocuments])

  const filtering = query.trim() !== '' || source !== ALL_SOURCES

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setDocumentPage(1)
  }

  const handleSourceChange = (value: string) => {
    setSource(value)
    setDocumentPage(1)
  }

  const filteredDocuments = useMemo(
    () =>
      allDocuments.filter(
        (document) =>
          (source === ALL_SOURCES || sourceOf(document) === source) &&
          matchesDocument(document, query),
      ),
    [allDocuments, source, query],
  )

  const documentPageCount = useMemo(
    () => Math.ceil(filteredDocuments.length / DOCUMENT_PAGE_SIZE),
    [filteredDocuments],
  )
  const currentDocumentPage = clampPage(documentPage, documentPageCount)
  const pagedDocuments = useMemo(
    () => paginate(filteredDocuments, currentDocumentPage, DOCUMENT_PAGE_SIZE),
    [filteredDocuments, currentDocumentPage],
  )

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Guideline Documents"
        subtitle="The closed set of source documents the model may cite. Anything outside it fails validation."
        art="/art/guidelines.webp"
      />

      {documents.isPending && (
        <div className="mt-6 flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-card" />
          ))}
        </div>
      )}

      {documents.data && (
        <div data-tour="corpus">
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search by title, source or ID"
                aria-label="Search the guideline corpus"
                className="h-11 w-full rounded-control border border-line bg-surface pr-10 pl-10 text-sm text-ink transition-colors duration-150 hover:border-accent focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => handleQueryChange('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </div>

            <Select
              label="Filter by source"
              value={source}
              options={sources}
              onChange={handleSourceChange}
              className="sm:w-56"
            />
          </div>

          <p aria-live="polite" className="mt-3 text-sm text-ink-muted">
            {filtering
              ? `Showing ${filteredDocuments.length} of ${allDocuments.length} documents`
              : `${allDocuments.length} documents`}
          </p>

          {filtering && filteredDocuments.length === 0 && (
            <Card className="mt-4 p-6 text-center">
              <p className="text-sm text-ink-muted">
                Nothing in the library matches that. The set is deliberately small and narrow, so a
                miss usually means the topic is outside this prototype&rsquo;s scope rather than
                that the search failed.
              </p>
            </Card>
          )}

          {filteredDocuments.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {pagedDocuments.map((document) => (
                <Card key={document.id} className="p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-semibold leading-snug">{document.title}</h3>
                    <span className="text-sm text-ink-muted">{document.year}</span>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {formatDescription(document)}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <code className="rounded-control bg-sunken px-2 py-1 font-mono text-2xs text-ink-muted">
                      {document.id}
                    </code>
                    <span className="text-2xs text-ink-muted">{document.sourceLicence}</span>
                    {document.profiles.map((profile) => (
                      <code
                        key={profile}
                        className="rounded-control bg-sunken px-2 py-1 font-mono text-2xs text-ink-muted"
                      >
                        {profile}
                      </code>
                    ))}
                    <a
                      href={document.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
                    >
                      Source
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  </div>
                </Card>
              ))}

              <Pagination
                page={currentDocumentPage}
                pageCount={documentPageCount}
                onPageChange={setDocumentPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
