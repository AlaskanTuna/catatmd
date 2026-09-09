import type { GuidelineDocument } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Card, Skeleton } from '../ui/Card.js'
import { InfoTip } from '../ui/InfoTip.js'
import { PageHeader } from '../ui/PageHeader.js'
import { clampPage, Pagination, paginate } from '../ui/Pagination.js'
import { Select } from '../ui/Select.js'

/**
 * The citation corpus, made browsable.
 *
 * This page exists because the corpus is the load-bearing half of a safety
 * claim the product makes everywhere else. "The model may only cite guideline
 * IDs supplied to it" is a strong statement, and it is only checkable if the
 * reader can see the supplied set. Showing it turns a claim into something a
 * reviewer can audit in a minute: here is the whole closed set, here is where
 * each entry came from, and anything outside it fails schema validation.
 */

const ALL_PUBLISHERS = 'all'
const formatIngested = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    value,
  )

const DOCUMENT_PAGE_SIZE = 6

function matchesDocument(document: GuidelineDocument, query: string) {
  const haystack = `${document.title} ${document.publisher}`.toLowerCase()
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
  const [publisher, setPublisher] = useState(ALL_PUBLISHERS)
  const [documentPage, setDocumentPage] = useState(1)
  const cpgHeadingRef = useRef<HTMLHeadingElement | null>(null)

  const allDocuments = useMemo(() => documents.data ?? [], [documents.data])
  // Retrieval only reaches documents tagged with the consultation's profile;
  // an untagged document is in the library but never in the citation set.
  const inScopeDocuments = useMemo(
    () => allDocuments.filter((document) => document.profiles.length > 0),
    [allDocuments],
  )

  const publishers = useMemo(
    () => [
      { value: ALL_PUBLISHERS, label: 'All Publishers' },
      ...[...new Set(allDocuments.map((document) => document.publisher))]
        .sort()
        .map((name) => ({ value: name, label: name })),
    ],
    [allDocuments],
  )

  const filtering = query.trim() !== '' || publisher !== ALL_PUBLISHERS

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setDocumentPage(1)
  }

  const handlePublisherChange = (value: string) => {
    setPublisher(value)
    setDocumentPage(1)
  }

  const filteredDocuments = useMemo(
    () =>
      allDocuments.filter(
        (document) =>
          (publisher === ALL_PUBLISHERS || document.publisher === publisher) &&
          matchesDocument(document, query),
      ),
    [allDocuments, publisher, query],
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
        <>
          {/*
            The claim, not the essay.

            This was a five-line paragraph in its own card, and four of those
            lines explained rather than asserted. What has to be visible is the
            claim a reader came here to check, and the count that makes it
            checkable; how parse-time rejection works and who wrote the
            summaries are elaboration, and elaboration belongs behind the tip.

            `data-tour="corpus"` stays on this element: the tour points a
            coachmark at it, and moving the anchor would leave the final step
            highlighting nothing.
          */}
          <Card data-tour="corpus" className="mt-6 flex items-start gap-2 p-5">
            <p className="text-sm leading-relaxed text-ink-muted">
              A suggestion carries a guideline ID, never free text. The model may cite passages
              retrieved from the{' '}
              <span className="font-medium text-ink">
                {inScopeDocuments.length} of the {allDocuments.length} documents
              </span>{' '}
              below that are tagged for a consultation&apos;s clinical scope. Free-text references
              are rejected.
            </p>
            <InfoTip label="How the citation constraint is enforced" align="right">
              The request-time schema narrows the citation field to exactly the document IDs above,
              so a reference naming anything else fails validation inside the adapter and the
              suggestion never reaches the doctor. It is rejected at parse time rather than caught
              in review, which is what makes a hallucinated reference structurally impossible rather
              than merely unlikely. Only attribution is shown here; follow each link for the
              document itself.
            </InfoTip>
          </Card>

          {/* Search narrows what is shown, never what the model is given. The
              count below stays at the full library size for that reason: it is a
              claim about the closed set, and a number that moved with the filter
              would quietly turn it into a lie. */}
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
                placeholder="Search by title or publisher"
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
              label="Filter by publisher"
              value={publisher}
              options={publishers}
              onChange={handlePublisherChange}
              className="sm:w-56"
            />
          </div>

          {/* Announced politely rather than silently re-rendered: a filter that
              changes the list under a screen-reader user without saying so
              leaves them reading a page that is no longer the one they heard. */}
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

          <section className="mt-10" aria-labelledby="cpg-documents-heading">
            <h2 id="cpg-documents-heading" ref={cpgHeadingRef} className="text-base font-semibold">
              Malaysian Clinical Practice Guidelines
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Retrieved per consultation from the ingested CPG library; the assistant may cite a
              span only when it was retrieved for that consultation.
            </p>

            {documents.data && allDocuments.length === 0 && (
              <p className="mt-4 text-sm text-ink-muted">No CPG documents ingested yet.</p>
            )}

            {filteredDocuments.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {pagedDocuments.map((document) => (
                  <Card key={document.id} className="p-5">
                    <h3 className="font-semibold leading-snug">{document.title}</h3>

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="text-2xs text-ink-muted">
                        {document.publisher} · {document.year}
                      </span>
                      {document.profiles.map((profile) => (
                        <code
                          key={profile}
                          className="rounded-control bg-sunken px-2 py-1 font-mono text-2xs text-ink-muted"
                        >
                          {profile}
                        </code>
                      ))}
                      {document.pageCount > 0 && (
                        <span className="text-2xs text-ink-muted">{document.pageCount} pages</span>
                      )}
                      <span className="text-2xs text-ink-muted">
                        Ingested {formatIngested(document.ingestedAt)}
                      </span>
                      <a
                        href={document.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
                      >
                        Open Guideline
                        <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                    </div>
                  </Card>
                ))}

                <nav aria-labelledby="cpg-documents-pagination-heading">
                  <h3 id="cpg-documents-pagination-heading" className="sr-only">
                    CPG documents pagination
                  </h3>
                  <Pagination
                    page={currentDocumentPage}
                    pageCount={documentPageCount}
                    onPageChange={setDocumentPage}
                    scrollTo={cpgHeadingRef}
                  />
                </nav>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
