import type {
  ClinicalAssertion,
  ConsultationDetail,
  CopilotProposal,
  Disposition,
  DispositionInput,
  GuidelineChunk,
  SoapNote,
  Transcript,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Printer, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, Navigate, useParams } from 'react-router-dom'
import type { LivePanes } from '../audio/live/use-live-panes.js'
import { useLivePanes } from '../audio/live/use-live-panes.js'
import { CatatAI } from '../copilot/CatatAI.js'
import { DEMO_CONSULTATION_ID, useDemoTour } from '../demo/DemoTour.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { count } from '../lib/plural.js'
import { ApproveBar } from '../review/ApproveBar.js'
import { ChecklistPanel } from '../review/ChecklistPanel.js'
import { NoteEditor } from '../review/NoteEditor.js'
import { GapCard, RedFlagCard, SuggestionCard } from '../review/SafetyCards.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { InfoTip } from '../ui/InfoTip.js'
import { PageHeader } from '../ui/PageHeader.js'
import { RenameField } from '../ui/RenameField.js'
import { CapturePanel } from './CapturePanel.js'

export function formatSoapNoteForClipboard(note: SoapNote) {
  return [
    `Subjective\n${note.subjective}`,
    `Objective\n${note.objective}`,
    `Assessment\n${note.assessment}`,
    `Plan\n${note.plan}`,
  ].join('\n\n')
}

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

/**
 * Ordering only, which is the whole of what `priority` means.
 *
 * The checklist that produces gaps documents `priority` as a volume and
 * ordering signal carrying no safety meaning on its own, so this sorts the list
 * and nothing more: nothing is filtered, no count changes, and no copy anywhere
 * calls a `high` gap urgent. Without it the six shown before the disclosure
 * were whichever six sat first in the checklist source file, which is an
 * ordering the reader has no way to interpret.
 */
const GAP_PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

/**
 * Enough findings to show the shape of a list without it swallowing the rail.
 *
 * Three, down from six for gaps alone, because the number now governs all three
 * panels and the rail holds all three at once. Six apiece is eighteen cards in a
 * 340px column, which is the height the shared column height exists to prevent.
 */
const PANEL_PREVIEW = 3

/** One panel's full list, as handed to the shared overflow dialog. */
type Finding = { id: string; node: React.ReactNode }
type Overflow = { title: string; findings: Finding[] }

/**
 * A rail panel that shows the first few findings and puts the rest behind a
 * dialog.
 *
 * The preview is a CSS hide rather than a slice, so `print:block` brings the
 * whole list back on paper: slicing would put a truncated list in front of a
 * doctor with nothing to say it had been truncated, and on this rail that could
 * be a missing red flag.
 */
function FindingsPanel({
  title,
  findings,
  noun,
  empty,
  onShowAll,
}: {
  title: string
  findings: Finding[]
  /**
   * What the CTA counts. Given rather than derived from `title`, because
   * "Show All 7 Missing Information" is not a sentence.
   */
  noun: string
  /** Shown instead of the list when there is nothing to show. */
  empty?: React.ReactNode
  onShowAll: (overflow: Overflow) => void
}) {
  return (
    <Panel title={title} count={findings.length}>
      {findings.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <>
          {findings.map((finding, position) => (
            <div key={finding.id} className={cn(position >= PANEL_PREVIEW && 'hidden print:block')}>
              {finding.node}
            </div>
          ))}
          {findings.length > PANEL_PREVIEW && (
            <button
              type="button"
              data-print="hide"
              onClick={() => onShowAll({ title, findings })}
              className="mt-1 self-start rounded-control px-2 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-sunken"
            >
              Show All {findings.length} {noun}
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

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
  /*
   * A panel's full list opens in a dialog rather than expanding the rail.
   * Thirty-two gaps inline made the rail scroll for a page and a half while the
   * two columns beside it had already ended, which is the height mismatch the
   * shared column height exists to remove. One dialog serves all three panels,
   * because three dialogs differing only in their title is three places for the
   * next change to miss.
   *
   * The rail still renders every finding, with the ones past the preview hidden
   * in CSS rather than sliced out, so `print:block` brings them all back. The
   * dialog's copy is gated on state so the cards are not in the DOM twice while
   * it is closed.
   */
  const [overflow, setOverflow] = useState<Overflow | null>(null)
  const overflowDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!overflow) return
    overflowDialog.current?.showModal()
    /*
     * Focus the first control once the content mounts. It is gated on state, so
     * it is not in the DOM yet when `showModal()` runs its native autofocus
     * pass, and without this the dialog itself takes focus and the first Tab
     * starts from nowhere in particular. Queried off the dialog rather than held
     * on a ref because `ui/Button.tsx` does not forward one.
     */
    overflowDialog.current?.querySelector('button')?.focus()
  }, [overflow])

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

  /** Matches the consultation list's format, so one record reads the same in both. */
  const formatCreated = (value: Date) =>
    new Intl.DateTimeFormat('en-MY', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value)

  const rename = useMutation({
    mutationFn: (title: string | null) => api.patch(id, { title }),
    onSuccess: (next) => {
      invalidate(next)
      void queryClient.invalidateQueries({ queryKey: ['consultations'] })
    },
    onError: () => toast.error('That name could not be saved.'),
  })

  /*
   * Analysis is the one action in this product that takes real time and then
   * changes the whole screen underneath the doctor, and it was the only write
   * path with no transient feedback at all: no success, and no error either, so
   * a failed analyse left the button springing back with the screen unchanged
   * and nothing said. That reads as a dead button rather than as a failure.
   *
   * The success line names what arrived rather than saying "done", because the
   * three panels populate at once and the useful thing to know is which of them
   * to look at first. Nothing clinical goes in it: counts only, never a finding
   * or its text (`ui/Toaster.tsx`).
   */
  const capture = useMutation({
    mutationFn: (transcript: Transcript) => api.setTranscript(id, transcript),
    onSuccess: (consultation) => queryClient.setQueryData(['consultation', id], consultation),
  })

  /**
   * The three live panes, fed by ambient capture while the doctor is still
   * talking (#219). Inert on every other capture path, because nothing calls
   * `absorb` until settled recognition tokens arrive.
   *
   * Ephemeral demo consultations have no id to scope a route to, so they get
   * `null` and the panes simply stay in their placeholder state.
   */
  const live = useLivePanes(isEphemeral ? null : id)

  const analyze = useMutation({
    mutationFn: () => api.analyze(id),
    onSuccess: (next) => {
      invalidate(next)
      const flags = next.analysis?.redFlags.length ?? 0
      const gaps = next.analysis?.gaps.length ?? 0
      toast.success(
        flags === 0
          ? `Analysis complete. ${count(gaps, 'documentation gap')} to review.`
          : `Analysis complete. ${count(flags, 'red flag')} raised, ${count(gaps, 'documentation gap')} to review.`,
      )
    },
    onError: () => toast.error('Analysis failed. Nothing was saved, and you can run it again.'),
  })

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

  const copyNote = async () => {
    if (!note) return
    try {
      await navigator.clipboard.writeText(formatSoapNoteForClipboard(note))
      toast.success('Note copied.')
    } catch {
      toast.error('Note could not be copied.')
    }
  }

  const flags = [...(analysis?.redFlags ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  // Stable, so the checklist's own order survives inside each band and a
  // model-proposed gap stays beside the deterministic entries it arrived with.
  const gaps = [...(analysis?.gaps ?? [])].sort(
    (a, b) => GAP_PRIORITY_ORDER[a.priority] - GAP_PRIORITY_ORDER[b.priority],
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
    // The bottom padding clears the sticky bar, which is in flow and would
    // otherwise sit on top of the last thing in the tallest column.
    <div className="mx-auto max-w-7xl pb-20">
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
            {/* The patient, not the word "Review". The breadcrumb's last
                segment was restating the page title one line below it, and the
                one thing a doctor has to be able to see without leaving this
                screen is whose note this is: a consultation filed to the wrong
                patient was undetectable from here until #213. "Review" is the
                fallback for a consultation captured without a patient, which is
                the normal case for paste, upload and ad-hoc recording. */}
            <li aria-current="page" className="min-w-0 truncate text-ink">
              {detail.patient ? (
                <Link
                  to={`/patients/${detail.patient.id}`}
                  className="text-ink transition-colors hover:text-accent"
                >
                  {detail.patient.name ?? 'Unnamed patient'}
                </Link>
              ) : (
                'Review'
              )}
            </li>
          </ol>
        }
        /*
         * The record's name sits here rather than replacing the page heading.
         * `PageHeader.title` names the screen, and every other page uses it that
         * way; swapping in a per-record value on this one page would make the
         * heading mean something different here than everywhere else.
         *
         * Renaming is offered on an approved consultation too. The API allows
         * it deliberately, because a filing name is not part of the record that
         * sign-off freezes, and the archive has to stay searchable.
         */
        /*
         * The record's name, and nothing else. The patient moved up into the
         * breadcrumb, and the cuid went entirely: it identified the row for a
         * developer and told a doctor nothing, while sitting in the most
         * prominent surface on the screen.
         *
         * Renaming is offered on an approved consultation too. The API allows
         * it deliberately, because a filing name is not part of the record that
         * sign-off freezes, and the archive has to stay searchable.
         */
        subtitle={
          isEphemeral ? (
            <span className="text-sm font-medium text-ink">{formatCreated(detail.createdAt)}</span>
          ) : (
            <RenameField
              value={detail.title}
              fallback={formatCreated(detail.createdAt)}
              label="Rename this consultation"
              textClassName="text-sm font-medium text-ink"
              onSave={(title) => rename.mutate(title)}
            />
          )
        }
        art="/art/review.webp"
        /*
         * The page's one primary action lives here, under the record it acts
         * on, rather than in a floating island at the foot of the screen. The
         * island covered the bottom of all three columns and needed its own
         * inset variable so the floating chrome could dodge it; a first-time
         * doctor also had to scroll to discover it at all.
         *
         * Analyse becomes Approve at the same place, which is the sequence the
         * screen actually has: capture, analyse, review, sign off.
         */
        actions={
          <>
            {!analysis && (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Sparkles className="size-4" />}
                  disabled={!detail.transcript}
                  loading={analyze.isPending || detail.status === 'analyzing'}
                  onClick={() => analyze.mutate()}
                  data-tour="analyse"
                >
                  {analyze.isPending ? 'Analysing' : 'Analyse Consultation'}
                </Button>
                {analyze.error ? (
                  <InfoTip label="Analysis could not be completed" tone="warning">
                    {analyze.error instanceof ApiError
                      ? analyze.error.message
                      : 'Analysis could not be completed.'}
                  </InfoTip>
                ) : (
                  <InfoTip
                    label={
                      detail.transcript
                        ? 'What happens when you analyse'
                        : 'Why this is not available yet'
                    }
                    tone={detail.transcript ? 'info' : 'warning'}
                  >
                    {detail.transcript
                      ? 'De-identified before any part of it leaves this server, and restored only after the response returns.'
                      : 'Capture the consultation first, on the left.'}
                  </InfoTip>
                )}
              </>
            )}
            {analysis && !approved && (
              <ApproveBar
                approve={async () =>
                  isEphemeral
                    ? ({
                        ...(tour.ephemeral as ConsultationDetail),
                        status: 'approved',
                        approvedAt: new Date(),
                        // The demo has no signed-in identity distinct from the
                        // viewer, and inventing a clinician name on a screen
                        // that teaches what approval means would be wrong.
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
            <Button
              className="lg:hidden"
              onClick={() => setShowTranscript((value) => !value)}
              aria-expanded={showTranscript}
            >
              {showTranscript ? 'Hide Transcript' : 'Transcript'}
            </Button>
            {approved && note && (
              <Button icon={<Copy aria-hidden className="size-4" />} onClick={copyNote}>
                Copy Note
              </Button>
            )}
            {approved && (
              <Button
                icon={<Printer aria-hidden className="size-4" />}
                onClick={() => window.print()}
              >
                Export
              </Button>
            )}
          </>
        }
      />

      {/* Three panels on wide screens, in every state rather than only the
          analysed one. Below lg the safety rail moves ABOVE the note rather
          than below it: docs/DESIGN.md requires severity to be visible without
          scrolling, and on a narrow screen that can only mean first in source
          order. The panels never become tabs, because tabs hide safety content.

          Capture used to replace this whole arrangement with a single card,
          which meant the doctor captured a consultation with no sight of where
          any of it would land. The columns are the explanation: the note fills
          the middle, the checks fill the rail, and both reveal their shape
          while they are still empty. */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)_340px]">
        <section
          ref={transcriptRef}
          className={cn(
            // `scroll-mt-20` clears the fixed chrome cluster, which is out of
            // flow and would otherwise cover the heading this scrolls to.
            'order-3 scroll-mt-20 lg:sticky lg:top-6 lg:order-1',
            // One ceiling for all three columns, not one height. The grid
            // already stretches them to a common row height, so their tops and
            // bottoms line up without any column being padded out to the
            // viewport: a draft with three short cards stays short, while a
            // long transcript stops at the ceiling and scrolls inside itself
            // rather than running the page. This column was the worst of it
            // before: a one-line transcript left a 380px stub beside two
            // full-length neighbours.
            //
            // The last child stretches so the card bottoms line up too, and it
            // is `grow shrink-0` rather than `flex-1` for a measured reason:
            // `flex-1` is `1 1 0%`, so a transcript taller than the column is
            // shrunk to fit it, the column stops generating a scrollbar, and
            // everything past the fold becomes unreachable. Growing from an
            // `auto` basis that may never shrink fills the gap when content is
            // short without capping it when content is long.
            'lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1 lg:flex lg:flex-col lg:[&>*:last-child]:grow lg:[&>*:last-child]:shrink-0',
            // The mobile show/hide belongs to a transcript that already
            // exists. Capture is the one thing on this screen a doctor has
            // come here to do, so it is never behind a toggle.
            detail.transcript && !showTranscript ? 'hidden lg:block' : 'block',
          )}
          aria-labelledby="transcript-heading"
          data-tour="transcript"
          data-print="hide"
        >
          <h2 id="transcript-heading" className="mb-2 text-sm font-semibold">
            Transcript
          </h2>
          {/* The column itself scrolls from `lg` up, so the inner cap is
              released there rather than nesting one scrollbar inside another.
              Below `lg` the column is uncapped and this is what stops a long
              transcript running the page. */}
          {detail.transcript ? (
            <div className="max-h-[70vh] overflow-y-auto rounded-card bg-sunken p-3 lg:max-h-none lg:overflow-visible">
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
          ) : (
            <Card className="flex flex-col p-4">
              <CapturePanel
                saving={capture.isPending}
                error={
                  capture.error instanceof ApiError
                    ? capture.error.message
                    : capture.error
                      ? 'Could not save the transcript.'
                      : null
                }
                onCapture={(transcript) => capture.mutate(transcript)}
                onLiveSegments={live.absorb}
              />
            </Card>
          )}
        </section>

        <section
          className="order-2 min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1 lg:flex lg:flex-col lg:[&>*:last-child]:grow lg:[&>*:last-child]:shrink-0"
          aria-labelledby="note-heading"
          data-print="expand"
        >
          <h2 id="note-heading" className="mb-2 text-sm font-semibold" data-print="hide">
            Clinical Note
          </h2>
          {analysis && note ? (
            <>
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
            </>
          ) : (
            <>
              <NotePlaceholder />
              {/*
                The patient card fills while the doctor talks; the note does
                not. That split is the design rather than an omission: §20.8.1
                measures writing the note from extracted facts as *less*
                grounded than writing it from the transcript, and a note folded
                from a previous note is that shape by another route. So
                extraction drives this card, and the note is written once, at
                Finish, from the transcript.
              */}
              {live.panes.clinicalFacts && live.panes.operational && (
                <ChecklistPanel
                  clinicalFacts={live.panes.clinicalFacts}
                  operational={live.panes.operational}
                  defaultOpen
                />
              )}
            </>
          )}
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
          className="order-1 flex flex-col gap-5 lg:sticky lg:top-6 lg:order-3 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1 lg:[&>section]:grow lg:[&>section]:shrink-0"
          aria-label="Clinical safety"
          data-print="expand"
        >
          {!analysis && (
            <>
              {/*
                Ruled bars, not pulsing skeletons, for the same reason
                `NotePlaceholder` gives: nothing is loading here. Analysis has
                not been asked for yet, and a shimmer would promise work in
                progress that the doctor has not started. The bars show where
                each panel's findings will land, which is the empty-state claim
                the prose these replaced was making at three times the length.
              */}
              {/* One fixed height for all three, rather than three cards each
                  sized by the two bars inside it. Content-sized placeholders
                  make the rail's rhythm an accident of how many bars a panel
                  happens to draw, and the three panels are peers: nothing about
                  an unanalysed consultation makes one of them shorter than
                  another. Fixed also means the rail does not resize when the
                  real findings replace them. */}
              {(['Red Flags', 'Missing Information', 'Suggestions'] as const).map((title) =>
                /*
                  Once ambient capture has said something, the first two stop
                  being placeholders and start being the live panes (#219).
                  Suggestions keeps its bars: it is the one panel with no live
                  half, because `generateSuggestions` is the most expensive call
                  in the pipeline and nobody asked for it mid-consultation.
                */
                title !== 'Suggestions' && live.panes.hasContent ? (
                  <LivePanel key={title} title={title} live={live.panes} />
                ) : (
                  <Panel key={title} title={title}>
                    <Card className="flex-1 p-4 min-h-24">
                      <div className="h-2 w-full rounded-pill bg-sunken" />
                      <div className="mt-1.5 h-2 w-3/5 rounded-pill bg-sunken" />
                    </Card>
                  </Panel>
                ),
              )}
            </>
          )}

          {analysis && (
            <>
              <FindingsPanel
                title="Red Flags"
                noun="Red Flags"
                empty="No escalation triggers fired for this consultation."
                findings={flags.map((flag) => ({
                  id: flag.id,
                  node: (
                    <RedFlagCard
                      flag={flag}
                      disposition={byId(detail.redFlagDispositions, flag.id)}
                      onDecide={(decision) => patch.mutate({ redFlagDispositions: [decision] })}
                      guidelines={guidelines.data ?? []}
                    />
                  ),
                }))}
                onShowAll={setOverflow}
              />

              <FindingsPanel
                title="Missing Information"
                noun="Missing Items"
                findings={gaps.map((gap) => ({
                  id: gap.id,
                  node: (
                    <GapCard
                      gap={gap}
                      disposition={byId(detail.gapDispositions, gap.id)}
                      onDecide={(decision) => patch.mutate({ gapDispositions: [decision] })}
                      guidelines={guidelines.data ?? []}
                    />
                  ),
                }))}
                onShowAll={setOverflow}
              />

              <FindingsPanel
                title="Suggestions"
                noun="Suggestions"
                empty={
                  /* Three readings, not two, because the system distinguishes
                     them and the reader deserves the same distinction. Absence
                     is its own case: consultations analysed before `outOfScope`
                     shipped have no value, and reading that as `false` would
                     assert the corpus was consulted when nobody knows. */
                  analysis.outOfScope === true
                    ? 'Outside the guideline corpus\u2019s scope, so no suggestions were offered.'
                    : analysis.outOfScope === false
                      ? 'Within the guideline corpus\u2019s scope, with nothing to suggest for this consultation.'
                      : 'No cited suggestions. This consultation was analysed before scope was recorded, so whether the corpus applied is not known.'
                }
                findings={analysis.suggestions.map((suggestion) => ({
                  id: suggestion.id,
                  node: (
                    <SuggestionCard suggestion={suggestion} guidelines={guidelines.data ?? []} />
                  ),
                }))}
                onShowAll={setOverflow}
              />
            </>
          )}
        </aside>
      </div>

      {/* Every finding in the panel, at a width that fits the card's own
          explanation, instead of thirty of them threaded through a 340px rail.
          The rail keeps the first three as the preview and still renders the
          rest for print, so paper is unaffected by anything here. */}
      <dialog
        ref={overflowDialog}
        data-print="hide"
        onClose={() => setOverflow(null)}
        aria-labelledby="overflow-title"
        className="glass-panel m-auto w-[44rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {overflow && (
          <div className="flex max-h-[80vh] flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
              <h2 id="overflow-title" className="font-display text-lg font-semibold">
                {overflow.title}
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {count(overflow.findings.length, 'item')}
                </span>
              </h2>
              {/* First in the DOM, and so the one the open effect focuses. */}
              <Button size="sm" variant="neutral" onClick={() => overflowDialog.current?.close()}>
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-6">
              {overflow.findings.map((finding) => (
                <div key={finding.id}>{finding.node}</div>
              ))}
            </div>
          </div>
        )}
      </dialog>

      {/* Only the approved state renders here now: the attribution is a
          record, not an action, and it prints (issue #26). The gate itself
          moved under the consultation title, where it is seen without covering
          the columns it sits over. */}
      {analysis && approved && (
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
       * Rendered inactive on the tour's consultation, which is not stored, so
       * the copilot route would 404 on every message (#80). It renders at all
       * because the tour needs the `data-tour="catatai"` anchor to exist, and
       * a coachmark pointing at an element that is not there is the failure
       * `DemoTour`'s subject scoring exists to prevent (#179).
       *
       * **Keyed on the tour step, which is what closes the panel.** Advancing
       * or ending the tour remounts this and resets `open` to false, so the
       * step bar's End control never competes with an open panel. The key is
       * constant off the tour, so a real review never remounts.
       *
       * Offered on an approved record, where it answers but cannot propose:
       * the backend withholds the tools once `status` is `approved` rather
       * than the panel hiding, because the questions a doctor asks about a
       * note they have signed are the same questions, and a copilot that
       * disappears at sign-off looks like a bug from the outside.
       */}
      <CatatAI
        key={isEphemeral ? `tour-${tour.currentStep}` : 'record'}
        consultation={detail}
        onApply={applyProposal}
        demo={isEphemeral}
      />
    </div>
  )
}

/**
 * What the note will become, shown while it is still empty.
 *
 * The four headings are the SOAP sections in the order they will fill, so the
 * shape of the output is legible before there is any. Ruled lines rather than
 * pulsing skeletons: nothing is loading here, and a shimmer would promise work
 * in progress when the doctor has not started any.
 */
function NotePlaceholder() {
  return (
    <Card className="overflow-hidden p-0" data-print="hide">
      {['Subjective', 'Objective', 'Assessment', 'Plan'].map((section) => (
        <div key={section} className="border-b border-line/60 px-5 py-4">
          <h3 className="text-2xs font-semibold tracking-wider text-ink-muted uppercase">
            {section}
          </h3>
          <div className="mt-2 h-2 w-full rounded-pill bg-sunken" />
          <div className="mt-1.5 h-2 w-3/5 rounded-pill bg-sunken" />
        </div>
      ))}
    </Card>
  )
}

/**
 * A rail panel fed by ambient capture rather than by a finished analysis (#219).
 *
 * Deliberately the same cards the analysed rail uses, with `onDecide` omitted:
 * during capture the record is still `draft` and `PATCH` gates clinical fields
 * on `awaiting_review`, so a disposition control would offer an action the API
 * refuses. A second set of cards would also be a second place for the severity
 * scale and the citation rendering to drift.
 *
 * No overflow dialog here. The analysed rail hides past three behind one,
 * because a finished consultation can produce twenty-seven gaps; a live pane is
 * read in glances while the doctor is talking, so it shows what it has and
 * grows, and the full list is one press of Analyse away.
 */
function LivePanel({ title, live }: { title: string; live: LivePanes }) {
  const guidelines: GuidelineChunk[] = []

  if (title === 'Red Flags') {
    const flags = [...live.redFlags].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )
    return (
      <Panel title={title} count={flags.length}>
        {flags.length === 0 ? (
          <p className="text-sm text-ink-muted">No escalation triggers so far.</p>
        ) : (
          flags.map((flag) => (
            <RedFlagCard
              key={flag.id}
              flag={flag}
              disposition={undefined}
              guidelines={guidelines}
            />
          ))
        )}
      </Panel>
    )
  }

  const gaps = [...live.gaps].sort(
    (a, b) => GAP_PRIORITY_ORDER[a.priority] - GAP_PRIORITY_ORDER[b.priority],
  )
  return (
    <Panel title={title} count={gaps.length}>
      {gaps.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing outstanding so far.</p>
      ) : (
        gaps.map((gap) => (
          <GapCard key={gap.id} gap={gap} disposition={undefined} guidelines={guidelines} />
        ))
      )}
      {live.answered.length > 0 && (
        /* Answered prompts are moved, never deleted. A gap the doctor has just
           covered disappearing from under their eye reads as the list losing
           track of the conversation, which is the churn the live design exists
           to avoid (docs/trd.md §20.8.1). */
        <p className="mt-1 text-2xs text-ink-muted">
          {live.answered.length} covered so far:{' '}
          {live.answered.map((gap) => gap.question).join(' · ')}
        </p>
      )}
    </Panel>
  )
}

function Panel({
  title,
  count,
  children,
}: {
  title: string
  /** Absent while there is nothing counted yet, which is not the same as none. */
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-sunken px-1.5 py-0.5 text-2xs text-ink-muted">
            {count}
          </span>
        )}
      </h2>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </section>
  )
}

export type { ClinicalAssertion }
