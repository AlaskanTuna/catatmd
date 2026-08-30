import type { Citation, ClinicalAssertion, ClinicalFacts, ClinicalScoreResult } from '@shared/types'
import { ClinicalFactsSchema, ClinicalScoreResultSchema } from '@shared/types'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'
import { MODIFIED_CENTOR_ANTIBIOTIC_CONSIDERATION_CATEGORY_ID } from '../scoring/definitions.js'

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
  readonly kind: 'differential' | 'management'
  readonly text: string
  readonly source: 'rule'
  readonly citations: readonly Citation[]
}

type ConsiderationRule = {
  readonly ruleId: string
  readonly kind: ClinicalConsideration['kind']
  readonly text: string
  readonly citations: (scores: readonly ClinicalScoreResult[]) => readonly Citation[]
  readonly matches: (facts: ClinicalFacts, scores: readonly ClinicalScoreResult[]) => boolean
}

const citation = (guidelineId: string) => () => [{ guidelineId }]

export const CONSIDERATION_RULES_VERSION: ClinicalArtefactVersion = {
  id: 'consideration-rules-v1',
  effectiveDate: '2026-08-29',
}

/**
 * Only rules whose trigger and advice are both grounded in an existing
 * `GUIDELINE_CORPUS` chunk summary are listed here. Scoring calculators
 * remain upstream inputs; this module consumes their already-derived snapshots
 * rather than recalculating criteria. Incomplete viral-pattern inferences are
 * deliberately absent.
 */
export const CONSIDERATION_RULES: readonly ConsiderationRule[] = [
  {
    ruleId: 'cpg-differential-acute-pharyngitis',
    kind: 'differential',
    // Trigger mapping: the C1 chunk is explicitly about acute pharyngitis/
    // tonsillitis, so only a documented sore-throat presentation enters.
    text:
      'Differential consideration: Consider acute pharyngitis/tonsillitis as part of the ' +
      'differential for a documented sore-throat presentation. This is a doctor-review ' +
      'consideration, not an autonomous diagnosis.',
    citations: citation('moh-nag-2024-c1-acute-pharyngitis'),
    matches: (facts) => isDocumentedPresent(facts.symptoms.soreThroat),
  },
  {
    ruleId: 'cpg-management-sore-throat-symptomatic-relief',
    kind: 'management',
    // Trigger mapping: C1 names symptomatic relief for the majority of acute
    // pharyngitis/tonsillitis presentations; no cough-only inference is used.
    text:
      'Management consideration: Consider symptomatic relief as the first-line management ' +
      'framing for a documented sore-throat presentation while the treating doctor reviews ' +
      'whether any antibiotic indication is present.',
    citations: citation('moh-nag-2024-c1-acute-pharyngitis'),
    matches: (facts) => isDocumentedPresent(facts.symptoms.soreThroat),
  },
  {
    ruleId: 'cpg-sore-throat-safety-netting',
    kind: 'management',
    // Trigger mapping: the safety-netting chunk applies to every adult
    // sore-throat consultation regardless of the antibiotic decision.
    text:
      'Management consideration: Consider documenting safety-netting advice for a ' +
      'sore-throat consultation, including when to seek review for worsening swallowing ' +
      'difficulty, drooling, trismus, unilateral peritonsillar swelling, or symptoms ' +
      'persisting beyond the expected course.',
    citations: citation('abdullah-2024-safety-netting'),
    matches: (facts) => isDocumentedPresent(facts.symptoms.soreThroat),
  },
  {
    ruleId: 'cpg-score-antibiotic-consideration',
    kind: 'management',
    // Trigger mapping: consumes only the imported MOH threshold category from
    // an already-complete score snapshot, and only inside a documented
    // sore-throat presentation. The other Malaysian score's distinct threshold
    // category is not folded into this MOH NAG consideration.
    text:
      'Management consideration: The existing guideline score is at an antibiotic-consideration ' +
      'threshold; use this as a clinician-review prompt against the cited guideline, not as an ' +
      'automatic antibiotic decision.',
    citations: (scores) =>
      scoreCitationsForCategory(scores, MODIFIED_CENTOR_ANTIBIOTIC_CONSIDERATION_CATEGORY_ID),
    matches: (facts, scores) =>
      isDocumentedPresent(facts.symptoms.soreThroat) &&
      scoreCitationsForCategory(scores, MODIFIED_CENTOR_ANTIBIOTIC_CONSIDERATION_CATEGORY_ID)
        .length > 0,
  },
]

function isDocumentedPresent(assertion: ClinicalAssertion): boolean {
  return assertion.state === 'PRESENT'
}

function parseScores(scores: unknown): ClinicalScoreResult[] {
  const parsed = ClinicalScoreResultSchema.array().safeParse(scores)
  return parsed.success ? parsed.data : []
}

function scoreCitationsForCategory(
  scores: readonly ClinicalScoreResult[],
  category: string,
): Citation[] {
  const score = scores.find(
    (item) => item.completeness === 'complete' && item.category === category,
  )
  return score === undefined ? [] : [...score.citations]
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
export function deriveConsiderations(
  facts: unknown,
  clinicalScores: unknown = [],
): ClinicalConsideration[] {
  const parsed = ClinicalFactsSchema.safeParse(facts)
  if (!parsed.success) return []
  const scores = parseScores(clinicalScores)

  const considerations: ClinicalConsideration[] = []
  for (const rule of CONSIDERATION_RULES) {
    if (!rule.matches(parsed.data, scores)) continue
    const citations = rule.citations(scores)
    if (citations.length === 0) continue
    considerations.push({
      id: rule.ruleId,
      ruleId: rule.ruleId,
      kind: rule.kind,
      text: rule.text,
      source: 'rule',
      citations,
    })
  }
  return considerations
}
