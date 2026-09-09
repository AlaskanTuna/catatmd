import type {
  ClinicalSuggestion,
  Disposition,
  DispositionInput,
  GapSource,
  GuidelineChunk,
  InformationGap,
  RedFlag,
} from '@shared/types'
import {
  AlertTriangle,
  Check,
  CircleAlert,
  HelpCircle,
  Info,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { spokenTimestamp } from '../lib/clock.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

/**
 * One severity grammar, from the NHS care-card pattern: solid card, coloured
 * top rule, icon, word label, ink body. Never a tinted passage, never a left
 * stripe, and never colour as the only channel (WCAG 1.4.1).
 */
export const SEVERITY = {
  emergency: {
    label: 'Emergency',
    rule: 'bg-emergency-rule',
    text: 'text-emergency',
    Icon: CircleAlert,
  },
  urgent: { label: 'Urgent', rule: 'bg-urgent-rule', text: 'text-urgent', Icon: AlertTriangle },
  advisory: { label: 'Advisory', rule: 'bg-advisory-rule', text: 'text-advisory', Icon: Info },
} as const

const STATE_LABEL = {
  acknowledged: 'Acknowledged, retained in the record',
  dismissed: 'Dismissed, retained in the record',
  not_applicable: 'Not clinically applicable, retained in the record',
} as const

/**
 * The three-way decision on a finding (issue #10, AC4).
 *
 * **Every terminal label says "retained in the record", and that is the point.**
 * A doctor dismissing an escalation trigger needs to see that they are recording
 * a judgement rather than deleting a warning, because a control that reads like
 * deletion invites clearing the rail to make it quiet.
 *
 * A reason is required to dismiss and cannot be given otherwise. Dismissing is
 * the only one of the three that sets aside a safety signal on the doctor's own
 * authority, so it is the one that has to be defensible later. Putting a
 * mandatory box on the other two would train people to type "n/a" until the
 * field means nothing.
 *
 * None of the three turns green. Green means approved on this screen, and a
 * doctor should not have to hold two meanings for one colour.
 */
function DispositionControl({
  findingId,
  disposition,
  onDecide,
  acknowledgeLabel,
  guidelineIds,
  guidelines,
  gapSource,
}: {
  findingId: string
  disposition: Disposition | undefined
  onDecide: (decision: DispositionInput) => void
  acknowledgeLabel: string
  guidelineIds?: readonly string[]
  guidelines: GuidelineChunk[]
  gapSource?: GapSource
}) {
  const [mode, setMode] = useState<'settled' | 'choosing' | 'reason'>('settled')
  const [reason, setReason] = useState('')
  const [showSources, setShowSources] = useState(false)
  const reasonId = `dismiss-reason-${findingId}`

  if (disposition && mode === 'settled') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <Check aria-hidden className="size-3.5" />
          {STATE_LABEL[disposition.state]}
        </span>
        {disposition.reason && (
          <span className="text-xs text-ink-muted">
            <span className="font-medium text-ink">Reason:</span> {disposition.reason}
          </span>
        )}
        <button
          type="button"
          onClick={() => setMode('choosing')}
          className="rounded-control px-1.5 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-sunken"
        >
          Change
        </button>
      </div>
    )
  }

  if (mode === 'reason') {
    const trimmed = reason.trim()
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={reasonId} className="text-xs font-medium text-ink">
          Why are you dismissing this?
        </label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-control border border-line bg-surface p-2 text-sm text-ink outline-none focus-visible:border-accent"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={trimmed.length === 0}
            onClick={() => {
              onDecide({ id: findingId, state: 'dismissed', reason: trimmed })
              setMode('settled')
              setReason('')
            }}
          >
            Confirm Dismissal
          </Button>
          <Button size="sm" variant="neutral" onClick={() => setMode('settled')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  /*
   * Two controls at rest, not three.
   *
   * All three decisions are equally available, but they are not equally
   * frequent: acknowledging is the common one and the other two are
   * exceptions. Three peer buttons on every card read as a wall once a
   * consultation raises six findings, and a wall is scanned rather than read —
   * which is the failure mode a safety rail can least afford. The alternatives
   * expand in place rather than hiding behind a menu, so nothing is more than
   * one press away and none of it moves.
   */
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            onDecide({ id: findingId, state: 'acknowledged' })
            setMode('settled')
          }}
        >
          {acknowledgeLabel}
        </Button>
        <Button
          size="sm"
          variant="neutral"
          aria-expanded={mode === 'choosing'}
          onClick={() => setMode(mode === 'choosing' ? 'settled' : 'choosing')}
        >
          {mode === 'choosing' ? 'Fewer Options' : 'More Options'}
        </Button>
      </div>

      {mode === 'choosing' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="neutral" onClick={() => setMode('reason')}>
            Dismiss
          </Button>
          <Button
            size="sm"
            variant="neutral"
            onClick={() => {
              onDecide({ id: findingId, state: 'not_applicable' })
              setMode('settled')
            }}
          >
            Not Applicable
          </Button>
          <Button
            size="sm"
            variant="neutral"
            aria-expanded={showSources}
            onClick={() => setShowSources((open) => !open)}
          >
            Sources
          </Button>
        </div>
      )}

      {mode === 'choosing' && showSources && (
        <SourcesPanel guidelineIds={guidelineIds} guidelines={guidelines} gapSource={gapSource} />
      )}
    </div>
  )
}

/**
 * Strips quotation marks the model wrapped around its own evidence span.
 *
 * The card quotes the phrase itself, so a model that also quoted it rendered
 * as ""sesak bila naik tangga"" on screen. Handled here rather than in the
 * parser because the stored value should stay byte-identical to what the model
 * returned — the audit trail and the evidence check both read it, and quietly
 * rewriting model output on the way into the database is a worse habit than
 * tidying it on the way onto a screen.
 *
 * Only matched pairs are removed, and only at the ends, so a phrase containing
 * a quote in the middle is left alone.
 */
function unquote(evidence: string): string {
  let text = evidence.trim()
  while (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    const paired =
      (first === '"' && last === '"') ||
      (first === '\u201c' && last === '\u201d') ||
      (first === "'" && last === "'")
    if (!paired) break
    text = text.slice(1, -1).trim()
  }
  return text
}

const sourceChipClass =
  'inline-flex min-h-6 items-center rounded-full border border-line bg-sunken px-2.5 py-1 font-mono text-2xs text-ink'

function SourcesPanel({
  guidelineIds,
  guidelines,
  gapSource,
}: {
  guidelineIds?: readonly string[]
  guidelines: GuidelineChunk[]
  gapSource?: GapSource
}) {
  if (gapSource?.kind === 'unsourced') {
    const version = (gapSource as { version?: { id: string } }).version?.id
    return (
      <div className="flex flex-col gap-2">
        <span className={sourceChipClass}>
          {version ? `checklist ${version}` : 'record checklist'}
        </span>
        <p className="text-sm text-ink-muted">{gapSource.reason}</p>
      </div>
    )
  }

  const ids = gapSource?.kind === 'guideline' ? gapSource.guidelineIds : guidelineIds
  const resolved = (ids ?? [])
    .map((id) => guidelines.find((g) => g.id === id))
    .filter((chunk): chunk is GuidelineChunk => chunk !== undefined)

  if (resolved.length > 0) {
    /*
     * Each row sits on `surface`, not `sunken`, so the id chip keeps the
     * contrast it has on a Suggestion card. A `sunken` chip on a `sunken` row is
     * the same fill twice and reads as flat.
     */
    return (
      <div className="flex flex-col gap-2">
        {resolved.map((chunk) => (
          <div key={chunk.id} className="rounded-control border border-line bg-surface p-3">
            <span className={sourceChipClass}>{chunk.id}</span>
            <p className="mt-2 text-xs font-medium text-ink">{chunk.title}</p>
            <p className="mt-0.5 text-2xs text-ink-muted">
              {chunk.publisher} · {chunk.year}
            </p>
            <a
              href={chunk.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
            >
              Open Guideline
            </a>
          </div>
        ))}
      </div>
    )
  }

  if (gapSource?.kind === 'guideline') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {gapSource.guidelineIds.map((id) => (
          <span key={id} className={sourceChipClass}>
            {id}
          </span>
        ))}
      </div>
    )
  }

  return <p className="text-sm text-ink-muted">No guideline citation.</p>
}

export function RedFlagCard({
  flag,
  disposition,
  onDecide,
  guidelines,
  onPlay,
  playing,
}: {
  flag: RedFlag
  disposition: Disposition | undefined
  /**
   * Plays the sentence that raised this flag (#293).
   *
   * A red flag is the highest-stakes thing on this screen and it rests on one
   * quoted span, so being able to hear that span is worth more here than
   * anywhere else on the page. Absent when the session holds no recording, or
   * when the span could not be placed in exactly one turn.
   */
  onPlay?: (key: string, offsetSeconds: number, endSeconds?: number) => void
  /** The key currently playing, so this card can show it is the one. */
  playing?: string
  /**
   * Omitted while a consultation is still being captured (#219). There is
   * nothing to record a disposition against yet: `PATCH /consultations/:id`
   * gates the clinical fields on `awaiting_review` and the record is still
   * `draft`, so an enabled control would offer an action the API refuses.
   */
  onDecide?: (decision: DispositionInput) => void
  guidelines: GuidelineChunk[]
}) {
  const severity = SEVERITY[flag.severity]
  const acknowledged = disposition !== undefined
  /*
   * Playable only when the span was placed in exactly one turn *and* that turn
   * carried timing. Both halves are resolved server-side and either can be
   * absent, so a flag with no way to be heard keeps the plain quote it has
   * always had rather than gaining a control that would go nowhere.
   */
  const heardAt = flag.evidenceLink?.offsetSeconds
  const audible = heardAt !== undefined && onPlay !== undefined
  const key = `flag-${flag.id}`
  const sounding = playing === key

  return (
    <Card className="overflow-hidden" data-tour={`flag-${flag.severity}`}>
      <div aria-hidden className={cn('h-1 w-full', acknowledged ? 'bg-line' : severity.rule)} />
      <div className="p-4">
        <div className="flex items-start gap-2">
          <severity.Icon
            aria-hidden
            className={cn(
              'mt-0.5 size-4 shrink-0',
              acknowledged ? 'text-ink-muted' : severity.text,
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  'text-2xs font-semibold uppercase tracking-wide',
                  acknowledged ? 'text-ink-muted' : severity.text,
                )}
              >
                {severity.label}
              </span>
              <ProvenanceMark source={flag.source} />
            </div>
            <h3 className="mt-1 text-sm font-semibold text-ink">{flag.label}</h3>
            {audible ? (
              /*
               * The quote itself is the control, so the doctor presses the
               * words they are questioning. `-mx-1 px-1` keeps the text on the
               * same left edge as the heading above it: a control that indented
               * its own quote would break the card's one text column.
               */
              <button
                type="button"
                onClick={() => onPlay(key, heardAt, flag.evidenceLink?.endSeconds)}
                aria-label={`${sounding ? 'Stop' : 'Play'} what was heard, ${spokenTimestamp(heardAt)} in`}
                className={cn(
                  'group -mx-1 mt-1 flex items-start gap-1.5 rounded-control px-1 py-0.5 text-left text-sm text-ink-muted transition-colors hover:bg-sunken',
                  sounding && 'bg-sunken',
                )}
              >
                <span className="min-w-0">
                  <span className="font-medium text-ink">Heard:</span> &ldquo;
                  {unquote(flag.evidence)}&rdquo;
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
              <p className="mt-1 text-sm text-ink-muted">
                <span className="font-medium text-ink">Heard:</span> &ldquo;{unquote(flag.evidence)}
                &rdquo;
              </p>
            )}
          </div>
        </div>

        {onDecide && (
          <div className="mt-3">
            <DispositionControl
              findingId={flag.id}
              disposition={disposition}
              onDecide={onDecide}
              acknowledgeLabel="Acknowledge"
              guidelineIds={flag.guidelineIds}
              guidelines={guidelines}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Rule-sourced and model-sourced are distinguishable without a legend.
 *
 * This is load-bearing rather than decorative: a deterministic rule hit may
 * never be suppressed or downgraded by the model, and a doctor deciding how
 * much weight to give a flag needs to know which kind they are looking at
 * (AGENTS.md, clinical-safety do-nots).
 */
function ProvenanceMark({ source }: { source: RedFlag['source'] }) {
  return source === 'rule' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink/8 px-2 py-0.5 text-2xs font-medium text-ink">
      <ShieldCheck aria-hidden className="size-3" />
      Rule
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-muted/50 px-2 py-0.5 text-2xs font-medium text-ink-muted">
      AI Suggested
    </span>
  )
}

const GAP_PRIORITY = {
  high: 'Ask First',
  medium: 'Worth Asking',
  low: 'If Time Allows',
} as const

export function GapCard({
  gap,
  disposition,
  onDecide,
  guidelines,
}: {
  gap: InformationGap
  disposition: Disposition | undefined
  /** Omitted during live capture, for the reason `RedFlagCard` gives. */
  onDecide?: (decision: DispositionInput) => void
  guidelines: GuidelineChunk[]
}) {
  const reviewed = disposition !== undefined
  return (
    /* Gaps are not severity. A gap is a prompt to ask something, not a
       warning, so it renders as a dotted-outline card in muted ink rather
       than borrowing the alarm colours (docs/DESIGN.md). */
    <div
      data-tour="gap"
      className={cn(
        'rounded-card border border-dashed p-4 page-break-avoid',
        reviewed ? 'border-line bg-sunken' : 'border-ink-muted/40 bg-surface',
      )}
    >
      <div className="flex items-start gap-2">
        <HelpCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <div className="min-w-0 flex-1">
          <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            {GAP_PRIORITY[gap.priority]}
          </span>
          <h3 className="mt-1 text-sm font-medium text-ink">{gap.question}</h3>
          <p className="mt-1 text-sm text-ink-muted">{gap.rationale}</p>
        </div>
      </div>
      {onDecide && (
        <div className="mt-3">
          <DispositionControl
            findingId={gap.id}
            disposition={disposition}
            onDecide={onDecide}
            acknowledgeLabel="Mark Reviewed"
            guidelines={guidelines}
            gapSource={gap.source}
          />
        </div>
      )}
    </div>
  )
}

export function SuggestionCard({
  suggestion,
  guidelines,
}: {
  suggestion: ClinicalSuggestion
  guidelines: GuidelineChunk[]
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <Card className="p-4" data-tour="suggestion">
      <p className="text-sm text-ink">{suggestion.text}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {suggestion.citations.map((citation) => {
          const chunk = guidelines.find((g) => g.id === citation.guidelineId)
          const open = openId === citation.guidelineId
          return (
            <div key={citation.guidelineId} className="w-full">
              {/* The chip is the guideline ID itself, echoing the
                  ID-constrained backend contract in the UI: the model may only
                  cite ids from the supplied corpus, so a hallucinated reference
                  fails schema validation rather than reaching this chip. */}
              <button
                type="button"
                onClick={() => setOpenId(open ? null : citation.guidelineId)}
                aria-expanded={open}
                className="inline-flex min-h-6 items-center rounded-full border border-line bg-sunken px-2.5 py-1 font-mono text-2xs text-ink transition-colors hover:border-accent hover:text-accent"
              >
                {citation.guidelineId}
              </button>
              {open && chunk && (
                <div className="mt-2 rounded-control border border-line bg-sunken p-3">
                  <p className="text-xs font-medium text-ink">{chunk.title}</p>
                  <p className="mt-0.5 text-2xs text-ink-muted">
                    {chunk.publisher} · {chunk.year}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">{chunk.summary}</p>
                  {chunk.quote ? (
                    <blockquote className="mt-2 border-l-2 border-line pl-2 text-xs italic text-ink-muted">
                      {chunk.quote}
                    </blockquote>
                  ) : (
                    /* Absence of a quote is a licence fact, not missing data,
                       and saying so stops it reading as a bug. */
                    <p className="mt-2 text-2xs text-ink-muted">
                      Licence ({chunk.sourceLicence}) does not permit verbatim quotation.
                    </p>
                  )}
                  <a
                    href={chunk.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
                  >
                    Open Guideline
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
