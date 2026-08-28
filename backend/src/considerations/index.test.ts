import type { ClinicalAssertion, ClinicalFacts } from '@shared/types'
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
  it('emits a cited safety-netting consideration when soreThroat is PRESENT', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')

    const result = deriveConsiderations(facts)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: SAFETY_NETTING_RULE_ID,
      ruleId: SAFETY_NETTING_RULE_ID,
      source: 'rule',
      citations: [{ guidelineId: SAFETY_NETTING_GUIDELINE_ID }],
    })
    expect(result[0]?.text).toMatch(/safety-netting/i)
    expect(result[0]?.citations.length).toBeGreaterThanOrEqual(1)
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
    // Safety-netting still fires from soreThroat PRESENT alone — that is expected.
    expect(ruleIds).toEqual([SAFETY_NETTING_RULE_ID])
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

  it('does not merge conflicting Centor and McIsaac antibiotic thresholds', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('sore throat')
    facts.symptoms.fever = present('fever last night')
    facts.symptoms.cough = denied('no cough')
    facts.examination.tonsillar = present('tonsillar exudate')
    facts.examination.cervicalLymphNodes = present('tender anterior nodes')

    const guidelineIds = deriveConsiderations(facts).flatMap((item) =>
      item.citations.map((citation) => citation.guidelineId),
    )

    expect(guidelineIds).not.toContain('moh-nag-2024-a10-modified-centor')
    expect(guidelineIds).not.toContain('abdullah-2024-mcisaac-threshold')
    expect(guidelineIds).not.toContain('abdullah-2024-mcisaac-criteria')
  })
})
