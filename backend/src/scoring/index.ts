import type {
  Citation,
  ClinicalAssertion,
  ClinicalFacts,
  ClinicalScoreCriterion,
  ClinicalScoreResult,
} from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'
import {
  type AgeCriterionDef,
  SCORING_SYSTEMS,
  type ScoreCriterionDef,
  type ScoringSystemDef,
} from './definitions.js'

export { SCORING_DEFINITIONS_VERSION, SCORING_SYSTEMS } from './definitions.js'

export type { ClinicalScoreCriterion, ClinicalScoreResult }

export type ScoringContext = {
  /**
   * Optional chronological age in whole years (e.g. from the patient record).
   * Required to complete the Abdullah age adjustment; absent/invalid age leaves
   * that criterion not_assessed. Never inferred from the transcript.
   */
  readonly ageYears?: number | null
}

function readAssertion(
  facts: ClinicalFacts,
  path: ScoreCriterionDef['factPath'],
): ClinicalAssertion {
  switch (path) {
    case 'symptoms.fever':
      return facts.symptoms.fever
    case 'symptoms.cough':
      return facts.symptoms.cough
    case 'examination.tonsillar':
      return facts.examination.tonsillar
    case 'examination.cervicalLymphNodes':
      return facts.examination.cervicalLymphNodes
  }
}

function evaluateFactCriterion(
  def: ScoreCriterionDef,
  facts: ClinicalFacts,
): ClinicalScoreCriterion {
  const assertion = readAssertion(facts, def.factPath)
  const state = assertion.state

  if (state === 'NOT_ASSESSED' || state === 'UNKNOWN' || state === 'NOT_APPLICABLE') {
    return {
      id: def.id,
      label: def.label,
      status: 'not_assessed',
      points: null,
      factPath: def.factPath,
    }
  }

  const documentedPositive = state === 'PRESENT' || state === 'CLINICIAN_OBSERVED'
  const documentedDenied = state === 'DENIED'

  if (def.polarity === 'present_scores') {
    if (documentedPositive) {
      return {
        id: def.id,
        label: def.label,
        status: 'met',
        points: def.pointsIfMet,
        factPath: def.factPath,
      }
    }
    if (documentedDenied) {
      return {
        id: def.id,
        label: def.label,
        status: 'not_met',
        points: 0,
        factPath: def.factPath,
      }
    }
  } else {
    // denied_scores: absence of cough
    if (documentedDenied) {
      return {
        id: def.id,
        label: def.label,
        status: 'met',
        points: def.pointsIfMet,
        factPath: def.factPath,
      }
    }
    if (documentedPositive) {
      return {
        id: def.id,
        label: def.label,
        status: 'not_met',
        points: 0,
        factPath: def.factPath,
      }
    }
  }

  // Any other state is treated as not assessed rather than scored.
  return {
    id: def.id,
    label: def.label,
    status: 'not_assessed',
    points: null,
    factPath: def.factPath,
  }
}

function evaluateAgeCriterion(
  def: AgeCriterionDef,
  ageYears: number | null | undefined,
): ClinicalScoreCriterion {
  if (ageYears === null || ageYears === undefined || !Number.isFinite(ageYears) || ageYears < 0) {
    return {
      id: def.id,
      label: def.label,
      status: 'not_assessed',
      points: null,
    }
  }

  if (ageYears >= def.penaltyAgeYears) {
    return {
      id: def.id,
      label: def.label,
      status: 'met',
      points: def.pointsIfPenalty,
    }
  }

  return {
    id: def.id,
    label: def.label,
    status: 'not_met',
    points: 0,
  }
}

function citationsFor(system: ScoringSystemDef): Citation[] {
  return [system.guidelineId, ...system.extraGuidelineIds].map((guidelineId) => ({ guidelineId }))
}

function scoreSystem(
  system: ScoringSystemDef,
  facts: ClinicalFacts,
  context: ScoringContext,
): ClinicalScoreResult {
  const criteria: ClinicalScoreCriterion[] = system.criteria.map((def) =>
    evaluateFactCriterion(def, facts),
  )

  if (system.ageCriterion) {
    criteria.push(evaluateAgeCriterion(system.ageCriterion, context.ageYears))
  }

  const incomplete = criteria.some((c) => c.status === 'not_assessed')
  const maxScore = system.criteria.reduce((sum, c) => sum + c.pointsIfMet, 0)

  if (incomplete) {
    return {
      id: `score-${system.guidelineId}`,
      systemId: system.id,
      title: system.title,
      guidelineId: system.guidelineId,
      completeness: 'incomplete',
      totalScore: null,
      maxScore,
      category: null,
      categoryLabel: null,
      criteria,
      citations: citationsFor(system),
    }
  }

  const totalScore = criteria.reduce((sum, c) => sum + (c.points ?? 0), 0)
  const band = system.categories.find((category) => category.matches(totalScore))

  return {
    id: `score-${system.guidelineId}`,
    systemId: system.id,
    title: system.title,
    guidelineId: system.guidelineId,
    completeness: 'complete',
    totalScore,
    maxScore,
    category: band?.id ?? null,
    categoryLabel: band?.label ?? null,
    criteria,
    citations: citationsFor(system),
  }
}

/**
 * Pure guideline-based scoring over validated `ClinicalFacts`.
 *
 * No I/O, no LLM, no transcript re-parse, no mutation of inputs. Invalid input
 * yields no scores rather than unsafe clinical inference. Systems whose criteria
 * are not fully documented return `completeness: 'incomplete'` with per-criterion
 * status — NOT_ASSESSED / UNKNOWN never become negative findings.
 *
 * Age for the Abdullah age adjustment is optional context from the patient
 * record, never inferred from free text.
 */
export function deriveScores(facts: unknown, context: ScoringContext = {}): ClinicalScoreResult[] {
  const parsed = ClinicalFactsSchema.safeParse(facts)
  if (!parsed.success) return []

  return SCORING_SYSTEMS.map((system) => scoreSystem(system, parsed.data, context))
}
