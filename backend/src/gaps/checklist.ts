import type { ClinicalAssertion, ClinicalFacts, OperationalBlock } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

/**
 * Bumped whenever an entry is added, removed, or its selector, priority or
 * wording changes. Recorded with every analysis (docs/trd.md §15) so a past
 * set of gaps can be traced back to the checklist that produced it.
 */
export const GAP_CHECKLIST_VERSION: ClinicalArtefactVersion = {
  id: 'gap-checklist-v2',
  effectiveDate: '2026-08-14',
}

const URTI_PROFILES: readonly ProfileId[] = ['adult-acute-urti']
const UTI_PROFILES: readonly ProfileId[] = ['adult-acute-uncomplicated-uti']

/**
 * Materiality rule (GitHub issue #6; docs/prd.md §12 alert fatigue).
 *
 * `ClinicalFactsSchema` is a fixed 29-key set (12 symptoms, 8 history, 5
 * observations, 4 examination) plus 5 operational-block fields. Not every
 * `NOT_ASSESSED` key becomes a gap prompt — this list is the deliberate
 * subset, chosen against two criteria:
 *
 * 1. Safety-differentiating or payer-mandated fields for an adult acute
 *    cough / sore-throat / URTI presentation are included.
 * 2. Fields that only restate an already-checklisted field, or that a patient
 *    being in the room already establishes, are excluded — including them
 *    would double-count the same absence as two prompts:
 *    - `symptoms.cough`, `symptoms.soreThroat` — the presenting complaint;
 *      if neither was raised there is no consultation to speak of.
 *    - `symptoms.sputumCharacteristics` — a descriptive refinement of
 *      `sputumProduction`, already covered by that entry.
 *    - `symptoms.onsetAndProgression` — a descriptive refinement of
 *      `coughDuration`, already covered by that entry.
 *    - `history.recentInfectionExposure` — epidemiological context, not a
 *      field either Malaysian source in the guideline corpus treats as
 *      standard-of-care for triage.
 *    - `operational.medicationsDispensed` — an outcome of the encounter, not
 *      history to elicit; an empty array is a common, valid outcome
 *      (advice-only visits), so flagging it would be a false positive rather
 *      than a completeness gap.
 *
 * `priority` is a volume/ordering signal only (docs/prd.md §10) — it never
 * gates whether an entry is included here, and it carries no safety meaning
 * on its own.
 */
export interface GapChecklistEntry {
  id: string
  priority: 'high' | 'medium' | 'low'
  /** What the record does not contain. Never phrased as a prompt to ask. */
  question: string
  /** Why this field is tracked for this presentation. Never a clinical instruction. */
  rationale: string
  select: (facts: ClinicalFacts, operational: OperationalBlock) => ClinicalAssertion
  profiles: readonly ProfileId[]
}

export const GAP_CHECKLIST: readonly GapChecklistEntry[] = [
  // ─── Symptoms ───────────────────────────────────────────────────────────
  {
    id: 'cough-duration',
    priority: 'medium',
    question: 'The record does not state how long the cough has been present.',
    rationale:
      'Cough duration is a standard field tracked for adult cough and URTI presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.symptoms.coughDuration,
    profiles: URTI_PROFILES,
  },
  {
    id: 'sputum-production',
    priority: 'medium',
    question: 'The record does not indicate whether the cough is productive of sputum.',
    rationale:
      'Sputum production is a standard field tracked for adult cough and URTI presentations ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.symptoms.sputumProduction,
    profiles: URTI_PROFILES,
  },
  {
    id: 'haemoptysis',
    priority: 'high',
    question: 'The record does not indicate whether haemoptysis was assessed.',
    rationale:
      'Haemoptysis status is a standard field tracked for adult cough presentations and is ' +
      'not documented in this consultation.',
    select: (facts) => facts.symptoms.haemoptysis,
    profiles: URTI_PROFILES,
  },
  {
    id: 'fever',
    priority: 'medium',
    question: 'The record does not indicate whether fever was assessed.',
    rationale:
      'Fever status is a standard field tracked for adult URTI presentations and is not ' +
      'documented in this consultation.',
    select: (facts) => facts.symptoms.fever,
    profiles: URTI_PROFILES,
  },
  {
    id: 'dyspnoea',
    priority: 'high',
    question: 'The record does not indicate whether breathlessness (dyspnoea) was assessed.',
    rationale:
      'Breathlessness status is a standard field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.symptoms.dyspnoea,
    profiles: URTI_PROFILES,
  },
  {
    id: 'chest-pain',
    priority: 'high',
    question: 'The record does not indicate whether chest pain was assessed.',
    rationale:
      'Chest pain status is a standard field tracked for adult cough and URTI presentations ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.symptoms.chestPain,
    profiles: URTI_PROFILES,
  },
  {
    id: 'swallowing-difficulty',
    priority: 'high',
    question: 'The record does not indicate whether difficulty swallowing was assessed.',
    rationale:
      'Swallowing difficulty is a standard field tracked for adult sore-throat presentations ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.symptoms.swallowingDifficulty,
    profiles: URTI_PROFILES,
  },
  {
    id: 'oral-intake',
    priority: 'high',
    question: 'The record does not indicate whether oral intake was assessed.',
    rationale:
      'Oral intake status is a standard field tracked for adult sore-throat presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.symptoms.oralIntake,
    profiles: URTI_PROFILES,
  },

  // ─── History ────────────────────────────────────────────────────────────
  {
    id: 'asthma',
    priority: 'medium',
    question: 'The record does not indicate whether a history of asthma was assessed.',
    rationale:
      'Asthma history is a standard field tracked for adult cough and URTI presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.history.asthma,
    profiles: URTI_PROFILES,
  },
  {
    id: 'copd',
    priority: 'medium',
    question: 'The record does not indicate whether a history of COPD was assessed.',
    rationale:
      'COPD history is a standard field tracked for adult cough and URTI presentations and is ' +
      'not documented in this consultation.',
    select: (facts) => facts.history.copd,
    profiles: URTI_PROFILES,
  },
  {
    id: 'cardiac-disease',
    priority: 'low',
    question: 'The record does not indicate whether a history of cardiac disease was assessed.',
    rationale:
      'Cardiac disease history is a standard field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.history.cardiacDisease,
    profiles: URTI_PROFILES,
  },
  {
    id: 'immunosuppression',
    priority: 'low',
    question: 'The record does not indicate whether immunosuppression was assessed.',
    rationale:
      'Immunosuppression status is a standard field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.history.immunosuppression,
    profiles: URTI_PROFILES,
  },
  {
    id: 'smoking',
    priority: 'low',
    question: 'The record does not indicate whether smoking status was assessed.',
    rationale:
      'Smoking status is a standard field tracked for adult cough and URTI presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.history.smoking,
    profiles: URTI_PROFILES,
  },
  {
    id: 'current-medications',
    priority: 'medium',
    question: 'The record does not indicate whether current medications were reviewed.',
    rationale:
      'Current medications are a standard field tracked for adult cough and URTI ' +
      'presentations and are not documented in this consultation.',
    select: (facts) => facts.history.currentMedications,
    profiles: URTI_PROFILES,
  },
  {
    id: 'drug-allergies',
    priority: 'medium',
    question: 'The record does not indicate whether drug allergies were reviewed.',
    rationale:
      'Drug allergy status is a standard field tracked whenever medication may be dispensed, ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.history.drugAllergies,
    profiles: URTI_PROFILES,
  },

  // ─── Observations ───────────────────────────────────────────────────────
  {
    id: 'temperature',
    priority: 'medium',
    question: 'The record does not contain a temperature reading.',
    rationale:
      'Temperature is a standard vital-sign field tracked for adult URTI presentations and is ' +
      'not documented in this consultation.',
    select: (facts) => facts.observations.temperature,
    profiles: URTI_PROFILES,
  },
  {
    id: 'heart-rate',
    priority: 'medium',
    question: 'The record does not contain a heart-rate reading.',
    rationale:
      'Heart rate is a standard vital-sign field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.observations.heartRate,
    profiles: URTI_PROFILES,
  },
  {
    id: 'respiratory-rate',
    priority: 'high',
    question: 'The record does not contain a respiratory-rate reading.',
    rationale:
      'Respiratory rate is a standard vital-sign field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.observations.respiratoryRate,
    profiles: URTI_PROFILES,
  },
  {
    id: 'blood-pressure',
    priority: 'medium',
    question: 'The record does not contain a blood-pressure reading.',
    rationale:
      'Blood pressure is a standard vital-sign field tracked for adult URTI presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.observations.bloodPressure,
    profiles: URTI_PROFILES,
  },
  {
    id: 'oxygen-saturation',
    priority: 'high',
    question: 'The record does not contain an oxygen-saturation reading.',
    rationale:
      'Oxygen saturation is a standard vital-sign field tracked for adult cough and URTI ' +
      'presentations and is not documented in this consultation.',
    select: (facts) => facts.observations.oxygenSaturation,
    profiles: URTI_PROFILES,
  },

  // ─── Examination ────────────────────────────────────────────────────────
  {
    id: 'throat-examination',
    priority: 'medium',
    question: 'The record does not contain throat examination findings.',
    rationale:
      'Throat examination findings are a standard field tracked for adult sore-throat ' +
      'presentations and are not documented in this consultation.',
    select: (facts) => facts.examination.throat,
    profiles: URTI_PROFILES,
  },
  {
    id: 'tonsillar-examination',
    priority: 'medium',
    question: 'The record does not contain tonsillar examination findings.',
    rationale:
      'Tonsillar examination findings are a standard field tracked for adult sore-throat ' +
      'presentations and are not documented in this consultation.',
    select: (facts) => facts.examination.tonsillar,
    profiles: URTI_PROFILES,
  },
  {
    id: 'cervical-lymph-nodes',
    priority: 'medium',
    question: 'The record does not contain cervical lymph node examination findings.',
    rationale:
      'Cervical lymph node findings are a standard field tracked for adult sore-throat ' +
      'presentations and are not documented in this consultation.',
    select: (facts) => facts.examination.cervicalLymphNodes,
    profiles: URTI_PROFILES,
  },
  {
    id: 'chest-examination',
    priority: 'medium',
    question: 'The record does not contain chest examination findings.',
    rationale:
      'Chest examination findings are a standard field tracked for adult cough presentations ' +
      'and are not documented in this consultation.',
    select: (facts) => facts.examination.chest,
    profiles: URTI_PROFILES,
  },

  // ─── Malaysian operational block ───────────────────────────────────────
  {
    id: 'diagnosis',
    priority: 'low',
    question: 'The record does not contain a diagnosis stated by the doctor.',
    rationale:
      'Diagnosis is one of the fields in the Malaysian payer-enforced consultation record ' +
      '(condition, treatment, medication dispensed, MC days, referral) and is not documented ' +
      'in this consultation.',
    select: (_facts, operational) => operational.diagnosis,
    profiles: URTI_PROFILES,
  },
  {
    id: 'mc-days',
    priority: 'low',
    question: 'The record does not contain medical-certificate days.',
    rationale:
      'MC days are one of the fields in the Malaysian payer-enforced consultation record and ' +
      'are not documented in this consultation.',
    select: (_facts, operational) => operational.mcDays,
    profiles: URTI_PROFILES,
  },
  {
    id: 'referral',
    priority: 'low',
    question: 'The record does not contain a referral.',
    rationale:
      'Referral is one of the fields in the Malaysian payer-enforced consultation record and ' +
      'is not documented in this consultation.',
    select: (_facts, operational) => operational.referral,
    profiles: URTI_PROFILES,
  },
  {
    id: 'follow-up',
    priority: 'low',
    question: 'The record does not contain a follow-up interval.',
    rationale:
      'Follow-up interval is one of the fields in the Malaysian payer-enforced consultation ' +
      'record and is not documented in this consultation.',
    select: (_facts, operational) => operational.followUp,
    profiles: URTI_PROFILES,
  },
]

export const UTI_GAP_CHECKLIST: readonly GapChecklistEntry[] = [
  {
    id: 'uti-temperature',
    priority: 'high',
    question: 'The record does not contain a temperature reading.',
    rationale:
      'Temperature is a safety-relevant observation for adult acute urinary presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.observations.temperature,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-heart-rate',
    priority: 'high',
    question: 'The record does not contain a heart-rate reading.',
    rationale:
      'Heart rate is a safety-relevant observation for adult acute urinary presentations and ' +
      'is not documented in this consultation.',
    select: (facts) => facts.observations.heartRate,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-respiratory-rate',
    priority: 'high',
    question: 'The record does not contain a respiratory-rate reading.',
    rationale:
      'Respiratory rate is a safety-relevant observation for adult acute urinary presentations ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.observations.respiratoryRate,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-blood-pressure',
    priority: 'high',
    question: 'The record does not contain a blood-pressure reading.',
    rationale:
      'Blood pressure is a safety-relevant observation for adult acute urinary presentations ' +
      'and is not documented in this consultation.',
    select: (facts) => facts.observations.bloodPressure,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-drug-allergies',
    priority: 'medium',
    question: 'The record does not indicate whether drug allergies were reviewed.',
    rationale:
      'Drug allergy status is relevant whenever medication may be dispensed and is not ' +
      'documented in this consultation.',
    select: (facts) => facts.history.drugAllergies,
    profiles: UTI_PROFILES,
  },
]

export const ALL_GAP_CHECKLIST: readonly GapChecklistEntry[] = [
  ...GAP_CHECKLIST,
  ...UTI_GAP_CHECKLIST,
]
