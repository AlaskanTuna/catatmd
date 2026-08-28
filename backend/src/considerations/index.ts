import type { Citation, ClinicalAssertion, ClinicalFacts } from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'

/**
 * Deterministic clinical considerations over validated `ClinicalFacts`.
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

type ConsiderationRule = {
  readonly ruleId: string
  readonly text: string
  readonly guidelineId: string
  readonly matches: (facts: ClinicalFacts) => boolean
}

/**
 * Only rules whose trigger and advice are both grounded in an existing
 * `GUIDELINE_CORPUS` chunk summary are listed here. Scoring calculators
 * (Centor / McIsaac), incomplete viral-pattern inferences, and antibiotic
 * thresholds that conflict across sources are deliberately absent.
 */
const CONSIDERATION_RULES: readonly ConsiderationRule[] = [
  {
    // abdullah-2024-safety-netting: every adult sore-throat consultation,
    // regardless of antibiotic decision, should include explicit safety-netting.
    // Operational mapping: symptoms.soreThroat PRESENT documents that this is
    // a sore-throat presentation. NOT_ASSESSED / UNKNOWN / DENIED do not.
    ruleId: 'cpg-sore-throat-safety-netting',
    text:
      'Every adult sore-throat consultation should include explicit safety-netting ' +
      'advice on when to seek review — worsening swallowing difficulty, drooling, ' +
      'trismus, unilateral peritonsillar swelling, or symptoms persisting beyond ' +
      'the expected course.',
    guidelineId: 'abdullah-2024-safety-netting',
    matches: (facts) => isDocumentedPresent(facts.symptoms.soreThroat),
  },
]

function isDocumentedPresent(assertion: ClinicalAssertion): boolean {
  return assertion.state === 'PRESENT'
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
 */
export function deriveConsiderations(facts: unknown): ClinicalConsideration[] {
  const parsed = ClinicalFactsSchema.safeParse(facts)
  if (!parsed.success) return []

  const considerations: ClinicalConsideration[] = []
  for (const rule of CONSIDERATION_RULES) {
    if (!rule.matches(parsed.data)) continue
    considerations.push({
      id: rule.ruleId,
      ruleId: rule.ruleId,
      text: rule.text,
      source: 'rule',
      citations: [{ guidelineId: rule.guidelineId }],
    })
  }
  return considerations
}
