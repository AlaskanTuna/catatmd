import type { GuidelineChunk } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

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

export function Guidelines() {
  const guidelines = useQuery({ queryKey: ['guidelines'], queryFn: api.guidelines })
  const groups = groupByPublisher(guidelines.data ?? [])

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
              <span className="font-medium text-ink">{guidelines.data.length} entries</span> and can
              cite nothing else, so a fabricated reference is rejected at parse time rather than
              caught by review. Summaries below are ours; follow the link for the source document.
            </p>
          </Card>

          {groups.map(([publisher, entries]) => (
            <section key={publisher} className="mt-8">
              <h2 className="text-sm font-semibold text-ink-muted">{publisher}</h2>
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
