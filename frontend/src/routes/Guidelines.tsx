import type { GuidelineChunk, GuidelineDocument } from '@shared/types'
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
 *
 * Grouping is by publisher rather than alphabetical, because the first thing
 * worth knowing about a clinical citation is who issued it. A national
 * antimicrobial guideline and a journal consensus paper carry different
 * weight, and a flat list would present them as equals.
 */

function groupByPublisher(guidelines: GuidelineChunk[]) {
  const groups = new Map<string, GuidelineChunk[]>()
  for (const guideline of guidelines) {
    const existing = groups.get(guideline.publisher)
    if (existing) existing.push(guideline)
    else groups.set(guideline.publisher, [guideline])
  }
  return [...groups.entries()]
}

const ALL_PUBLISHERS = 'all'
const CORPUS_PAGE_SIZE = 12
const DOCUMENT_PAGE_SIZE = 15

/*
 * The ID is searchable alongside the prose, and that is the point rather than a
 * convenience. A suggestion elsewhere in the app cites `nice-ng120-cough` and
 * nothing else, so the reader arriving from a citation is holding an ID, not a
 * title. Matching only the title would make the corpus unsearchable by the one
 * string the rest of the product hands them.
 */
function matches(guideline: GuidelineChunk, query: string) {
  const haystack =
    `${guideline.id} ${guideline.title} ${guideline.summary} ${guideline.publisher}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function matchesDocument(document: GuidelineDocument, query: string) {
  const haystack = `${document.title} ${document.publisher}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

const formatIngested = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value)

export function Guidelines() {
  const guidelines = useQuery({ queryKey: ['guidelines'], queryFn: api.guidelines })
  const documents = useQuery({
    queryKey: ['guideline-documents'],
    queryFn: api.guidelineDocuments,
  })
  const [query, setQuery] = useState('')
  const [publisher, setPublisher] = useState(ALL_PUBLISHERS)
  const [corpusPage, setCorpusPage] = useState(1)
  const [documentPage, setDocumentPage] = useState(1)
  const corpusHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const cpgHeadingRef = useRef<HTMLHeadingElement | null>(null)

  const all = useMemo(() => guidelines.data ?? [], [guidelines.data])
  const allDocuments = useMemo(() => documents.data ?? [], [documents.data])

  const publishers = useMemo(
    () => [
      { value: ALL_PUBLISHERS, label: 'All Publishers' },
      ...[...new Set(all.map((guideline) => guideline.publisher))]
        .sort()
        .map((name) => ({ value: name, label: name })),
    ],
    [all],
  )

  const filtered = useMemo(
    () =>
      all.filter(
        (guideline) =>
          (publisher === ALL_PUBLISHERS || guideline.publisher === publisher) &&
          matches(guideline, query),
      ),
    [all, publisher, query],
  )

  const filtering = query.trim() !== '' || publisher !== ALL_PUBLISHERS

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setCorpusPage(1)
    setDocumentPage(1)
  }

  const handlePublisherChange = (value: string) => {
    setPublisher(value)
    setCorpusPage(1)
  }

  const corpusPageCount = useMemo(() => Math.ceil(filtered.length / CORPUS_PAGE_SIZE), [filtered])
  const currentCorpusPage = clampPage(corpusPage, corpusPageCount)
  const pagedCorpus = useMemo(
    () => paginate(filtered, currentCorpusPage, CORPUS_PAGE_SIZE),
    [filtered, currentCorpusPage],
  )
  const pagedGroups = useMemo(() => groupByPublisher(pagedCorpus), [pagedCorpus])

  /* The one search box covers both lists: a reader checking where a cited
     span could have come from is asking the same question of each. */
  const filteredDocuments = useMemo(
    () => allDocuments.filter((document) => matchesDocument(document, query)),
    [allDocuments, query],
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
        title="Guideline Corpus"
        subtitle="The closed set of sources the model may cite. Anything outside it fails validation."
        art="/art/guidelines.webp"
      />

      {guidelines.isPending && (
        <div className="mt-6 flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-card" />
          ))}
        </div>
      )}

      {guidelines.data && (
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
              A suggestion carries a guideline ID, never free text. The model is given only these{' '}
              <span className="font-medium text-ink">{all.length} entries</span> and can cite
              nothing else.
            </p>
            <InfoTip label="How the citation constraint is enforced" align="right">
              The request-time schema narrows the citation field to exactly the IDs above, so a
              reference naming anything else fails validation inside the adapter and the suggestion
              never reaches the doctor. It is rejected at parse time rather than caught in review,
              which is what makes a hallucinated reference structurally impossible rather than
              merely unlikely. The summaries below are ours, written from the source documents;
              follow each link for the document itself.
            </InfoTip>
          </Card>

          {/* Search narrows what is shown, never what the model is given. The
              count in the card above stays at the full corpus size for that
              reason: it is a claim about the closed set, and a number that
              moved with the filter would quietly turn it into a lie. */}
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
                placeholder="Search by title, summary or guideline ID"
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
              ? `Showing ${filtered.length} of ${all.length} entries`
              : `${all.length} entries`}
          </p>

          {filtering && filtered.length === 0 && (
            <Card className="mt-4 p-6 text-center">
              <p className="text-sm text-ink-muted">
                Nothing in the corpus matches that. The set is deliberately small and narrow, so a
                miss usually means the topic is outside this prototype&rsquo;s scope rather than
                that the search failed.
              </p>
            </Card>
          )}

          {pagedGroups.map(([groupPublisher, entries]) => (
            <section key={groupPublisher} className="mt-8">
              <h2 className="text-sm font-semibold text-ink-muted">{groupPublisher}</h2>
              <div className="mt-3 flex flex-col gap-2">
                {entries.map((guideline) => (
                  <Card key={guideline.id} className="p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="font-semibold leading-snug">{guideline.title}</h3>
                      <span className="text-sm text-ink-muted">{guideline.year}</span>
                    </div>

                    <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                      {guideline.summary}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {/* The ID is the thing a suggestion actually references,
                          so it is shown verbatim rather than prettified. */}
                      <code className="rounded-control bg-sunken px-2 py-1 font-mono text-2xs text-ink-muted">
                        {guideline.id}
                      </code>
                      <span className="text-2xs text-ink-muted">{guideline.sourceLicence}</span>
                      <a
                        href={guideline.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
                      >
                        Source
                        <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}

          {filtered.length > 0 && (
            <section aria-labelledby="corpus-pagination-heading" className="mt-6">
              <h2 id="corpus-pagination-heading" ref={corpusHeadingRef} className="sr-only">
                Curated corpus pagination
              </h2>
              <Pagination
                page={currentCorpusPage}
                pageCount={corpusPageCount}
                onPageChange={setCorpusPage}
                scrollTo={corpusHeadingRef}
              />
            </section>
          )}
        </>
      )}

      <section className="mt-10" aria-labelledby="cpg-documents-heading">
        <h2 id="cpg-documents-heading" ref={cpgHeadingRef} className="text-base font-semibold">
          Malaysian Clinical Practice Guidelines
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Retrieved per consultation from the ingested CPG library; the assistant may cite a span
          only when it was retrieved for that consultation.
        </p>

        {documents.isPending && (
          <div className="mt-4 flex flex-col gap-2">
            {[0, 1].map((key) => (
              <Skeleton key={key} className="h-20 w-full rounded-card" />
            ))}
          </div>
        )}

        {documents.data && allDocuments.length === 0 && (
          <p className="mt-4 text-sm text-ink-muted">No CPG documents ingested yet.</p>
        )}

        {documents.data && allDocuments.length > 0 && filteredDocuments.length === 0 && (
          <p className="mt-4 text-sm text-ink-muted">No CPG documents match that search.</p>
        )}

        {filteredDocuments.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {pagedDocuments.map((document) => (
              <Card key={document.id} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-semibold leading-snug">{document.title}</h3>
                  <span className="text-sm text-ink-muted">{document.year}</span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-2xs text-ink-muted">{document.publisher}</span>
                  <span className="text-2xs text-ink-muted">{document.pageCount} pages</span>
                  <span className="text-2xs text-ink-muted">{document.chunkCount} chunks</span>
                  <span className="text-2xs text-ink-muted">
                    Ingested {formatIngested(document.ingestedAt)}
                  </span>
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
    </div>
  )
}
