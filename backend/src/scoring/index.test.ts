import type { ClinicalAssertion, ClinicalFacts } from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { corpusIds } from '../guidelines/index.js'
import { deriveScores } from './index.js'

const present = (evidence: string, value?: string): ClinicalAssertion => ({
  state: 'PRESENT',
  evidence,
  ...(value === undefined ? {} : { value }),
})
const denied = (evidence: string): ClinicalAssertion => ({
  state: 'DENIED',
  evidence,
})
const notAssessed = (): ClinicalAssertion => ({ state: 'NOT_ASSESSED' })
const unknown = (): ClinicalAssertion => ({ state: 'UNKNOWN' })
const clinicianObserved = (evidence: string): ClinicalAssertion => ({
  state: 'CLINICIAN_OBSERVED',
  evidence,
})

const emptyFacts = (): ClinicalFacts =>
  ClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

const MODIFIED_CENTOR_ID = 'moh-nag-2024-a10-modified-centor'
const MCISAAC_CRITERIA_ID = 'abdullah-2024-mcisaac-criteria'
const MCISAAC_THRESHOLD_ID = 'abdullah-2024-mcisaac-threshold'
const VIRAL_VS_BACTERIAL_ID = 'moh-nag-2024-c1-viral-vs-bacterial'

/** All four adult Modified Centor criteria documented so a total can be computed. */
function completeModifiedCentorFacts(score: 0 | 1 | 2 | 3 | 4): ClinicalFacts {
  const facts = emptyFacts()
  // Criterion points: exudate, adenopathy, fever, absence of cough
  const exudate = score >= 1
  const adenopathy = score >= 2
  const fever = score >= 3
  const noCough = score >= 4

  facts.examination.tonsillar = exudate
    ? present('white patches on tonsils', 'tonsillar exudate')
    : denied('no tonsillar exudate')
  facts.examination.cervicalLymphNodes = adenopathy
    ? present('tender anterior cervical nodes')
    : denied('nodes not tender')
  facts.symptoms.fever = fever ? present('fever last night') : denied('no fever')
  facts.symptoms.cough = noCough ? denied('no cough') : present('dry cough')
  return facts
}

describe('deriveScores - purity and invalid input', () => {
  it('is a pure function: identical input produces identical output', () => {
    const facts = completeModifiedCentorFacts(3)
    expect(deriveScores(facts)).toEqual(deriveScores(facts))
  })

  it('does not mutate ClinicalFacts', () => {
    const facts = completeModifiedCentorFacts(2)
    const copy = structuredClone(facts)
    deriveScores(facts)
    expect(facts).toEqual(copy)
  })

  it('returns an empty array for invalid or partial input (no unsafe inference)', () => {
    expect(deriveScores(null)).toEqual([])
    expect(deriveScores(undefined)).toEqual([])
    expect(deriveScores('not facts')).toEqual([])
    expect(deriveScores({})).toEqual([])
    expect(deriveScores({ symptoms: { cough: { state: 'PRESENT' } } })).toEqual([])
  })
})

describe('deriveScores - Modified Centor (MOH NAG A10)', () => {
  it('computes a complete deterministic score and category when all criteria are documented', () => {
    const result = deriveScores(completeModifiedCentorFacts(3)).find(
      (item) => item.guidelineId === MODIFIED_CENTOR_ID,
    )

    expect(result).toBeDefined()
    expect(result?.completeness).toBe('complete')
    expect(result?.totalScore).toBe(3)
    expect(result?.category).toBe('at_or_above_antibiotic_consideration_threshold')
    expect(result?.citations.map((c) => c.guidelineId)).toEqual([MODIFIED_CENTOR_ID])
    expect(result?.categoryLabel).toMatch(/clinician/i)
    expect(result?.categoryLabel).not.toMatch(/diagnos|prescrib/i)
  })

  it('places score 2 below the MOH antibiotic-consideration threshold', () => {
    const result = deriveScores(completeModifiedCentorFacts(2)).find(
      (item) => item.guidelineId === MODIFIED_CENTOR_ID,
    )

    expect(result?.completeness).toBe('complete')
    expect(result?.totalScore).toBe(2)
    expect(result?.category).toBe('below_antibiotic_consideration_threshold')
  })

  it('awards a point when fever is PRESENT', () => {
    const facts = completeModifiedCentorFacts(0)
    facts.symptoms.fever = present('fever yesterday')
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const fever = result?.criteria.find((c) => c.id === 'fever-by-history')

    expect(fever?.status).toBe('met')
    expect(fever?.points).toBe(1)
  })

  it('treats fever DENIED as criterion not met (0 points), not as missing', () => {
    const facts = completeModifiedCentorFacts(0)
    facts.symptoms.fever = denied('no fever')
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const fever = result?.criteria.find((c) => c.id === 'fever-by-history')

    expect(fever?.status).toBe('not_met')
    expect(fever?.points).toBe(0)
  })

  it('does not treat fever NOT_ASSESSED as absence or as a negative finding', () => {
    const facts = completeModifiedCentorFacts(4)
    facts.symptoms.fever = notAssessed()
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const fever = result?.criteria.find((c) => c.id === 'fever-by-history')

    expect(fever?.status).toBe('not_assessed')
    expect(fever?.points).toBeNull()
    expect(result?.completeness).toBe('incomplete')
    expect(result?.totalScore).toBeNull()
    expect(result?.category).toBeNull()
  })

  it('does not treat fever UNKNOWN as absence or as a negative finding', () => {
    const facts = completeModifiedCentorFacts(4)
    facts.symptoms.fever = unknown()
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const fever = result?.criteria.find((c) => c.id === 'fever-by-history')

    expect(fever?.status).toBe('not_assessed')
    expect(fever?.points).toBeNull()
    expect(result?.completeness).toBe('incomplete')
    expect(result?.totalScore).toBeNull()
  })

  it('awards absence-of-cough only when cough is explicitly DENIED', () => {
    const facts = completeModifiedCentorFacts(0)
    facts.symptoms.cough = denied('I am not coughing')
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const absence = result?.criteria.find((c) => c.id === 'absence-of-cough')

    expect(absence?.status).toBe('met')
    expect(absence?.points).toBe(1)
  })

  it('does not award absence-of-cough when cough is NOT_ASSESSED', () => {
    const facts = completeModifiedCentorFacts(0)
    facts.symptoms.cough = notAssessed()
    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const absence = result?.criteria.find((c) => c.id === 'absence-of-cough')

    expect(absence?.status).toBe('not_assessed')
    expect(absence?.points).toBeNull()
  })

  it('accepts CLINICIAN_OBSERVED exam findings as documented positive criteria', () => {
    const facts = emptyFacts()
    facts.examination.tonsillar = clinicianObserved('exudate on tonsils')
    facts.examination.cervicalLymphNodes = clinicianObserved('tender anterior nodes')
    facts.symptoms.fever = present('fever')
    facts.symptoms.cough = denied('no cough')

    const result = deriveScores(facts).find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    expect(result?.completeness).toBe('complete')
    expect(result?.totalScore).toBe(4)
  })
})

describe('deriveScores - McIsaac (Abdullah 2024)', () => {
  it('is incomplete without age even when the four shared criteria are documented', () => {
    const result = deriveScores(completeModifiedCentorFacts(4)).find(
      (item) => item.guidelineId === MCISAAC_CRITERIA_ID,
    )

    expect(result).toBeDefined()
    expect(result?.completeness).toBe('incomplete')
    expect(result?.totalScore).toBeNull()
    expect(result?.category).toBeNull()
    const age = result?.criteria.find((c) => c.id === 'age-adjustment')
    expect(age?.status).toBe('not_assessed')
  })

  it('computes a complete McIsaac score when ageYears is provided', () => {
    // Four positive Centor criteria (4) + age 50 → -1 = 3 → band 2-3
    const result = deriveScores(completeModifiedCentorFacts(4), { ageYears: 50 }).find(
      (item) => item.guidelineId === MCISAAC_CRITERIA_ID,
    )

    expect(result?.completeness).toBe('complete')
    expect(result?.totalScore).toBe(3)
    expect(result?.category).toBe('clinical_judgement_or_poc_testing')
    const citationIds = result?.citations.map((c) => c.guidelineId) ?? []
    expect(citationIds).toContain(MCISAAC_CRITERIA_ID)
    expect(citationIds).toContain(MCISAAC_THRESHOLD_ID)
  })

  it('applies no age penalty below 45 and uses the ≥4 threshold band', () => {
    const result = deriveScores(completeModifiedCentorFacts(4), { ageYears: 30 }).find(
      (item) => item.guidelineId === MCISAAC_CRITERIA_ID,
    )

    expect(result?.totalScore).toBe(4)
    expect(result?.category).toBe('consider_antibiotics_threshold')
  })

  it('uses the below-2 band when the complete score is 0 or 1', () => {
    const result = deriveScores(completeModifiedCentorFacts(0), { ageYears: 50 }).find(
      (item) => item.guidelineId === MCISAAC_CRITERIA_ID,
    )
    // 0 criteria + age -1 = -1 → still below 2
    expect(result?.totalScore).toBe(-1)
    expect(result?.category).toBe('below_testing_threshold')
  })
})

describe('deriveScores - guideline citation safety', () => {
  it('emits only existing corpus guideline IDs', () => {
    const known = new Set(corpusIds)
    const results = deriveScores(completeModifiedCentorFacts(4), { ageYears: 40 })
    const ids = results.flatMap((item) => item.citations.map((c) => c.guidelineId))

    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => known.has(id))).toBe(true)
    expect(ids).not.toContain('invented-guideline-id')
    expect(ids).not.toContain('NICE-NG84')
  })

  it('does not invent a viral-vs-bacterial calculator from moh-nag-2024-c1-viral-vs-bacterial', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat only')
    facts.symptoms.cough = present('runny cough')
    facts.symptoms.fever = denied('no fever')

    const results = deriveScores(facts)
    const guidelineIds = results.flatMap((item) => item.citations.map((c) => c.guidelineId))
    expect(guidelineIds).not.toContain(VIRAL_VS_BACTERIAL_ID)
    expect(results.every((item) => item.guidelineId !== VIRAL_VS_BACTERIAL_ID)).toBe(true)
  })

  it('keeps MOH Modified Centor and Abdullah McIsaac thresholds as separate results', () => {
    const results = deriveScores(completeModifiedCentorFacts(3), { ageYears: 40 })
    const moh = results.find((item) => item.guidelineId === MODIFIED_CENTOR_ID)
    const mcisaac = results.find((item) => item.guidelineId === MCISAAC_CRITERIA_ID)

    expect(moh?.totalScore).toBe(3)
    expect(moh?.category).toBe('at_or_above_antibiotic_consideration_threshold')
    // McIsaac total 3 is the middle band, not the MOH ≥3 antibiotic-consideration band
    expect(mcisaac?.totalScore).toBe(3)
    expect(mcisaac?.category).toBe('clinical_judgement_or_poc_testing')
    expect(moh?.category).not.toBe(mcisaac?.category)
  })
})

describe('deriveScores - Task #4 considerations remain unchanged', () => {
  it('does not replace or suppress deriveConsiderations behaviour (scoring is a separate layer)', async () => {
    const { deriveConsiderations } = await import('../considerations/index.js')
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')

    const considerations = deriveConsiderations(facts)
    expect(considerations.map((c) => c.ruleId)).toContain('cpg-sore-throat-safety-netting')

    const scores = deriveScores(facts)
    expect(scores.every((s) => s.completeness === 'incomplete')).toBe(true)
  })
})
