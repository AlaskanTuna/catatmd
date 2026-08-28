import type { Citation } from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'

/**
 * Task #4-A architectural foundation only. No clinical firing rule has
 * received human sign-off yet (see the #4-A provenance audit), so this
 * module deliberately returns no considerations. It exists so the
 * deterministic-considerations layer has a stable shape and a place to grow
 * into once a rule is approved and grounded in an existing
 * `GUIDELINE_CORPUS` entry (`backend/src/guidelines/corpus.ts`).
 *
 * Shaped after `RedFlag` (`shared/src/index.ts`): `source: 'rule'` marks a
 * deterministic hit the way it already does for red flags, so a future
 * model-additive consideration can never impersonate one. `citations` reuses
 * the existing `Citation` type rather than declaring a parallel one.
 */
export interface ClinicalConsideration {
  readonly id: string
  readonly ruleId: string
  readonly text: string
  readonly source: 'rule'
  readonly citations: readonly Citation[]
}

/**
 * Pure function over structured, evidence-checked `ClinicalFacts` (docs/trd.md
 * section 21.4 has already run by the time facts reach here) - no I/O, no LLM
 * call, no database, no clock, no randomness, and no re-parsing of the raw
 * transcript. Mirrors the posture of `evaluateRedFlags` and `deriveGaps`.
 *
 * Takes `unknown` rather than `ClinicalFacts` because nothing upstream of
 * this module is trusted to hand it a validated shape; invalid, partial, or
 * non-object input is treated as "nothing to consider" rather than thrown.
 *
 * Returns an empty array unconditionally today: zero clinical firing rules
 * are approved for Task #4-A. The sore-throat safety-netting advice had
 * corpus support, but its structured trigger had not received human
 * approval; the viral-pattern rule was an incomplete/inferred criterion and
 * must not be implemented. Neither is implemented here.
 */
export function deriveConsiderations(facts: unknown): ClinicalConsideration[] {
  const parsed = ClinicalFactsSchema.safeParse(facts)
  if (!parsed.success) return []

  return []
}
