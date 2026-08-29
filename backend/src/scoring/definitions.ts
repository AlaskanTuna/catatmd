import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

/**
 * Versioned scoring-system definitions for adult acute sore-throat calculators.
 *
 * Criteria and thresholds are restated only from approved GUIDELINE_CORPUS
 * chunk summaries (docs/trd.md §11). This file is the sole production place
 * outside `guidelines/corpus.ts` allowed to name those scoring systems
 * (`no-stray-clinical-constants.test.ts`).
 *
 * Bumped when a criterion, threshold band, or cited guideline id changes.
 */
export const SCORING_DEFINITIONS_VERSION: ClinicalArtefactVersion = {
  id: 'scoring-definitions-v1',
  effectiveDate: '2026-08-29',
}

export type CriterionPolarity = 'present_scores' | 'denied_scores'

export type ScoreCriterionDef = {
  readonly id: string
  /** Clinician-facing criterion label, aligned to the cited corpus summary. */
  readonly label: string
  readonly factPath:
    | 'symptoms.fever'
    | 'symptoms.cough'
    | 'examination.tonsillar'
    | 'examination.cervicalLymphNodes'
  /**
   * `present_scores`: PRESENT / CLINICIAN_OBSERVED → 1 point; DENIED → 0.
   * `denied_scores`: DENIED → 1 point; PRESENT / CLINICIAN_OBSERVED → 0
   * (absence-of-cough).
   * NOT_ASSESSED / UNKNOWN / NOT_APPLICABLE never score — they leave the
   * calculator incomplete.
   */
  readonly polarity: CriterionPolarity
  readonly pointsIfMet: 1
}

export type AgeCriterionDef = {
  readonly id: 'age-adjustment'
  readonly label: string
  /** From abdullah-2024-mcisaac-criteria: -1 for age 45 and above. */
  readonly penaltyAgeYears: 45
  readonly pointsIfPenalty: -1
}

export type CategoryBand = {
  readonly id: string
  readonly label: string
  readonly matches: (totalScore: number) => boolean
}

export type ScoringSystemDef = {
  readonly id: string
  /**
   * Primary corpus chunk that defines the criteria (and, for Modified Centor,
   * the single antibiotic-consideration threshold).
   */
  readonly guidelineId: string
  /** Additional citation ids (e.g. McIsaac threshold band chunk). */
  readonly extraGuidelineIds: readonly string[]
  readonly title: string
  readonly criteria: readonly ScoreCriterionDef[]
  readonly ageCriterion?: AgeCriterionDef
  readonly categories: readonly CategoryBand[]
}

const SHARED_FOUR: readonly ScoreCriterionDef[] = [
  {
    id: 'tonsillar-exudate',
    label: 'Tonsillar exudate',
    factPath: 'examination.tonsillar',
    polarity: 'present_scores',
    pointsIfMet: 1,
  },
  {
    id: 'tender-anterior-cervical-adenopathy',
    label: 'Tender anterior cervical adenopathy',
    factPath: 'examination.cervicalLymphNodes',
    polarity: 'present_scores',
    pointsIfMet: 1,
  },
  {
    id: 'fever-by-history',
    label: 'Fever by history',
    factPath: 'symptoms.fever',
    polarity: 'present_scores',
    pointsIfMet: 1,
  },
  {
    id: 'absence-of-cough',
    label: 'Absence of cough',
    factPath: 'symptoms.cough',
    polarity: 'denied_scores',
    pointsIfMet: 1,
  },
]

/**
 * MOH NAG 2024 Annex A10 — Modified Centor (four criteria; threshold ≥3).
 * Source chunk: moh-nag-2024-a10-modified-centor.
 */
const MODIFIED_CENTOR: ScoringSystemDef = {
  id: 'modified-centor',
  guidelineId: 'moh-nag-2024-a10-modified-centor',
  extraGuidelineIds: [],
  title: 'Modified Centor Score (MOH NAG 2024 Annex A10)',
  criteria: SHARED_FOUR,
  categories: [
    {
      id: 'at_or_above_antibiotic_consideration_threshold',
      label:
        'Score at or above the MOH NAG antibiotic-consideration threshold (≥3). ' +
        'For clinician review only — the treating doctor decides next steps.',
      matches: (total) => total >= 3,
    },
    {
      id: 'below_antibiotic_consideration_threshold',
      label:
        'Score below the MOH NAG antibiotic-consideration threshold (<3). ' +
        'For clinician review only — the treating doctor decides next steps.',
      matches: (total) => total < 3,
    },
  ],
}

/**
 * Abdullah et al. 2024 — McIsaac criteria plus separate threshold bands.
 * Criteria: abdullah-2024-mcisaac-criteria.
 * Bands: abdullah-2024-mcisaac-threshold (≥4 / 2–3 / <2).
 */
const MCISAAC: ScoringSystemDef = {
  id: 'mcisaac',
  guidelineId: 'abdullah-2024-mcisaac-criteria',
  extraGuidelineIds: ['abdullah-2024-mcisaac-threshold'],
  title: 'McIsaac Score (Abdullah et al. 2024 Delphi Consensus)',
  criteria: SHARED_FOUR,
  ageCriterion: {
    id: 'age-adjustment',
    label: 'Age adjustment (−1 if age ≥45)',
    penaltyAgeYears: 45,
    pointsIfPenalty: -1,
  },
  categories: [
    {
      id: 'consider_antibiotics_threshold',
      label:
        'McIsaac score ≥4 per Malaysian Delphi consensus — antibiotic-consideration ' +
        'band for clinician review only; the treating doctor decides next steps.',
      matches: (total) => total >= 4,
    },
    {
      id: 'clinical_judgement_or_poc_testing',
      label:
        'McIsaac score 2–3 per Malaysian Delphi consensus — clinical judgement or ' +
        'point-of-care testing band for clinician review.',
      matches: (total) => total >= 2 && total <= 3,
    },
    {
      id: 'below_testing_threshold',
      label:
        'McIsaac score below 2 per Malaysian Delphi consensus — antibiotics not ' +
        'indicated on score alone; clinician review still required.',
      matches: (total) => total < 2,
    },
  ],
}

export const SCORING_SYSTEMS: readonly ScoringSystemDef[] = [MODIFIED_CENTOR, MCISAAC]
