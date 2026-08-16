import type {
  ClinicalSuggestion,
  Disposition,
  DispositionInput,
  GuidelineChunk,
  InformationGap,
  RedFlag,
} from '@shared/types'
import { AlertTriangle, Check, CircleAlert, HelpCircle, Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

/**
 * One severity grammar, from the NHS care-card pattern: solid card, coloured
 * top rule, icon, word label, ink body. Never a tinted passage, never a left
 * stripe, and never colour as the only channel (WCAG 1.4.1).
 */
const SEVERITY = {
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
}: {
  findingId: string
  disposition: Disposition | undefined
  onDecide: (decision: DispositionInput) => void
  acknowledgeLabel: string
}) {
  const [mode, setMode] = useState<'settled' | 'choosing' | 'reason'>('settled')
  const [reason, setReason] = useState('')
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

  return (
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
    </div>
  )
}

export function RedFlagCard({
  flag,
  disposition,
  onDecide,
}: {
  flag: RedFlag
  disposition: Disposition | undefined
  onDecide: (decision: DispositionInput) => void
}) {
  const severity = SEVERITY[flag.severity]
  const acknowledged = disposition !== undefined

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
            <p className="mt-1 text-sm text-ink-muted">
              <span className="font-medium text-ink">Heard:</span> &ldquo;{flag.evidence}&rdquo;
            </p>
          </div>
        </div>

        <div className="mt-3">
          <DispositionControl
            findingId={flag.id}
            disposition={disposition}
            onDecide={onDecide}
            acknowledgeLabel="Acknowledge"
          />
        </div>
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
}: {
  gap: InformationGap
  disposition: Disposition | undefined
  onDecide: (decision: DispositionInput) => void
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
      <div className="mt-3">
        <DispositionControl
          findingId={gap.id}
          disposition={disposition}
          onDecide={onDecide}
          acknowledgeLabel="Mark Reviewed"
        />
      </div>
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
