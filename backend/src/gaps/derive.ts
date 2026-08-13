import type { AssertionState, ClinicalFacts, InformationGap, OperationalBlock } from '@shared/types'
import { GAP_CHECKLIST, type GapChecklistEntry } from './checklist.js'

/**
 * A field the transcript never touched is the same fact seen from two sides
 * as a `NOT_ASSESSED`/`UNKNOWN` state (docs/prd.md §10) — `DENIED` and
 * `PRESENT` are documented, not gaps (GitHub issue #6 acceptance criteria).
 */
const GAP_STATES: ReadonlySet<AssertionState> = new Set(['NOT_ASSESSED', 'UNKNOWN'])

/**
 * Tier-2 deterministic control (docs/trd.md §21.3): gap derivation from
 * assertion states, not a prompt. Pure function — no I/O, no LLM call, no
 * database, no clock, no randomness — over the fixed 29-key `ClinicalFacts`
 * set plus the Malaysian operational block. See `checklist.ts` for the
 * materiality rule deciding which fields are eligible to raise a gap.
 */
export function deriveGaps(
  facts: ClinicalFacts,
  operational: OperationalBlock,
  checklist: readonly GapChecklistEntry[] = GAP_CHECKLIST,
): InformationGap[] {
  const gaps: InformationGap[] = []

  for (const entry of checklist) {
    const assertion = entry.select(facts, operational)
    if (!GAP_STATES.has(assertion.state)) continue

    gaps.push({
      id: entry.id,
      question: entry.question,
      rationale: entry.rationale,
      priority: entry.priority,
    })
  }

  return gaps
}
