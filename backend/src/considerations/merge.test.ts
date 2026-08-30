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
    const allowed = new Set(corpusIdsFor(getClinicalProfile('adult-acute-urti').guidelineCorpus))

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

  it('keeps a safe model suggestion additive', () => {
    const safeModel: ClinicalSuggestion = {
      id: 'model-safe',
      text: 'Consider documenting return precautions for worsening symptoms.',
      citations: [{ guidelineId: 'ooi-2022-urti-epidemiology' }],
    }

    expect(mergeSuggestions([rule], [safeModel])).toEqual([rule, safeModel])
  })

  it('suppresses model suggestions that state autonomous diagnostic language', () => {
    const diagnosticModel: ClinicalSuggestion = {
      id: 'model-diagnosis',
      text: 'Diagnostic impression: acute bacterial tonsillitis.',
      citations: [{ guidelineId: 'moh-nag-2024-c1-acute-pharyngitis' }],
    }

    expect(mergeSuggestions([rule], [diagnosticModel])).toEqual([rule])
  })

  it('suppresses model suggestions that state prescribing or medication orders', () => {
    const prescribingModel: ClinicalSuggestion = {
      id: 'model-prescribing',
      text: 'Prescribe amoxicillin 500 mg three times daily.',
      citations: [{ guidelineId: 'moh-nag-2024-a10-modified-centor' }],
    }

    expect(mergeSuggestions([rule], [prescribingModel])).toEqual([rule])
  })

  it('suppresses a bare medication regimen carrying no directive verb', () => {
    const regimenModel: ClinicalSuggestion = {
      id: 'model-regimen',
      text: 'Penicillin V 500 mg four times daily for 10 days.',
      citations: [{ guidelineId: 'moh-nag-2024-c1-acute-pharyngitis' }],
    }

    expect(mergeSuggestions([rule], [regimenModel])).toEqual([rule])
  })

  it('checks the model-authored citation quote, not the suggestion text alone', () => {
    const quotedModel: ClinicalSuggestion = {
      id: 'model-quote',
      text: 'Consider reviewing the cited guidance.',
      citations: [
        {
          guidelineId: 'moh-nag-2024-c1-acute-pharyngitis',
          quote: 'Prescribe amoxicillin for this diagnosis.',
        },
      ],
    }

    expect(mergeSuggestions([rule], [quotedModel])).toEqual([rule])
  })

  it('does not apply model-suggestion safety filtering to deterministic considerations', () => {
    const deterministicDifferential: ClinicalSuggestion = {
      id: 'cpg-differential-acute-pharyngitis',
      text:
        'Differential consideration: Consider acute pharyngitis/tonsillitis as part of the ' +
        'differential for a documented sore-throat presentation.',
      citations: [{ guidelineId: 'moh-nag-2024-c1-acute-pharyngitis' }],
    }

    expect(mergeSuggestions([deterministicDifferential], [])).toEqual([deterministicDifferential])
  })

  it('keeps deterministic suggestions when an unsafe model suggestion reuses their id', () => {
    const unsafeReplacement: ClinicalSuggestion = {
      id: SAFETY_NETTING_RULE_ID,
      text: 'Diagnosis: acute bacterial pharyngitis. Start antibiotics.',
      citations: [{ guidelineId: SAFETY_NETTING_GUIDELINE_ID }],
    }

    expect(mergeSuggestions([rule], [unsafeReplacement])).toEqual([rule])
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

    expect(suggestions.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'cpg-differential-acute-pharyngitis',
        'cpg-management-sore-throat-symptomatic-relief',
        SAFETY_NETTING_RULE_ID,
      ]),
    )
    expect(suggestions.every((s) => s.citations.every((c) => urtiAllowed.has(c.guidelineId)))).toBe(
      true,
    )
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
