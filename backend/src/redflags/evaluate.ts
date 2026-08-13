import type { RedFlag, Transcript } from '@shared/types'
import { REDFLAG_TRIGGERS } from './triggers.js'

/**
 * Pure function over the transcript directly (docs/trd.md §10, Engine
 * Posture): no I/O, no LLM call, no database access, no clock, no
 * randomness. Runs independently of, and is never gated by, the model call.
 */
export function evaluateRedFlags(transcript: Transcript): RedFlag[] {
  const flags: RedFlag[] = []
  for (const trigger of REDFLAG_TRIGGERS) {
    const evidence = trigger.matcher(transcript)
    if (evidence === null) continue
    flags.push({
      id: trigger.id,
      label: trigger.label,
      severity: trigger.severity,
      evidence,
      source: 'rule',
      ruleId: trigger.id,
    })
  }
  return flags
}

/**
 * The zero-suppression invariant (docs/trd.md §10): a union, never a filter.
 * `modelCandidates` runs after and is never shown `ruleFlags`, so nothing
 * here — or upstream of here — can drop, downgrade, or reorder a rule hit.
 */
export function mergeRedFlags(ruleFlags: RedFlag[], modelCandidates: RedFlag[]): RedFlag[] {
  return ruleFlags.concat(modelCandidates)
}
