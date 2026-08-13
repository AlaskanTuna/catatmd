import type { Transcript } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'

/**
 * TRD §10 (Trigger Record Shape). One entry per deterministic escalation
 * trigger; the versioned list of these is the engine's only input besides the
 * transcript itself.
 */
export interface RedFlagTrigger {
  /** Stable id; becomes RedFlag.ruleId. */
  id: string
  /** Becomes RedFlag.label. Never phrased as a diagnosis (AGENTS.md). */
  label: string
  severity: 'emergency' | 'urgent' | 'advisory'
  /** Returns the matched verbatim transcript span, or null if it did not fire. */
  matcher: (transcript: Transcript) => string | null
  /** Citation for where this trigger comes from (docs/trd.md §10, Q7). */
  clinicalSource: string
  /** Version of the trigger list this entry belongs to. */
  listVersion: string
  /** Profiles that include this trigger. */
  profiles: readonly ProfileId[]
}
