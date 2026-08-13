import type { ClinicalAssertion, ClinicalFacts, OperationalBlock } from '@shared/types'
import { ClinicalFactsSchema, OperationalBlockSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { GAP_CHECKLIST } from './checklist.js'
import { deriveGaps } from './derive.js'

const notAssessed = (): ClinicalAssertion => ({ state: 'NOT_ASSESSED' })
const unknown = (): ClinicalAssertion => ({ state: 'UNKNOWN' })
const present = (evidence: string, value?: string): ClinicalAssertion => ({
  state: 'PRESENT',
  value,
  evidence,
})
const denied = (evidence: string): ClinicalAssertion => ({ state: 'DENIED', evidence })

const emptyFacts = (): ClinicalFacts =>
  ClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

const emptyOperational = (): OperationalBlock => OperationalBlockSchema.parse({})

describe('deriveGaps — purity', () => {
  it('is a pure function: identical input produces identical output', () => {
    const facts = emptyFacts()
    const operational = emptyOperational()
    expect(deriveGaps(facts, operational)).toEqual(deriveGaps(facts, operational))
  })

  it('does not mutate its inputs', () => {
    const facts = emptyFacts()
    const operational = emptyOperational()
    const factsCopy = structuredClone(facts)
    const operationalCopy = structuredClone(operational)

    deriveGaps(facts, operational)

    expect(facts).toEqual(factsCopy)
    expect(operational).toEqual(operationalCopy)
  })
})

describe('deriveGaps — assertion-state gating', () => {
  it('raises a gap naming the missing record for a NOT_ASSESSED field, never phrased as an instruction', () => {
    const facts = emptyFacts()
    facts.symptoms.haemoptysis = notAssessed()

    const gaps = deriveGaps(facts, emptyOperational())
    const gap = gaps.find((g) => g.id === 'haemoptysis')

    expect(gap).toBeDefined()
    // Names what the record does not contain.
    expect(gap?.question).toMatch(/record does not/i)
    // Never tells the doctor what to ask or conclude.
    const instructionalPhrasing = /\b(you (should|did not|must)|ask (the|about)|consider|please)\b/i
    expect(gap?.question).not.toMatch(instructionalPhrasing)
    expect(gap?.rationale).not.toMatch(instructionalPhrasing)
  })

  it('raises a gap for UNKNOWN as well as NOT_ASSESSED', () => {
    const facts = emptyFacts()
    facts.symptoms.dyspnoea = unknown()

    const gaps = deriveGaps(facts, emptyOperational())
    expect(gaps.some((g) => g.id === 'dyspnoea')).toBe(true)
  })

  it('raises no gap for a field that is PRESENT with evidence', () => {
    const facts = emptyFacts()
    facts.symptoms.haemoptysis = present('coughing up blood since this morning')

    const gaps = deriveGaps(facts, emptyOperational())
    expect(gaps.some((g) => g.id === 'haemoptysis')).toBe(false)
  })

  it('raises no gap for a field that is DENIED with evidence', () => {
    const facts = emptyFacts()
    facts.symptoms.haemoptysis = denied('no coughing up blood')

    const gaps = deriveGaps(facts, emptyOperational())
    expect(gaps.some((g) => g.id === 'haemoptysis')).toBe(false)
  })

  it('every entry in the checklist fires when its field is NOT_ASSESSED', () => {
    const gaps = deriveGaps(emptyFacts(), emptyOperational())
    const gapIds = gaps.map((g) => g.id).sort()
    const checklistIds = GAP_CHECKLIST.map((entry) => entry.id).sort()
    expect(gapIds).toEqual(checklistIds)
  })
})

describe('deriveGaps — urti-gap-heavy fixture path (PRD CAP-2)', () => {
  it('yields at least three gaps on a sparse consultation', () => {
    // Mirrors backend/src/fixtures/corpus.ts "urti-gap-heavy": cough, sore
    // throat, and fever are established; haemoptysis, chest pain, dyspnoea,
    // SpO2, and respiratory rate are never raised by either speaker.
    const facts = emptyFacts()
    facts.symptoms.cough = present('Batuk sudah 3 hari lah')
    facts.symptoms.coughDuration = present('3 hari', '3 days')
    facts.symptoms.soreThroat = present('throat also quite sakit')
    facts.symptoms.fever = present('Yesterday quite hot, I check at home, 38.2 degrees')
    facts.symptoms.sputumProduction = present('A bit, whitish colour, not much')
    facts.examination.throat = present('throat is red, tonsils a bit swollen')
    facts.examination.tonsillar = present('tonsils a bit swollen')

    const gaps = deriveGaps(facts, emptyOperational())
    const gapIds = gaps.map((g) => g.id)

    expect(gaps.length).toBeGreaterThanOrEqual(3)
    expect(gapIds).toContain('haemoptysis')
    expect(gapIds).toContain('chest-pain')
    expect(gapIds).toContain('dyspnoea')
    expect(gapIds).toContain('oxygen-saturation')
    expect(gapIds).toContain('respiratory-rate')
  })
})

describe('gap text never implies a diagnosis', () => {
  const diagnosticPhrasing = /\b(patient has|diagnosed with|suffering from|likely|indicates)\b/i

  for (const entry of GAP_CHECKLIST) {
    it(`"${entry.id}" question and rationale do not state or imply a diagnosis`, () => {
      expect(entry.question).not.toMatch(diagnosticPhrasing)
      expect(entry.rationale).not.toMatch(diagnosticPhrasing)
    })
  }
})
