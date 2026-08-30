import type { ClinicalAssertion, ClinicalFacts, ClinicalScoreResult } from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { corpusIds } from '../guidelines/index.js'
import { deriveConsiderations } from './index.js'

const present = (evidence: string): ClinicalAssertion => ({
  state: 'PRESENT',
  evidence,
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

const SAFETY_NETTING_RULE_ID = 'cpg-sore-throat-safety-netting'
const SAFETY_NETTING_GUIDELINE_ID = 'abdullah-2024-safety-netting'
const SORE_THROAT_DIFFERENTIAL_RULE_ID = 'cpg-differential-acute-pharyngitis'
const SORE_THROAT_MANAGEMENT_RULE_ID = 'cpg-management-sore-throat-symptomatic-relief'
const BRONCHITIS_DIFFERENTIAL_RULE_ID = 'cpg-differential-acute-bronchitis'
const BRONCHITIS_MANAGEMENT_RULE_ID = 'cpg-management-acute-bronchitis-antibiotic-stewardship'
const URTI_MANAGEMENT_RULE_ID = 'cpg-management-uncomplicated-urti-symptomatic'
const SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID = 'cpg-score-antibiotic-consideration'
const MOH_PHARYNGITIS_ID = 'moh-nag-2024-c1-acute-pharyngitis'
const MOH_MODIFIED_CENTOR_ID = 'moh-nag-2024-a10-modified-centor'
const VIRAL_VS_BACTERIAL_ID = 'moh-nag-2024-c1-viral-vs-bacterial'

const scoreResult = (overrides: Partial<ClinicalScoreResult> = {}): ClinicalScoreResult => ({
  id: 'score-from-task-8',
  systemId: 'supplied-guideline-score',
  title: 'Supplied guideline score',
  guidelineId: MOH_MODIFIED_CENTOR_ID,
  completeness: 'complete',
  totalScore: 3,
  maxScore: 4,
  category: 'at_or_above_antibiotic_consideration_threshold',
  categoryLabel: 'At or above an antibiotic-consideration threshold.',
  criteria: [],
  citations: [{ guidelineId: MOH_MODIFIED_CENTOR_ID }],
  ...overrides,
})

describe('deriveConsiderations - purity', () => {
  it('is a pure function: identical input produces identical output', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')
    expect(deriveConsiderations(facts)).toEqual(deriveConsiderations(facts))
  })

  it('does not mutate its inputs', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat for two days')
    const copy = structuredClone(facts)
    deriveConsiderations(facts)
    expect(facts).toEqual(copy)
  })
})

describe('deriveConsiderations - cpg-sore-throat-safety-netting', () => {
  it('keeps the cited safety-netting consideration when soreThroat is PRESENT', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')

    const result = deriveConsiderations(facts)

    const safetyNetting = result.find((item) => item.ruleId === SAFETY_NETTING_RULE_ID)
    expect(safetyNetting).toMatchObject({
      id: SAFETY_NETTING_RULE_ID,
      ruleId: SAFETY_NETTING_RULE_ID,
      kind: 'management',
      source: 'rule',
      citations: [{ guidelineId: SAFETY_NETTING_GUIDELINE_ID }],
    })
    expect(safetyNetting?.text).toMatch(/consider/i)
    expect(safetyNetting?.text).toMatch(/safety-netting/i)
    expect(safetyNetting?.text).not.toMatch(/\bmust\b|\bprescribe\b/i)
    expect(safetyNetting?.citations.length).toBeGreaterThanOrEqual(1)
  })

  it('does not fire when soreThroat is explicitly DENIED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = denied('no sore throat')

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('does not treat NOT_ASSESSED as DENIED or as a positive trigger', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = notAssessed()

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('does not treat UNKNOWN as DENIED or as a positive trigger', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = unknown()

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('does not fire on CLINICIAN_OBSERVED alone (only PRESENT documents the presentation)', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = clinicianObserved('erythematous pharynx')

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('does not fire when nothing is documented', () => {
    expect(deriveConsiderations(emptyFacts())).toEqual([])
  })
})

describe('deriveConsiderations - negative evidence does not unlock positive pathways', () => {
  it('explicit fever DENIED does not trigger a viral-pattern or antibiotic-stewardship consideration', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')
    facts.symptoms.cough = present('cough')
    facts.symptoms.fever = denied('no fever today')

    const result = deriveConsiderations(facts)
    const ruleIds = result.map((item) => item.ruleId)
    const guidelineIds = result.flatMap((item) =>
      item.citations.map((citation) => citation.guidelineId),
    )

    expect(ruleIds).not.toContain('cpg-viral-pattern-sore-throat')
    expect(guidelineIds).not.toContain('moh-nag-2024-c1-viral-vs-bacterial')
    // Sore-throat considerations still fire from soreThroat PRESENT alone — that is expected.
    expect(ruleIds).toContain(SAFETY_NETTING_RULE_ID)
    expect(ruleIds).toContain(SORE_THROAT_DIFFERENTIAL_RULE_ID)
  })
})

describe('deriveConsiderations - differential considerations', () => {
  it('emits a guideline-cited differential consideration for documented sore throat', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')

    const result = deriveConsiderations(facts)
    const differential = result.find((item) => item.ruleId === SORE_THROAT_DIFFERENTIAL_RULE_ID)

    expect(differential).toMatchObject({
      kind: 'differential',
      citations: [{ guidelineId: MOH_PHARYNGITIS_ID }],
    })
    expect(differential?.text).toMatch(/^Differential consideration: Consider/i)
    expect(differential?.text).not.toMatch(/the patient has|diagnosed with|final diagnosis/i)
  })

  it('does not infer acute bronchitis from documented cough alone', () => {
    const facts = emptyFacts()
    facts.symptoms.cough = present('cough for three days')

    const result = deriveConsiderations(facts)
    const ruleIds = result.map((item) => item.ruleId)

    expect(ruleIds).not.toContain(BRONCHITIS_DIFFERENTIAL_RULE_ID)
    expect(ruleIds).not.toContain(BRONCHITIS_MANAGEMENT_RULE_ID)
    expect(ruleIds).not.toContain(URTI_MANAGEMENT_RULE_ID)
    expect(result).toEqual([])
  })
})

describe('deriveConsiderations - management considerations', () => {
  it('uses MOH NAG 2024 for sore-throat symptomatic management where evidence supports it', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')

    const result = deriveConsiderations(facts)
    const management = result.find((item) => item.ruleId === SORE_THROAT_MANAGEMENT_RULE_ID)

    expect(management).toMatchObject({
      kind: 'management',
      citations: [{ guidelineId: MOH_PHARYNGITIS_ID }],
    })
    expect(management?.text).toMatch(/^Management consideration: Consider/i)
    expect(management?.text).toMatch(/symptomatic relief/i)
    expect(management?.text).not.toMatch(/\bstart\b|\bprescribe\b|\bdose\b|\bduration\b/i)
  })

  it('does not infer acute bronchitis antibiotic-stewardship from documented cough alone', () => {
    const facts = emptyFacts()
    facts.symptoms.cough = present('cough')

    const result = deriveConsiderations(facts)
    const ruleIds = result.map((item) => item.ruleId)

    expect(ruleIds).not.toContain(BRONCHITIS_MANAGEMENT_RULE_ID)
    expect(result).toEqual([])
  })

  it('does not infer uncomplicated URTI care from documented cough alone', () => {
    const facts = emptyFacts()
    facts.symptoms.cough = present('cough')

    const result = deriveConsiderations(facts)
    const ruleIds = result.map((item) => item.ruleId)

    expect(ruleIds).not.toContain(URTI_MANAGEMENT_RULE_ID)
    expect(result).toEqual([])
  })

  it('does not infer uncomplicated URTI care from documented sore throat alone', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')

    const result = deriveConsiderations(facts)
    const ruleIds = result.map((item) => item.ruleId)

    expect(ruleIds).toContain(SORE_THROAT_MANAGEMENT_RULE_ID)
    expect(ruleIds).not.toContain(URTI_MANAGEMENT_RULE_ID)
  })
})

describe('deriveConsiderations - Task #8 scoring input', () => {
  it('emits the MOH score consideration when the threshold score and sore throat are both documented', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')

    const result = deriveConsiderations(facts, [scoreResult()])
    const scoreConsideration = result.find(
      (item) => item.ruleId === SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID,
    )

    expect(scoreConsideration).toMatchObject({
      kind: 'management',
      citations: [{ guidelineId: MOH_MODIFIED_CENTOR_ID }],
    })
    expect(scoreConsideration?.text).toMatch(/existing guideline score/i)
    expect(scoreConsideration?.text).toMatch(/antibiotic-consideration threshold/i)
    expect(scoreConsideration?.text).not.toMatch(/\brecalculate\b|\bprescribe\b/i)
  })

  it('does not emit the MOH score consideration when soreThroat is NOT_ASSESSED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = notAssessed()

    const result = deriveConsiderations(facts, [scoreResult()])

    expect(result.map((item) => item.ruleId)).not.toContain(SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID)
  })

  it('does not emit the MOH score consideration when soreThroat is UNKNOWN', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = unknown()

    const result = deriveConsiderations(facts, [scoreResult()])

    expect(result.map((item) => item.ruleId)).not.toContain(SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID)
  })

  it('does not emit the MOH score consideration when soreThroat is DENIED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = denied('no sore throat')

    const result = deriveConsiderations(facts, [scoreResult()])

    expect(result.map((item) => item.ruleId)).not.toContain(SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID)
  })

  it('does not emit score-based management when a supplied score is incomplete', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')

    const result = deriveConsiderations(facts, [
      scoreResult({
        completeness: 'incomplete',
        totalScore: null,
        category: null,
        categoryLabel: null,
      }),
    ])

    expect(result.map((item) => item.ruleId)).not.toContain(SCORE_ANTIBIOTIC_CONSIDERATION_RULE_ID)
  })
})

describe('deriveConsiderations - invalid or partial input', () => {
  it('returns an empty array for non-object input', () => {
    expect(deriveConsiderations(null)).toEqual([])
    expect(deriveConsiderations(undefined)).toEqual([])
    expect(deriveConsiderations('not facts')).toEqual([])
    expect(deriveConsiderations(42)).toEqual([])
  })

  it('returns an empty array for a malformed or partial object that is not ClinicalFacts', () => {
    expect(deriveConsiderations({ symptoms: { cough: { state: 'PRESENT' } } })).toEqual([])
    expect(deriveConsiderations({})).toEqual([])
  })
})

describe('deriveConsiderations - guideline citation validity', () => {
  it('never emits a guideline id outside the approved corpus', () => {
    const known = new Set(corpusIds)
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')
    facts.symptoms.cough = present('cough')
    facts.symptoms.fever = denied('no fever today')

    const ids = deriveConsiderations(facts).flatMap((item) =>
      item.citations.map((citation) => citation.guidelineId),
    )

    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => known.has(id))).toBe(true)
    expect(ids).not.toContain('invented-guideline-id')
    expect(ids).not.toContain('NICE-NG84')
  })

  it('does not merge conflicting throat-score antibiotic thresholds', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')
    facts.symptoms.fever = present('fever last night')
    facts.symptoms.cough = denied('no cough')
    facts.examination.tonsillar = present('tonsillar exudate')
    facts.examination.cervicalLymphNodes = present('tender anterior nodes')

    const guidelineIds = deriveConsiderations(facts).flatMap((item) =>
      item.citations.map((citation) => citation.guidelineId),
    )

    expect(guidelineIds).not.toContain('abdullah-2024-mcisaac-threshold')
    expect(guidelineIds).not.toContain('abdullah-2024-mcisaac-criteria')
  })

  it('does not infer coryza or isolated sore throat from the current ClinicalFacts shape', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')
    facts.symptoms.cough = denied('no cough')
    facts.symptoms.fever = denied('no fever')

    const result = deriveConsiderations(facts)
    const text = result.map((item) => item.text).join(' ')
    const guidelineIds = result.flatMap((item) =>
      item.citations.map((citation) => citation.guidelineId),
    )

    expect(guidelineIds).not.toContain(VIRAL_VS_BACTERIAL_ID)
    expect(text).not.toMatch(/coryza|isolated sore throat|viral pattern|bacterial cause/i)
  })
})
