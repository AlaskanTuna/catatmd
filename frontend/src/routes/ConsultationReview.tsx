import type {
  ClinicalAssertion,
  ConsultationDetail,
  CopilotProposal,
  Disposition,
  DispositionInput,
  SoapNote,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CatatAI } from '../copilot/CatatAI.js'
import { DEMO_CONSULTATION_ID, useDemoTour } from '../demo/DemoTour.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { ApproveBar } from '../review/ApproveBar.js'
import { ChecklistPanel } from '../review/ChecklistPanel.js'
import { NoteEditor } from '../review/NoteEditor.js'
import { GapCard, RedFlagCard, SuggestionCard } from '../review/SafetyCards.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

/** The current decision about a finding, or `undefined` if none was made. */
function byId(dispositions: Disposition[], id: string): Disposition | undefined {
  return dispositions.find((entry) => entry.id === id)
}

/**
 * Applies a decision in memory, matching what the API does on a stored row.
 *
 * The tour's consultation has no id to PATCH, so every control on this screen
 * would 404 mid-demo without this. Last decision per id wins, exactly as
 * `applyDispositions` does on the server, so the demo cannot drift from the
 * behaviour it is demonstrating.
 */
function mergeDispositions(current: Disposition[], incoming: DispositionInput[]): Disposition[] {
  const next = new Map(current.map((entry) => [entry.id, entry] as const))
  for (const decision of incoming) next.set(decision.id, { ...decision, decidedAt: new Date() })
  return [...next.values()]
}

const SEVERITY_ORDER = { emergency: 0, urgent: 1, advisory: 2 } as const

/** Enough gaps to show the shape of the list without it swallowing the rail. */
const GAP_PREVIEW = 6

export function ConsultationReview() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [showTranscript, setShowTranscript] = useState(false)
  const transcriptRef = useRef<HTMLElement>(null)

  /**
   * Revealing the transcript is not the same as showing it.
   *
   * The panel is `order-3`, so in the single-column layout below `lg` it sits
   * after the safety rail and the note. Measured on the deployed build at
   * 390x844: toggling it on put its top edge 3318px down a 3729px page, which
   * is 2474px below the fold. The button label changed and nothing the doctor
   * could see did, so the control read as dead.
   *
   * Scrolled to rather than reordered. The rail is first below `lg` on purpose:
   * `docs/DESIGN.md` requires severity to be visible without scrolling, so
   * moving the transcript above it to shorten this trip would trade a control
   * that looks broken for a red flag that is genuinely out of sight.
   *
   * Placed with the other hooks rather than beside the markup it drives,
   * because this component returns early when the consultation fails to load
   * and a hook below that return is not always reached.
   */
  useEffect(() => {
    if (!showTranscript) return
    transcriptRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [showTranscript])
  const [showAllGaps, setShowAllGaps] = useState(false)

  /*
   * Demo Mode's consultation is not stored, so there is nothing to fetch for it
   * (issue #80). It renders through this component rather than through a
   * demo-only screen deliberately: a second renderer would drift, and the claim
   * the tour makes is that an evaluator is looking at the real review surface.
   */
  const tour = useDemoTour()
  const isEphemeral = id === DEMO_CONSULTATION_ID

  const consultation = useQuery({
    queryKey: ['consultation', id],
    queryFn: () => api.getConsultation(id),
    enabled: !isEphemeral,
  })
  const guidelines = useQuery({ queryKey: ['guidelines'], queryFn: api.guidelines })

  const invalidate = (next: ConsultationDetail) => {
    queryClient.setQueryData(['consultation', id], next)
    void queryClient.invalidateQueries({ queryKey: ['consultations'] })
    // Approval and a completed analysis both write notifiable audit rows, so
    // the bell has to be told the feed it is holding is stale (#116).
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  /**
   * Only on the stored path. Demo Mode approves in memory and persists nothing
   * (#80), so a toast reading "approved" there would claim a record exists that
   * does not.
   */
  const onApproved = (next: ConsultationDetail) => {
    invalidate(next)
    toast.success('Note approved. This record is now final.')
  }

  const analyze = useMutation({ mutationFn: () => api.analyze(id), onSuccess: invalidate })

  /**
   * Applies a CatatAI proposal the doctor approved (#169).
   *
   * It goes down `api.patch`, the same call their own keyboard
   * makes, rather than a copilot-specific write route. That is what makes "the
   * proposal grants no capability the doctor did not already have" a fact
   * rather than a claim: it is byte-for-byte the request the note editor and
   * the disposition controls already send, with the same validation and the
   * same audit events behind it.
   *
   * Note edits merge onto the note currently on screen, never onto `{}`: a
   * partial `editedNote` replacing the whole note would silently blank the
   * three sections the proposal did not mention.
   */
  const applyProposal = async (proposal: CopilotProposal, reason?: string) => {
    // Read from the query cache rather than a render-time binding: the doctor
    // may have edited the note between the proposal arriving and approving it,
    // and merging onto stale text would quietly revert that edit.
    const current = queryClient.getQueryData<ConsultationDetail>(['consultation', id])
    if (!current) throw new Error('No consultation loaded.')

    if (proposal.tool === 'edit_note_section') {
      const base = current.editedNote ?? current.analysis?.note
      const next = await api.patch(id, {
        editedNote: { ...base, [proposal.section]: proposal.text },
      })
      invalidate(next)
      toast.success(`Applied to ${proposal.section}.`)
      return
    }

    const decision = { id: '', state: proposal.state, ...(reason ? { reason } : {}) }
    const next = await api.patch(
      id,
      proposal.tool === 'set_red_flag_disposition'
        ? { redFlagDispositions: [{ ...decision, id: proposal.redFlagId }] }
        : { gapDispositions: [{ ...decision, id: proposal.gapId }] },
    )
    invalidate(next)
    toast.success('Decision recorded.')
  }

  /*
   * The ephemeral consultation has no row to PATCH, so review actions are
   * applied in memory instead of over the wire. The state transition is
   * identical to the stored path; only where it lands differs.
   */
  const patch = useMutation({
    mutationFn: async (body: Parameters<typeof api.patch>[1]) => {
      if (!isEphemeral) return api.patch(id, body)
      const current = tour.ephemeral as ConsultationDetail
      return {
        ...current,
        ...(body.editedNote
          ? { editedNote: { ...current.analysis?.note, ...body.editedNote } }
          : {}),
        ...(body.acknowledgedRedFlagIds
          ? { acknowledgedRedFlagIds: body.acknowledgedRedFlagIds }
          : {}),
        ...(body.reviewedGapIds ? { reviewedGapIds: body.reviewedGapIds } : {}),
        ...(body.redFlagDispositions
          ? {
              redFlagDispositions: mergeDispositions(
                current.redFlagDispositions,
                body.redFlagDispositions,
              ),
            }
          : {}),
        ...(body.gapDispositions
          ? { gapDispositions: mergeDispositions(current.gapDispositions, body.gapDispositions) }
          : {}),
        updatedAt: new Date(),
      } as ConsultationDetail
    },
    onSuccess: (next) => (isEphemeral ? tour.updateEphemeral(next) : invalidate(next)),
  })

  if (isEphemeral && !tour.ephemeral) {
    // The tour ended, which wiped it. Nothing to show and nothing to fetch.
    return <Navigate to="/consultations" replace />
  }

  if (!isEphemeral && consultation.isPending) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    )
  }

  const detail = isEphemeral ? tour.ephemeral : consultation.data
  if (!detail) {
    return <p className="text-sm text-emergency">This consultation could not be loaded.</p>
  }
  const analysis = detail.analysis
  const approved = detail.status === 'approved'
  const note = detail.editedNote ?? analysis?.note ?? null

  const flags = [...(analysis?.redFlags ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  // A flag counts as handled once any decision has been recorded about it,
  // whichever of the three it was. The approve bar surfaces the count of
  // undecided flags, not of un-acknowledged ones.
  const unacknowledged = flags.filter((f) => byId(detail.redFlagDispositions, f.id) === undefined)

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
              {showTranscript ? 'Hide Transcript' : 'Transcript'}
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
            ref={transcriptRef}
            className={cn(
              // `scroll-mt-20` clears the fixed chrome cluster, which is out of
              // flow and would otherwise cover the heading this scrolls to.
              'order-3 scroll-mt-20 lg:sticky lg:top-6 lg:order-1 lg:self-start',
              showTranscript ? 'block' : 'hidden lg:block',
            )}
            aria-labelledby="transcript-heading"
            data-tour="transcript"
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
              evidenceLinks={analysis.evidenceLinks}
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
                    disposition={byId(detail.redFlagDispositions, flag.id)}
                    onDecide={(decision) => patch.mutate({ redFlagDispositions: [decision] })}
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
                    disposition={byId(detail.gapDispositions, gap.id)}
                    onDecide={(decision) => patch.mutate({ gapDispositions: [decision] })}
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
                  {showAllGaps ? 'Show Fewer' : `Show All ${analysis.gaps.length} Missing Items`}
                </button>
              )}
            </Panel>

            <Panel title="Suggestions" count={analysis.suggestions.length}>
              {analysis.suggestions.length === 0 ? (
                /* Three readings, not two, because the system distinguishes
                   them and the reader deserves the same distinction. Absence is
                   its own case: consultations analysed before `outOfScope`
                   shipped have no value, and reading that as `false` would
                   assert the corpus was consulted when nobody knows. */
                <p className="text-sm text-ink-muted">
                  {analysis.outOfScope === true &&
                    'Outside the guideline corpus’s scope, so no suggestions were offered.'}
                  {analysis.outOfScope === false &&
                    'Within the guideline corpus’s scope, with nothing to suggest for this consultation.'}
                  {analysis.outOfScope === undefined &&
                    'No cited suggestions. This consultation was analysed before scope was recorded, so whether the corpus applied is not known.'}
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
          approve={async () =>
            isEphemeral
              ? ({
                  ...(tour.ephemeral as ConsultationDetail),
                  status: 'approved',
                  approvedAt: new Date(),
                  // The demo has no signed-in identity distinct from the viewer,
                  // and inventing a clinician name on a screen that teaches what
                  // approval means would be the wrong thing to fake.
                  approvedBy: null,
                } as ConsultationDetail)
              : api.approve(id)
          }
          approved={approved}
          approvedAt={detail.approvedAt}
          approvedBy={detail.approvedBy}
          unacknowledgedCount={unacknowledged.length}
          onApproved={isEphemeral ? tour.updateEphemeral : onApproved}
        />
      )}

      {/*
       * Not offered on the tour's consultation, which is not stored, so the
       * copilot route would 404 on every message (#80). Not offered after
       * approval either: the record is final, and a panel that could still
       * propose edits would be inviting a change that cannot be made.
       */}
      {!isEphemeral && !approved && <CatatAI consultation={detail} onApply={applyProposal} />}
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
