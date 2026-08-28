import type { ClinicalAssertion, ClinicalFacts, ClinicalSuggestion } from '@shared/types'
import { ClinicalFactsSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getClinicalProfile } from '../clinical-profiles/index.js'
import { corpusIdsFor } from '../guidelines/index.js'
import { deriveConsiderations } from './index.js'
import { filterConsiderationsForCorpus, mergeSuggestions, toClinicalSuggestions } from './merge.js'

const present = (evidence: string): ClinicalAssertion => ({
  state: 'PRESENT',
  evidence,
})

const emptyFacts = (): ClinicalFacts =>
  ClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

const SAFETY_NETTING_RULE_ID = 'cpg-sore-throat-safety-netting'
const SAFETY_NETTING_GUIDELINE_ID = 'abdullah-2024-safety-netting'

describe('filterConsiderationsForCorpus', () => {
  it('keeps considerations whose citations are all in the allowed set', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')
    const considerations = deriveConsiderations(facts)
    const allowed = new Set([SAFETY_NETTING_GUIDELINE_ID])

    expect(filterConsiderationsForCorpus(considerations, allowed)).toEqual(considerations)
  })

  it('drops a consideration when any citation is outside the allowed corpus', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')
    const considerations = deriveConsiderations(facts)
    // UTI profile corpus does not include the URTI safety-netting chunk.
    const utiAllowed = new Set(
      corpusIdsFor(getClinicalProfile('adult-acute-uncomplicated-uti').guidelineCorpus),
    )

    expect(utiAllowed.has(SAFETY_NETTING_GUIDELINE_ID)).toBe(false)
    expect(filterConsiderationsForCorpus(considerations, utiAllowed)).toEqual([])
  })
})

describe('toClinicalSuggestions', () => {
  it('maps ClinicalConsideration onto ClinicalSuggestion without inventing fields', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('my throat is sore')
    const consideration = deriveConsiderations(facts)[0]
    expect(consideration).toBeDefined()
    if (consideration === undefined) throw new Error('expected a consideration')

    expect(toClinicalSuggestions([consideration])).toEqual([
      {
        id: consideration.id,
        text: consideration.text,
        citations: [...consideration.citations],
      },
    ])
  })
})

describe('mergeSuggestions', () => {
  const rule: ClinicalSuggestion = {
    id: SAFETY_NETTING_RULE_ID,
    text: 'Safety-netting',
    citations: [{ guidelineId: SAFETY_NETTING_GUIDELINE_ID }],
  }
  const model: ClinicalSuggestion = {
    id: 'model-s1',
    text: 'Advise fluids',
    citations: [{ guidelineId: 'ooi-2022-urti-epidemiology' }],
  }

  it('places deterministic suggestions before model suggestions', () => {
    expect(mergeSuggestions([rule], [model]).map((s) => s.id)).toEqual([
      SAFETY_NETTING_RULE_ID,
      'model-s1',
    ])
  })

  it('never drops a rule suggestion based on model output', () => {
    const emptyModel: ClinicalSuggestion[] = []
    const overlappingModel: ClinicalSuggestion[] = [
      { ...model, id: SAFETY_NETTING_RULE_ID, text: 'Model tries to replace the rule' },
    ]

    expect(mergeSuggestions([rule], emptyModel)).toContainEqual(rule)
    expect(
      mergeSuggestions([rule], overlappingModel).filter((s) => s.id === SAFETY_NETTING_RULE_ID),
    ).toHaveLength(2)
    expect(mergeSuggestions([rule], overlappingModel)[0]).toEqual(rule)
  })

  it('keeps model suggestions additive', () => {
    expect(mergeSuggestions([rule], [model])).toEqual([rule, model])
  })
})

describe('evidence-checked facts -> suggestions (integration of derive + filter + map)', () => {
  it('emits a ClinicalSuggestion when validated facts trigger a rule', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = present('throat pain for two days')
    const urtiAllowed = new Set(
      corpusIdsFor(getClinicalProfile('adult-acute-urti').guidelineCorpus),
    )

    const suggestions = toClinicalSuggestions(
      filterConsiderationsForCorpus(deriveConsiderations(facts), urtiAllowed),
    )

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.id).toBe(SAFETY_NETTING_RULE_ID)
    expect(suggestions[0]?.citations.every((c) => urtiAllowed.has(c.guidelineId))).toBe(true)
  })

  it('does not emit positive considerations when soreThroat is NOT_ASSESSED', () => {
    const facts = emptyFacts()
    facts.symptoms.soreThroat = { state: 'NOT_ASSESSED' }
    const urtiAllowed = new Set(
      corpusIdsFor(getClinicalProfile('adult-acute-urti').guidelineCorpus),
    )

    expect(
      toClinicalSuggestions(
        filterConsiderationsForCorpus(deriveConsiderations(facts), urtiAllowed),
      ),
    ).toEqual([])
  })
})
