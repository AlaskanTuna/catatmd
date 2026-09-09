import type {
  CaptureMode,
  ClinicalAssertion,
  ConsultationDetail,
  CopilotProposal,
  Disposition,
  DispositionInput,
  GuidelineChunk,
  MedicalRecordNote,
  NoteTemplate,
  SoapNote,
  TextRange,
  Transcript,
} from '@shared/types'
import { MedicalRecordNoteSchema, toSoapNote } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Maximize2, Pause, Play, Printer, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, Navigate, useParams } from 'react-router-dom'
import type { LivePanes } from '../audio/live/use-live-panes.js'
import { useLivePanes } from '../audio/live/use-live-panes.js'
import { useTranscriptAudio } from '../audio/use-transcript-audio.js'
import { CatatAI } from '../copilot/CatatAI.js'
import { DEMO_CONSULTATION_ID, useDemoTour } from '../demo/DemoTour.js'
import { ApiError, api } from '../lib/api.js'
import { spokenTimestamp } from '../lib/clock.js'
import { cn } from '../lib/cn.js'
import { formatNoteForClipboard } from '../lib/note-templates.js'
import { count } from '../lib/plural.js'
import { useViewportFit } from '../lib/use-viewport-fit.js'
import { ApproveBar } from '../review/ApproveBar.js'
import { ChecklistPanel } from '../review/ChecklistPanel.js'
import {
  ConsultationSettingsDialog,
  type ConsultationSettingsPatch,
} from '../review/ConsultationSettingsDialog.js'
import { LivePrompter } from '../review/LivePrompter.js'
import { GAP_PRIORITY_ORDER, SEVERITY_ORDER } from '../review/live-prompt.js'
import {
  LegacyMedicalRecordView,
  MedicalRecordNoteEditor,
} from '../review/MedicalRecordNoteEditor.js'
import { NoteEditor } from '../review/NoteEditor.js'
import { PrescriptionBlock } from '../review/PrescriptionBlock.js'
import { GapCard, RedFlagCard, SuggestionCard } from '../review/SafetyCards.js'
import { TranscriptCorrections } from '../review/TranscriptCorrections.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { InfoTip } from '../ui/InfoTip.js'
import { PageHeader } from '../ui/PageHeader.js'
import { RenameField } from '../ui/RenameField.js'
import { UncertainLegend, UncertainText } from '../ui/UncertainText.js'
import { CapturePanel } from './CapturePanel.js'

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

/**
 * The settled transcript, wherever it is asked for.
 *
 * One implementation rather than two. It renders in the transcript column and
 * again in the dialog the doctor reopens after Stop, and this file already
 * carried a second copy of the live pane's two-sided grammar; a third is how
 * they start disagreeing about what a turn looks like.
 */
function SettledConversation({
  turns,
  onPlay,
  playing,
}: {
  turns: readonly {
    key: string
    speaker: string
    text: string
    /** Character ranges the recogniser was unsure of, shown underlined (#309). */
    uncertain?: readonly TextRange[]
    offsetSeconds?: number
    endSeconds?: number
  }[]
  /**
   * Plays this turn back from the recording (#293). Absent when the session is
   * holding no audio, which is every reload and every transcript that was
   * pasted, uploaded or typed.
   */
  onPlay?: (key: string, offsetSeconds: number, endSeconds?: number) => void
  /** The turn currently playing, if any. */
  playing?: string
}) {
  return (
    <>
      <ol className="flex flex-col gap-3">
        {turns.map((turn, index) => {
          const opensTurn = turns[index - 1]?.speaker !== turn.speaker
          const doctor = turn.speaker === 'doctor'
          /*
           * Playable only where this turn's own timing is known. A turn without
           * an offset is inert rather than a control that plays the wrong words:
           * the transcript carries no timing at all on the pasted and uploaded
           * paths, and even a recorded one leaves lines split out of the middle
           * of a segment untimed on purpose, because the offset would be a guess.
           *
           * Inert is also the whole state after a reload, since the recording
           * lives in memory only. The affordance is what says which turns can be
           * checked, exactly as the checklist's rows do.
           */
          const at = turn.offsetSeconds
          const playable = at !== undefined && onPlay !== undefined
          const sounding = playing === turn.key
          return (
            <li
              key={turn.key}
              className={cn(
                // Same two-sided rule as the live pane, and the same reason for
                // the two caps: this is 380px in the column, fluid during
                // capture and wide in the dialog, so 62% would break a line
                // every three words in the narrow case.
                'flex flex-col max-w-[88%] @lg:max-w-[62%]',
                doctor ? 'items-start self-start' : 'items-end self-end',
                !opensTurn && '-mt-2',
              )}
            >
              {opensTurn && (
                <span className="mb-1 block">
                  <span
                    className={cn(
                      'rounded-pill px-2 py-0.5 text-2xs font-medium',
                      doctor ? 'bg-surface text-ink-muted' : 'bg-accent-soft text-accent',
                    )}
                  >
                    {doctor ? 'Doctor' : 'Patient'}
                  </span>
                </span>
              )}
              {playable ? (
                /*
                 * The bubble itself is the control, so the target is the thing
                 * the doctor is already reading rather than a separate hit area
                 * beside it.
                 *
                 * The background does not change on hover, and must not: on this
                 * pane the bubble's colour is what says who spoke, and a hover
                 * tint would have a turn briefly claim to be the other speaker.
                 * The icon's opacity carries the affordance instead, which is the
                 * same move `ChecklistPanel` makes for the same reason. Playing
                 * is a ring, a change of shape rather than of colour.
                 */
                <button
                  type="button"
                  onClick={() => onPlay(turn.key, at, turn.endSeconds)}
                  aria-label={`${sounding ? 'Stop' : 'Play'} this turn, ${spokenTimestamp(at)} in`}
                  className={cn(
                    'group flex items-start gap-2 rounded-card px-3 py-2 text-left text-ink text-sm leading-relaxed transition-shadow',
                    doctor ? 'bg-surface' : 'bg-accent-soft',
                    sounding && 'ring-2 ring-accent',
                  )}
                >
                  <span className="min-w-0">
                    <UncertainText text={turn.text} uncertain={turn.uncertain} />
                  </span>
                  {sounding ? (
                    <Pause aria-hidden className="mt-1 size-3 shrink-0 text-accent" />
                  ) : (
                    <Play
                      aria-hidden
                      className="mt-1 size-3 shrink-0 text-accent opacity-45 transition-opacity group-hover:opacity-100"
                    />
                  )}
                </button>
              ) : (
                <p
                  className={cn(
                    'rounded-card px-3 py-2 text-ink text-sm leading-relaxed',
                    doctor ? 'bg-surface' : 'bg-accent-soft',
                  )}
                >
                  <UncertainText text={turn.text} uncertain={turn.uncertain} />
                </p>
              )}
            </li>
          )
        })}
      </ol>
      {/* Said once, and only when something is underlined. Outside the list,
          because a caption is not one of the turns. */}
      {turns.some((turn) => turn.uncertain !== undefined) && (
        <UncertainLegend className="mt-3 text-2xs text-ink-muted" />
      )}
    </>
  )
}

export function ConsultationReview() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [showTranscript, setShowTranscript] = useState(false)
  const [captureBusy, setCaptureBusy] = useState(false)
  /*
   * The consultation's own audio, so a doctor who doubts a transcribed sentence
   * can hear it rather than take it on trust (#293).
   *
   * Owned here because this is the component that knows the consultation id and
   * that outlives `CapturePanel`, which unmounts the instant a transcript
   * exists. The recording is held in memory and never uploaded or stored;
   * `session-audio.ts` says why at length.
   */
  const audio = useTranscriptAudio(id)
  /*
   * The conversation shows in its own full-viewport dialog while capture runs
   * (#287). Held here rather than inside `AmbientCapture` because this
   * component decides where the safety panel goes: the companion column while
   * the theatre is docked, inside the theatre while it is open, never both.
   *
   * Deliberately not persisted. `.claude/rules/security.md` keeps
   * `localStorage` to the theme key, and a remembered "docked" would quietly
   * reintroduce the clipped pane this exists to replace.
   */
  const [conversationExpanded, setConversationExpanded] = useState(false)
  /*
   * The settled conversation, reopened after Stop (#287). The live theatre
   * belongs to `AmbientCapture` because that is where the tokens are; once the
   * transcript is saved the record is here, so this one belongs here.
   */
  const [showConversation, setShowConversation] = useState(false)
  const conversationDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = conversationDialog.current
    if (!node) return
    /*
     * Guarded because jsdom implements neither `showModal` nor `close`. The
     * `open` attribute is what the UA stylesheet keys on, so the fallback still
     * lifts the contents out of `display: none` and into the accessibility
     * tree, which is the part of the difference a test can see.
     */
    if (!showConversation) {
      if (typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
      return
    }
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    // Same reason as the overflow dialog below: `showModal()` autofocuses
    // before conditionally rendered children exist.
    node.querySelector('button')?.focus()
  }, [showConversation])
  const transcriptRef = useRef<HTMLElement>(null)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const bottomBarRef = useRef<HTMLDivElement | null>(null)

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
  const documents = useQuery({
    queryKey: ['guideline-documents'],
    queryFn: api.guidelineDocuments,
  })
  useViewportFit(gridRef, bottomBarRef, [
    consultation.data?.id,
    consultation.data?.analysis === null,
    consultation.data?.status,
    captureBusy,
  ])

  /*
   * What a citation id may resolve to: the CPG chunks retrieved for this
   * analysis plus the ingested source documents. `retrievedGuidelines` is
   * persisted on the analysis so a chunk resolves without re-running retrieval.
   * Document ids are fetched separately and map to the `doc:` references the
   * model may emit.
   *
   * Retrieved chunks are listed first so an id collision keeps the chunk rather
   * than the document summary.
   */
  const citableGuidelines = useMemo(() => {
    const record = isEphemeral ? tour.ephemeral : consultation.data
    const retrieved = record?.analysis?.retrievedGuidelines ?? []
    const docChunks: GuidelineChunk[] = (documents.data ?? []).map((document) => ({
      id: document.id,
      title: document.title,
      publisher: document.publisher,
      year: document.year,
      url: document.sourceUrl,
      summary: '',
      sourceLicence: document.sourceLicence,
      verbatimAllowed: document.verbatimAllowed,
    }))
    const byId = new Map<string, GuidelineChunk>()
    for (const chunk of retrieved) byId.set(chunk.id, chunk)
    for (const chunk of docChunks) {
      if (!byId.has(chunk.id)) byId.set(chunk.id, chunk)
    }
    return [...byId.values()]
  }, [documents.data, isEphemeral, tour.ephemeral, consultation.data])

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
    /*
     * Approval deliberately does not touch the recording (#293).
     *
     * It was released here while the audio lived only in memory. Now that it is
     * stored, the retention window is what bounds it, matching what Abridge and
     * Nuance DAX both do: a doctor who has signed a note is exactly the person
     * a colleague or a patient comes back to with a question about it, and
     * having signed is not a reason to lose the ability to check.
     */
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
      const canonical = current.editedMedicalRecordNote ?? current.analysis?.medicalRecordNote
      if (canonical) {
        if (proposal.section === 'subjective') {
          throw new Error('A categorized note cannot accept an opaque Subjective replacement.')
        }
        const next = await api.patch(id, {
          editedMedicalRecordNote: { [proposal.section]: proposal.text },
        })
        invalidate(next)
        toast.success(`Applied to ${proposal.section}.`)
        return
      }

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
  const patchConsultation = async (body: Parameters<typeof api.patch>[1]) => {
    if (!isEphemeral) return api.patch(id, body)
    const current = tour.ephemeral as ConsultationDetail
    const nextMedicalRecordNote =
      body.editedMedicalRecordNote === undefined
        ? undefined
        : MedicalRecordNoteSchema.parse({
            ...(current.editedMedicalRecordNote ?? current.analysis?.medicalRecordNote),
            ...body.editedMedicalRecordNote,
          })
    return {
      ...current,
      ...(body.noteTemplate === undefined ? {} : { noteTemplate: body.noteTemplate }),
      ...(body.captureMode === undefined ? {} : { captureMode: body.captureMode }),
      ...(body.editedNote ? { editedNote: { ...current.analysis?.note, ...body.editedNote } } : {}),
      ...(nextMedicalRecordNote === undefined
        ? {}
        : {
            editedMedicalRecordNote: nextMedicalRecordNote,
            editedNote: toSoapNote(nextMedicalRecordNote),
          }),
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
  }

  const patch = useMutation({
    mutationFn: patchConsultation,
    onSuccess: (next) => (isEphemeral ? tour.updateEphemeral(next) : invalidate(next)),
    onError: () => toast.error('That change could not be saved. Nothing was changed.'),
  })

  const settings = useMutation({
    mutationFn: (changes: ConsultationSettingsPatch) => patchConsultation(changes),
    onSuccess: (next) => {
      if (isEphemeral) tour.updateEphemeral(next)
      else invalidate(next)
      settingsDialog.current?.close()
    },
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
  // Only ambient capture streams a transcript while it runs; press-to-record
  // engines deliver text when the doctor stops, so during that recording the
  // live safety panel could only ever show its placeholders.
  const liveCapture = captureBusy && detail.captureMode === 'ambient'
  const analysis = detail.analysis
  const approved = detail.status === 'approved'
  const note = detail.editedNote ?? analysis?.note ?? null
  const hasSoapOnlyEdit = detail.editedNote !== null && detail.editedMedicalRecordNote === null
  const medicalRecordNote = hasSoapOnlyEdit
    ? null
    : (detail.editedMedicalRecordNote ?? analysis?.medicalRecordNote ?? null)

  const copyNote = async () => {
    if (!note) return
    try {
      await navigator.clipboard.writeText(
        formatNoteForClipboard(detail.noteTemplate, note, medicalRecordNote),
      )
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

  /*
   * Built once and rendered in exactly one of two places: the companion column
   * while the conversation is docked, or inside the theatre while it is open.
   *
   * One element, one mount. A panel carrying red flags must never exist twice
   * in the accessibility tree, and rendering the same element in both places
   * would create two live instances rather than move one.
   */
  const livePrompter = (
    <LivePrompter
      live={live.panes}
      onShowAll={() =>
        setOverflow({
          title: 'Missing Information',
          findings: [...live.panes.gaps]
            .sort((a, b) => GAP_PRIORITY_ORDER[a.priority] - GAP_PRIORITY_ORDER[b.priority])
            .map((gap) => ({
              id: gap.id,
              node: (
                <GapCard
                  gap={gap}
                  disposition={byId(detail.gapDispositions, gap.id)}
                  onDecide={(decision) => patch.mutate({ gapDispositions: [decision] })}
                  guidelines={citableGuidelines}
                />
              ),
            })),
        })
      }
    />
  )

  return (
    // 80px clears the sticky bar below lg; at lg the hook reserves the bar's
    // height and margin, so 16px is enough to stop the wrapper touching the edge.
    <div className="mx-auto max-w-7xl pb-20 lg:pb-4">
      {/*
        One element for the page, not one per turn. The transcript renders in
        both the column and the dialog, and two media elements would let two
        turns play over each other. No `controls`: the transcript rows are the
        transport, and a scrub bar would invite listening to the consultation
        rather than checking a sentence of it.
      */}
      <audio {...audio.audioProps} className="hidden" />
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
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex items-center gap-2',
                    (analyze.error || !detail.transcript) && 'relative inline-flex',
                  )}
                >
                  <Button
                    variant="primary"
                    size="lg"
                    className={cn((analyze.error || !detail.transcript) && 'pr-12')}
                    icon={<Sparkles className="size-4" />}
                    disabled={!detail.transcript}
                    loading={analyze.isPending || detail.status === 'analyzing'}
                    onClick={() => analyze.mutate()}
                    data-tour="analyse"
                  >
                    {analyze.isPending ? 'Analysing' : 'Analyse Consultation'}
                  </Button>
                  {analyze.error ? (
                    <InfoTip
                      className="absolute top-1/2 right-2 -translate-y-1/2"
                      label="Analysis could not be completed"
                      tone="warning"
                    >
                      Analysis failed. Try again.
                    </InfoTip>
                  ) : !detail.transcript ? (
                    <InfoTip
                      className="absolute top-1/2 right-2 -translate-y-1/2"
                      label="Why this is not available yet"
                      tone="warning"
                    >
                      Add a transcript first.
                    </InfoTip>
                  ) : null}
                </div>
              </div>
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
              data-tour="capture-settings"
              variant="neutral"
              size="lg"
              aria-label="Consultation Settings"
              title="Consultation Settings"
              disabled={captureBusy || capture.isPending || settings.isPending}
              icon={<Settings2 aria-hidden className="size-4" />}
              onClick={() => {
                settings.reset()
                settingsDialog.current?.showModal()
              }}
            />
            <Button
              className="lg:hidden"
              onClick={() => setShowTranscript((value) => !value)}
              aria-expanded={showTranscript}
            >
              {showTranscript ? 'Hide Transcript' : 'Transcript'}
            </Button>
            {approved && note && (
              <Button size="lg" icon={<Copy aria-hidden className="size-4" />} onClick={copyNote}>
                Copy Note
              </Button>
            )}
            {approved && (
              <Button
                size="lg"
                icon={<Printer aria-hidden className="size-4" />}
                onClick={() => window.print()}
              >
                Export
              </Button>
            )}
          </>
        }
      />

      <ConsultationSettingsDialog
        key={`${detail.noteTemplate}-${detail.captureMode}`}
        ref={settingsDialog}
        noteTemplate={detail.noteTemplate}
        captureMode={detail.captureMode}
        captureModeLocked={detail.transcript !== null}
        saving={settings.isPending}
        error={
          settings.error instanceof ApiError
            ? settings.error.message
            : settings.error
              ? 'That change could not be saved. Nothing was changed.'
              : null
        }
        onSave={(changes) => settings.mutate(changes)}
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
      {/*
        The tracks swap on the one phase change that matters, and during
        capture the screen drops to two columns (#278).

        While the doctor is talking the note is deliberately a placeholder, so
        it is not merely narrow, it is four rows of grey bars occupying a
        column. The rail beside it held twenty-eight gap cards with 264px of
        them below the fold, which nobody reads mid-sentence. Both are hidden
        rather than removed, and both return at Stop; `LivePrompter` carries
        what is actually readable in a glance and takes the 380px.

        Severity stays visible without scrolling, which is the docs/DESIGN.md
        requirement the rail's fixed 340px used to serve. It is better served
        here: the prompter's red-flag section is permanent and above the fold,
        where a rail hit could sit at position one of thirty-two with the
        panel scrolled away.
      */}
      <div
        ref={gridRef}
        className={cn(
          'mt-6 grid gap-5',
          // `captureBusy` rather than a second signal of my own: #272 already
          // lifts exactly this from `AmbientCapture`'s `onLiveChange`, and two
          // props tracking one session is one of them going stale.
          liveCapture
            ? 'lg:grid-cols-[minmax(0,1fr)_380px]'
            : captureBusy
              ? 'lg:grid-cols-1'
              : 'lg:grid-cols-[380px_minmax(0,1fr)_340px]',
        )}
      >
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
            /*
             * The ceiling is measured from the DOM, not guessed, because the
             * header band and bottom bar change height with the consultation
             * state. A fixed `13rem` assumed the same band for every state and
             * overflowed the page by 234px at 1440x900.
             */
            // A fixed height, where the other two columns cap theirs: a
            // transcript is usually shorter than the note beside it, and a
            // capped column ends where its content ends, so the three
            // columns only bottom-align if this one is held to the floor and
            // its card is let grow into it.
            // The floor is conditional on an analysis being present.
            // Without one, the note and rail are short empty cards, and a fixed
            // height would stand this column a full viewport tall beside them.
            analysis
              ? 'lg:h-[var(--review-columns-height)]'
              : 'lg:max-h-[var(--review-columns-height)]',
            'lg:overflow-y-auto lg:pr-1 lg:flex lg:flex-col lg:[&>*:last-child]:grow lg:[&>*:last-child]:shrink-0',
            // The mobile show/hide belongs to a transcript that already
            // exists. Capture is the one thing on this screen a doctor has
            // come here to do, so it is never behind a toggle.
            detail.transcript && !showTranscript ? 'hidden lg:block' : 'block',
          )}
          aria-labelledby="transcript-heading"
          data-tour="transcript"
          data-print="hide"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="transcript-heading" className="text-sm font-semibold">
              Transcript
            </h2>
            {/*
              The way back into the conversation once it is settled. The column
              is 380px and the transcript is the one thing on this page that is
              read rather than scanned, so it gets a surface of its own on
              demand instead of a taller column nobody asked for.
            */}
            {detail.transcript && (
              <Button
                size="sm"
                variant="neutral"
                icon={<Maximize2 aria-hidden className="size-3.5" />}
                onClick={() => setShowConversation(true)}
              >
                View Conversation
              </Button>
            )}
          </div>
          {/* The column itself scrolls from `lg` up, so the inner cap is
              released there rather than nesting one scrollbar inside another.
              Below `lg` the column is uncapped and this is what stops a long
              transcript running the page. */}
          {/*
            The settled transcript takes the same turn-per-row shape the live
            pane uses, so the transcript does not change its reading rules the
            moment capture stops. Two differences, both earned: the roles are
            real here, because `draftHostedTurns` has run, and the type is 14px
            rather than 12px, which is the documented body floor and is most of
            what made this read as a wall.
          */}
          {detail.transcript && (
            <div className="@container max-h-[70vh] overflow-y-auto rounded-card bg-sunken p-4 lg:max-h-none lg:overflow-visible">
              {/*
                Sides, not a single left edge, matching the live pane (#278).
                The doctor keeps the left because that is where they sat while
                the words were arriving; a transcript that reflowed at Stop
                would make the reader re-find the thread.

                One rule holds across both panes: the right speaker takes
                `accent-soft`, and the left takes whichever neutral contrasts
                with the ground. That is `surface` here and `sunken` in the
                live pane, because the two grounds are the other way round.
              */}
              <SettledConversation
                turns={keyedTurns}
                onPlay={audio.available ? audio.play : undefined}
                playing={audio.playing}
              />
            </div>
          )}
          {/*
            Corrections sit under the conversation and only while the note has
            not been built yet (#308). Past `draft` the note was generated from
            these words, so changing them would leave it grounded in text the
            record no longer holds, and the API refuses for the same reason.
          */}
          {detail.transcript && detail.status === 'draft' && (
            <div className="mt-3">
              <TranscriptCorrections
                consultationId={id}
                transcript={detail.transcript}
                onSaved={(next) => queryClient.setQueryData(['consultation', id], next)}
              />
            </div>
          )}
          {!detail.transcript && (
            <Card className="flex flex-col p-4">
              <CapturePanel
                captureMode={detail.captureMode}
                saving={capture.isPending}
                error={
                  capture.error instanceof ApiError
                    ? capture.error.message
                    : capture.error
                      ? 'Could not save the transcript.'
                      : null
                }
                onCapture={(transcript) => capture.mutate(transcript)}
                onRecording={audio.keep}
                onLiveSegments={live.absorb}
                onCaptureModeChange={(captureMode: CaptureMode) => patch.mutate({ captureMode })}
                /*
                 * Deliberately does not open the theatre. This fires for
                 * press-to-record as well, which has no live conversation and
                 * so no dialog to put the safety panel in: opening from here
                 * withheld the companion column during a manual recording and
                 * left the prompter nowhere at all. `AmbientCapture` asks for
                 * the theatre itself, when its own session starts.
                 */
                onCaptureBusyChange={setCaptureBusy}
                conversationExpanded={conversationExpanded}
                onConversationExpandedChange={setConversationExpanded}
                prompter={livePrompter}
                patientName={detail.patient?.name ?? undefined}
              />
            </Card>
          )}
        </section>

        {/*
          The one thing on screen during capture that is neither the
          conversation nor a placeholder for something that has not happened
          yet (#278).

          `order-1` below `lg`, so on a narrow screen the safety section is
          first in source order, which is the only way "visible without
          scrolling" can mean anything there. That is the rule the rail
          followed and the reason it never became a tab.
        */}
        {liveCapture && !conversationExpanded && (
          <section className="order-1 min-w-0 lg:sticky lg:top-6 lg:order-2 lg:max-h-[var(--review-columns-height)] lg:overflow-y-auto lg:pr-1">
            {livePrompter}
          </section>
        )}

        <section
          className={cn(
            'order-2 min-w-0',
            // Hidden, never unmounted: the note placeholder and its live
            // checklist keep their state across the capture, and Stop brings
            // them straight back rather than rebuilding them.
            //
            // The layout is withheld rather than overridden, because `hidden`
            // appended to it does nothing above `lg` (#282). Tailwind emits
            // `lg:flex` into a `min-width: 64rem` block later in the same
            // `@layer utilities` as the base `hidden` rule, so above `lg` it
            // wins on order, and `cn()` cannot collapse the pair because a
            // variant makes them different utilities rather than a conflict.
            // Measured on production at 1440x900: the column carried `hidden`
            // and computed `display: flex`, which put a third item in the
            // two-column capture grid, wrapped it onto a second row, and
            // overflowed the page by 738px mid-consultation. The rail below
            // never had this, because its `flex` carries no variant.
            captureBusy
              ? 'hidden'
              : 'lg:sticky lg:top-6 lg:max-h-[var(--review-columns-height)] lg:overflow-y-auto lg:pr-1 lg:flex lg:flex-col lg:[&>*:last-child]:grow lg:[&>*:last-child]:shrink-0',
          )}
          aria-labelledby="note-heading"
          data-print="expand"
        >
          <h2 id="note-heading" className="mb-2 text-sm font-semibold" data-print="hide">
            Clinical Note
          </h2>
          {analysis && note ? (
            <>
              {medicalRecordNote && analysis.medicalRecordNote ? (
                <MedicalRecordNoteEditor
                  note={medicalRecordNote}
                  aiNote={analysis.medicalRecordNote}
                  template={detail.noteTemplate}
                  readOnly={approved}
                  saving={patch.isPending}
                  onSave={(editedMedicalRecordNote: Partial<MedicalRecordNote>) =>
                    patch.mutate({ editedMedicalRecordNote })
                  }
                />
              ) : detail.noteTemplate === 'malaysian' ? (
                <LegacyMedicalRecordView note={note} aiNote={analysis.note} />
              ) : (
                <NoteEditor
                  note={note}
                  aiNote={analysis.note}
                  readOnly={approved}
                  saving={patch.isPending}
                  onSave={(editedNote: Partial<SoapNote>) => patch.mutate({ editedNote })}
                />
              )}
              {/*
                Above the checklist, because a prescription belongs beside the
                plan it came out of while the checklist is a review of what the
                note is missing. It is also what keeps the column's
                `[&>*:last-child]:grow` on the panel that has always carried it.

                Not in the tour: the ephemeral consultation has no row, so the
                parse route would 404 on an id no database holds.
              */}
              {!isEphemeral && (
                <PrescriptionBlock
                  consultationId={id}
                  prescriptions={detail.prescriptions}
                  status={detail.status}
                  onSave={(prescriptions) => patch.mutateAsync({ prescriptions })}
                />
              )}
              <ChecklistPanel
                clinicalFacts={analysis.clinicalFacts}
                operational={analysis.operational}
                evidenceLinks={analysis.evidenceLinks}
              />
            </>
          ) : (
            <>
              <NotePlaceholder template={detail.noteTemplate} />
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
          className={cn(
            'order-1 flex flex-col gap-5 lg:sticky lg:top-6 lg:order-3 lg:max-h-[var(--review-columns-height)] lg:overflow-y-auto lg:pr-1 lg:[&>section]:grow lg:[&>section]:shrink-0',
            captureBusy && 'hidden',
          )}
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
                      guidelines={citableGuidelines}
                      onPlay={audio.available ? audio.play : undefined}
                      playing={audio.playing}
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
                      guidelines={citableGuidelines}
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
                     assert the corpus was consulted when nobody knows.
                     A retrieval that returned no passages is also distinct from
                     an out-of-scope consultation, so it is not read as the corpus
                     having nothing to say. */
                  analysis.outOfScope === true
                    ? 'Outside the guideline corpus\u2019s scope, so no suggestions were offered.'
                    : analysis.outOfScope === false
                      ? (analysis.retrievedGuidelines == null ||
                          analysis.retrievedGuidelines.length === 0) &&
                        analysis.suggestions.length === 0
                        ? 'No guideline passages were retrieved for this consultation, so no suggestions were offered.'
                        : 'Within the guideline corpus\u2019s scope, with nothing to suggest for this consultation.'
                      : 'No cited suggestions. This consultation was analysed before scope was recorded, so whether the corpus applied is not known.'
                }
                findings={analysis.suggestions.map((suggestion) => ({
                  id: suggestion.id,
                  node: <SuggestionCard suggestion={suggestion} guidelines={citableGuidelines} />,
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

      {/*
        The settled conversation on a surface worth reading it on (#287).

        Read only, deliberately. The transcript is the record the note was
        written from, and this is a way to go back to it, not a second place to
        edit it.
      */}
      <dialog
        ref={conversationDialog}
        data-print="hide"
        onClose={() => setShowConversation(false)}
        aria-labelledby="conversation-title"
        className="glass-panel m-auto h-[min(85vh,48rem)] w-[min(56rem,calc(100vw-2rem))] max-w-none rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {showConversation && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
              <h2 id="conversation-title" className="font-display text-lg font-semibold">
                Conversation
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {count(keyedTurns.length, 'turn')}
                </span>
              </h2>
              {/* First in the DOM, and so the one the open effect focuses. */}
              <Button size="sm" variant="neutral" onClick={() => setShowConversation(false)}>
                Close
              </Button>
            </div>
            <div className="@container min-h-0 flex-1 overflow-y-auto bg-sunken p-6">
              <SettledConversation
                turns={keyedTurns}
                onPlay={audio.available ? audio.play : undefined}
                playing={audio.playing}
              />
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
          ref={bottomBarRef}
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
 * The headings are the selected format's sections in the order they will
 * fill, so the shape of the output is legible before there is any and the
 * empty note follows the same format switch the filled one does. Ruled lines
 * rather than pulsing skeletons: nothing is loading here, and a shimmer would
 * promise work in progress when the doctor has not started any.
 */
const PLACEHOLDER_SECTIONS: Record<NoteTemplate, readonly string[]> = {
  soap: ['Subjective', 'Objective', 'Assessment', 'Plan'],
  malaysian: [
    'Presenting Complaint',
    'History of Presenting Complaint',
    'Past Medical History',
    'Social History',
    'Family History',
    'Objective',
    'Assessment',
    'Plan',
  ],
}

function NotePlaceholder({ template }: { template: NoteTemplate }) {
  return (
    <Card className="overflow-hidden p-0" data-print="hide">
      {PLACEHOLDER_SECTIONS[template].map((section) => (
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
    /*
       "None so far" is a clinical claim, and the pane may only make it when a
       check actually ran and returned. A stalled or not-yet-succeeded live
       check renders as exactly that, because a panel asserting an absence it
       did not establish is the false negative this engine exists to prevent.
    */
    const unearnedAbsence = live.flagsStalled || !live.flagsChecked

    return (
      <Panel title={title} count={flags.length}>
        {flags.length === 0 && unearnedAbsence ? (
          <p className="text-sm text-emergency">
            {live.flagsStalled
              ? 'Live safety checks have stopped. Press Analyse to run the full check.'
              : 'Waiting for the first safety check.'}
          </p>
        ) : flags.length === 0 ? (
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
