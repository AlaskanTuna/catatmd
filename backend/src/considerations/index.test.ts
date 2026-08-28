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

const emptyFacts = (): ClinicalFacts =>
  ClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

describe('deriveConsiderations - purity', () => {
  it('is a pure function: identical input produces identical output', () => {
    const facts = emptyFacts()
    expect(deriveConsiderations(facts)).toEqual(deriveConsiderations(facts))
  })

  it('does not mutate its inputs', () => {
    const facts = emptyFacts()
    const copy = structuredClone(facts)
    deriveConsiderations(facts)
    expect(facts).toEqual(copy)
  })
})

/**
 * No clinical firing rule is approved for Task #4-A (see the #4-A provenance
 * audit): the sore-throat safety-netting advice had corpus support, but its
 * structured trigger had not received human approval; the viral-pattern rule
 * was an incomplete/inferred criterion and must not be implemented. Every
 * state below must therefore still yield an empty result.
 */
describe('deriveConsiderations - zero approved firing rules', () => {
  it('returns an empty array for valid ClinicalFacts with nothing documented', () => {
    expect(deriveConsiderations(emptyFacts())).toEqual([])
  })

  it('returns an empty array when facts are documented as PRESENT', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')
    facts.symptoms.cough = present('cough for three days')

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('returns an empty array when facts are explicitly DENIED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = denied('no sore throat')
    facts.symptoms.fever = denied('no fever')

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('returns an empty array when facts are NOT_ASSESSED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = notAssessed()

    expect(deriveConsiderations(facts)).toEqual([])
  })

  it('returns an empty array when facts are UNKNOWN', () => {
    const facts = emptyFacts()
    facts.symptoms.fever = unknown()

    expect(deriveConsiderations(facts)).toEqual([])
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

    expect(ids.every((id) => known.has(id))).toBe(true)
    expect(ids).not.toContain('invented-guideline-id')
    expect(ids).not.toContain('NICE-NG84')
  })
})
