import type { AssertionState } from '@shared/types'
import { cn } from '../lib/cn.js'

/**
 * The six states, rendered as a fixed vocabulary.
 *
 * `NOT_ASSESSED` is the reason this component exists. `docs/prd.md` §10
 * requires that a field the consultation never touched reads as *unestablished*
 * rather than as absent or normal, and §21.1 measured a model fabricating
 * "denies haemoptysis" in 5 of 5 runs without that guarantee. So the state is
 * never rendered as an empty cell, never greyed to the edge of legibility, and
 * never omitted from the list.
 *
 * No state is signalled by colour alone: each carries a word.
 */
const LABELS: Record<AssertionState, string> = {
  PRESENT: 'Present',
  DENIED: 'Denied',
  CLINICIAN_OBSERVED: 'Observed',
  NOT_ASSESSED: 'Not Assessed',
  UNKNOWN: 'Unknown',
  NOT_APPLICABLE: 'N/A',
}

const STYLES: Record<AssertionState, string> = {
  PRESENT: 'bg-accent-soft text-accent border-accent/25',
  DENIED: 'bg-sunken text-ink border-line',
  CLINICIAN_OBSERVED: 'bg-advisory/12 text-advisory border-advisory/25',
  // Deliberately legible rather than faint. A doctor scanning for what was
  // never covered must be able to find it at a glance.
  NOT_ASSESSED: 'bg-transparent text-ink-muted border-ink-muted/40 border-dashed',
  UNKNOWN: 'bg-transparent text-ink-muted border-ink-muted/40 border-dashed',
  NOT_APPLICABLE: 'bg-transparent text-ink-muted/80 border-line',
}

export function AssertionStateBadge({
  state,
  className,
}: {
  state: AssertionState
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5',
        'text-2xs font-medium whitespace-nowrap',
        STYLES[state],
        className,
      )}
    >
      {LABELS[state]}
    </span>
  )
}

export const assertionLabel = (state: AssertionState) => LABELS[state]
