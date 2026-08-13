import type { ClinicalAssertion, ConsultationDetail, SoapNote } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { ApproveBar } from '../review/ApproveBar.js'
import { ChecklistPanel } from '../review/ChecklistPanel.js'
import { NoteEditor } from '../review/NoteEditor.js'
import { GapCard, RedFlagCard, SuggestionCard } from '../review/SafetyCards.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

const SEVERITY_ORDER = { emergency: 0, urgent: 1, advisory: 2 } as const

/** Enough gaps to show the shape of the list without it swallowing the rail. */
const GAP_PREVIEW = 6

export function ConsultationReview() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [showTranscript, setShowTranscript] = useState(false)
  const [showAllGaps, setShowAllGaps] = useState(false)

  const consultation = useQuery({
    queryKey: ['consultation', id],
    queryFn: () => api.getConsultation(id),
  })
  const guidelines = useQuery({ queryKey: ['guidelines'], queryFn: api.guidelines })

  const invalidate = (next: ConsultationDetail) => {
    queryClient.setQueryData(['consultation', id], next)
    void queryClient.invalidateQueries({ queryKey: ['consultations'] })
  }

  const analyze = useMutation({ mutationFn: () => api.analyze(id), onSuccess: invalidate })
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof api.patch>[1]) => api.patch(id, body),
    onSuccess: invalidate,
  })

  if (consultation.isPending) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    )
  }

  if (!consultation.data) {
    return <p className="text-sm text-emergency">This consultation could not be loaded.</p>
  }

  const detail = consultation.data
  const analysis = detail.analysis
  const approved = detail.status === 'approved'
  const note = detail.editedNote ?? analysis?.note ?? null

  const flags = [...(analysis?.redFlags ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const unacknowledged = flags.filter((f) => !detail.acknowledgedRedFlagIds.includes(f.id))

  // Transcript turns carry no id in the shared contract, and position *is*
  // their identity: the list is immutable for a given consultation and is
  // never sorted or filtered. Naming that explicitly beats an index in JSX.
  const keyedTurns = (detail.transcript?.turns ?? []).map((turn, position) => ({
    ...turn,
    key: `${position}-${turn.speaker}`,
  }))

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        data-print="hide"
        title="Consultation Review"
        breadcrumb={
          <ol className="flex items-center gap-1.5">
            <li>
              <Link to="/consultations" className="transition-colors hover:text-ink">
                Consultations
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-ink">
              Review
            </li>
          </ol>
        }
        subtitle={<span className="font-mono text-xs">{detail.id}</span>}
        art="/art/review.webp"
        actions={
          <>
            <Button
              className="lg:hidden"
              onClick={() => setShowTranscript((value) => !value)}
              aria-expanded={showTranscript}
            >
              {showTranscript ? 'Hide transcript' : 'Transcript'}
            </Button>
            {approved && (
              <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
                Export
              </Button>
            )}
          </>
        }
      />

      {!analysis && (
        <Card className="mt-6 p-6" data-print="hide">
          <h2 className="text-lg font-semibold">Ready to Analyse</h2>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The transcript is de-identified before any part of it leaves this server. Identifiers
            are replaced with pseudonymous tokens and restored only after the response returns.
          </p>
          {analyze.error && (
            <p role="alert" className="mt-3 text-sm text-emergency">
              {analyze.error instanceof ApiError
                ? analyze.error.message
                : 'Analysis could not be completed.'}
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="mt-4"
            icon={<Sparkles className="size-4" />}
            loading={analyze.isPending || detail.status === 'analyzing'}
            onClick={() => analyze.mutate()}
            data-tour="analyse"
          >
            {analyze.isPending ? 'Analysing' : 'Analyse Consultation'}
          </Button>
        </Card>
      )}

      {analysis && note && (
        /* Three panels on wide screens. Below lg the safety rail moves ABOVE
           the note rather than below it: docs/DESIGN.md requires severity to
           be visible without scrolling, and on a narrow screen that can only
           mean first in source order. The panels never become tabs, because
           tabs hide safety content. */
        <div className="mt-6 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
          <section
            className={cn(
              'order-3 lg:sticky lg:top-6 lg:order-1 lg:self-start',
              showTranscript ? 'block' : 'hidden lg:block',
            )}
            aria-labelledby="transcript-heading"
            data-print="hide"
          >
            <h2 id="transcript-heading" className="mb-2 text-sm font-semibold">
              Transcript
            </h2>
            <div className="max-h-[70vh] overflow-y-auto rounded-card bg-sunken p-3">
              {keyedTurns.map((turn) => (
                <p key={turn.key} className="mb-2 text-xs leading-relaxed">
                  <span
                    className={cn(
                      'font-semibold',
                      turn.speaker === 'doctor' ? 'text-accent' : 'text-ink-muted',
                    )}
                  >
                    {turn.speaker === 'doctor' ? 'Doctor' : 'Patient'}:{' '}
                  </span>
                  <span className="text-ink">{turn.text}</span>
                </p>
              ))}
            </div>
          </section>

          <section className="order-2 min-w-0" aria-labelledby="note-heading">
            <h2 id="note-heading" className="mb-2 text-sm font-semibold" data-print="hide">
              Clinical Note
            </h2>
            <NoteEditor
              note={note}
              aiNote={analysis.note}
              readOnly={approved}
              saving={patch.isPending}
              onSave={(editedNote: Partial<SoapNote>) => patch.mutate({ editedNote })}
            />
            <ChecklistPanel
              clinicalFacts={analysis.clinicalFacts}
              operational={analysis.operational}
            />
          </section>

          {/* The rail scrolls itself instead of stretching the page.
              Previously it was the tallest column by a wide margin (one guest
              consultation produced four flags and twenty-seven gaps), so it set
              the height of the whole screen and left the other two columns
              sitting beside a long empty gutter. Sticky keeps the flags next to
              the note while it is edited, which is the actual workflow, and the
              page can never be taller than the note itself.

              The bottom stop clears the approve bar, which is `sticky bottom-4`
              in flow and would otherwise sit on top of the last card. */}
          <aside
            className="order-1 flex flex-col gap-5 lg:sticky lg:top-6 lg:order-3 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1"
            aria-label="Clinical safety"
            data-print="expand"
          >
            <Panel title="Red Flags" count={flags.length}>
              {flags.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No escalation triggers fired for this consultation.
                </p>
              ) : (
                flags.map((flag) => (
                  <RedFlagCard
                    key={flag.id}
                    flag={flag}
                    acknowledged={detail.acknowledgedRedFlagIds.includes(flag.id)}
                    onAcknowledge={() =>
                      patch.mutate({
                        acknowledgedRedFlagIds: [...detail.acknowledgedRedFlagIds, flag.id],
                      })
                    }
                  />
                ))
              )}
            </Panel>

            {/* Gaps are the one list that gets long enough to bury the panels
                under it, so it opens at a readable length with the full count
                still on the heading. Red flags are never collapsed: hiding a
                fired escalation trigger behind a disclosure is the failure
                this product exists to prevent. */}
            <Panel title="Missing Information" count={analysis.gaps.length}>
              {/* Every gap is rendered and the extras are hidden in CSS rather
                  than sliced out of the array, so `print:block` brings them all
                  back. Slicing would put a truncated list on paper with nothing
                  to say it had been truncated. */}
              {analysis.gaps.map((gap, position) => (
                <div
                  key={gap.id}
                  className={cn(!showAllGaps && position >= GAP_PREVIEW && 'hidden print:block')}
                >
                  <GapCard
                    gap={gap}
                    reviewed={detail.reviewedGapIds.includes(gap.id)}
                    onReview={() =>
                      patch.mutate({ reviewedGapIds: [...detail.reviewedGapIds, gap.id] })
                    }
                  />
                </div>
              ))}
              {analysis.gaps.length > GAP_PREVIEW && (
                <button
                  type="button"
                  data-print="hide"
                  onClick={() => setShowAllGaps((value) => !value)}
                  aria-expanded={showAllGaps}
                  className="mt-1 self-start rounded-control px-2 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-sunken"
                >
                  {showAllGaps ? 'Show fewer' : `Show all ${analysis.gaps.length} missing items`}
                </button>
              )}
            </Panel>

            <Panel title="Suggestions" count={analysis.suggestions.length}>
              {analysis.suggestions.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No cited suggestions. This may be outside the guideline corpus&rsquo;s scope.
                </p>
              ) : (
                analysis.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    guidelines={guidelines.data ?? []}
                  />
                ))
              )}
            </Panel>
          </aside>
        </div>
      )}

      {analysis && (
        <ApproveBar
          consultationId={id}
          approved={approved}
          approvedAt={detail.approvedAt}
          unacknowledgedCount={unacknowledged.length}
          onApproved={invalidate}
        />
      )}
    </div>
  )
}

function Panel({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {title}
        <span className="rounded-full bg-sunken px-1.5 py-0.5 text-2xs text-ink-muted">
          {count}
        </span>
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export type { ClinicalAssertion }
