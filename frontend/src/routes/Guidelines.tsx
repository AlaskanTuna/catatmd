import type { GuidelineChunk } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'
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

export function Guidelines() {
  const guidelines = useQuery({ queryKey: ['guidelines'], queryFn: api.guidelines })
  const [query, setQuery] = useState('')
  const [publisher, setPublisher] = useState(ALL_PUBLISHERS)

  const all = useMemo(() => guidelines.data ?? [], [guidelines.data])

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

  const groups = groupByPublisher(filtered)
  const filtering = query.trim() !== '' || publisher !== ALL_PUBLISHERS

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
          <Card className="mt-6 p-5">
            <p className="text-sm leading-relaxed text-ink-muted">
              A suggestion carries a guideline ID, never free text. The model is given only these{' '}
              <span className="font-medium text-ink">{all.length} entries</span> and can cite
              nothing else, so a fabricated reference is rejected at parse time rather than caught
              by review. Summaries below are ours; follow the link for the source document.
            </p>
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
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title, summary or guideline ID"
                aria-label="Search the guideline corpus"
                className="h-11 w-full rounded-control border border-line bg-surface pr-10 pl-10 text-sm text-ink transition-colors duration-150 hover:border-accent focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
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
              onChange={setPublisher}
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

          {groups.map(([groupPublisher, entries]) => (
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
        </>
      )}
    </div>
  )
}
