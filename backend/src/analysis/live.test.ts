import {
  type ClinicalFacts,
  ClinicalFactsSchema,
  type OperationalBlock,
  OperationalBlockSchema,
} from '@shared/types'
import { describe, expect, it } from 'vitest'
import { foldFacts, foldOperational } from './live.js'

/**
 * The fold is what lets a live cycle carry only the new window (#219). Every
 * test here is really the same question from a different angle: can a finding
 * the doctor has already been shown disappear from the screen because a later
 * window happened not to mention it? The answer has to be no.
 *
 * Built from the real schemas rather than a toy record, because the shape is
 * the hard part: `ClinicalFacts` is four nested groups and `OperationalBlock`
 * holds an array of assertions among its fields. A flat merge typechecks
 * against neither.
 */

const emptyFacts = (): ClinicalFacts =>
  ClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

const emptyOperational = (): OperationalBlock => OperationalBlockSchema.parse({})

const present = (value: string) => ({ state: 'PRESENT' as const, value, evidence: value })

describe('foldFacts over clinical facts', () => {
  it('keeps a finding the current window does not re-establish', () => {
    // The normal case, not a regression. Each window is asked only what it
    // establishes, so a fact settled two windows ago comes back NOT_ASSESSED.
    const previous = emptyFacts()
    previous.symptoms.cough = present('three days')

    const incoming = emptyFacts()
    incoming.symptoms.fever = present('38.1')

    const merged = foldFacts(previous, incoming)
    expect(merged.symptoms.cough).toEqual(present('three days'))
    expect(merged.symptoms.fever).toEqual(present('38.1'))
  })

  it('lets an established finding be corrected by another established value', () => {
    const previous = emptyFacts()
    previous.symptoms.cough = present('three days')

    const incoming = emptyFacts()
    incoming.symptoms.cough = present('five days')

    // A patient revising themselves is new information, not churn.
    expect(foldFacts(previous, incoming).symptoms.cough).toEqual(present('five days'))
  })

  it('treats UNKNOWN as unestablished, so it cannot blank a shown finding', () => {
    const previous = emptyFacts()
    previous.symptoms.cough = present('three days')

    const incoming = emptyFacts()
    incoming.symptoms.cough = { state: 'UNKNOWN' }

    expect(foldFacts(previous, incoming).symptoms.cough).toEqual(present('three days'))
  })

  it('carries a DENIED finding forward too', () => {
    // DENIED is documented, not missing. Losing it would put an answered
    // question back on the Missing Information list.
    const previous = emptyFacts()
    previous.symptoms.chestPain = { state: 'DENIED', value: 'no', evidence: 'No chest pain.' }

    const merged = foldFacts(previous, emptyFacts())
    expect(merged.symptoms.chestPain.state).toBe('DENIED')
  })

  it('reaches every group, not just the first', () => {
    const previous = emptyFacts()
    previous.symptoms.cough = present('cough')
    previous.history.asthma = present('asthma')
    previous.observations.temperature = present('38.1')
    previous.examination.throat = present('injected')

    const merged = foldFacts(previous, emptyFacts())
    expect(merged.symptoms.cough.state).toBe('PRESENT')
    expect(merged.history.asthma.state).toBe('PRESENT')
    expect(merged.observations.temperature.state).toBe('PRESENT')
    expect(merged.examination.throat.state).toBe('PRESENT')
  })

  it('returns the opening window untouched', () => {
    const incoming = emptyFacts()
    expect(foldFacts(null, incoming)).toBe(incoming)
  })
})

describe('foldOperational', () => {
  it('does not let an empty dispensing list erase a filled one', () => {
    const previous = emptyOperational()
    previous.medicationsDispensed = [present('amoxicillin 500mg')]

    const merged = foldOperational(previous, emptyOperational())
    expect(merged.medicationsDispensed).toHaveLength(1)
  })

  it('unions dispensing lists rather than replacing them', () => {
    /*
     * Found by clinical review. Replacing looked right and was not: a later
     * window naming a second drug erased the first, which made this the one
     * field where established content could be silently dropped.
     */
    const previous = emptyOperational()
    previous.medicationsDispensed = [present('amoxicillin 500mg')]

    const incoming = emptyOperational()
    incoming.medicationsDispensed = [present('paracetamol 1g')]

    const merged = foldOperational(previous, incoming)
    expect(merged.medicationsDispensed.map((m) => m.value)).toEqual([
      'amoxicillin 500mg',
      'paracetamol 1g',
    ])
  })

  it('does not double a drug named in two windows', () => {
    const previous = emptyOperational()
    previous.medicationsDispensed = [present('amoxicillin 500mg')]

    const incoming = emptyOperational()
    incoming.medicationsDispensed = [present('amoxicillin 500mg'), present('paracetamol 1g')]

    expect(foldOperational(previous, incoming).medicationsDispensed).toHaveLength(2)
  })

  it('lets a clinical conclusion be retracted, unlike a symptom', () => {
    /*
     * The asymmetry the "no output is a diagnosis" invariant rests on. Under
     * the monotone rule a model latching onto a doctor thinking aloud in one
     * window would pin a diagnosis on screen that no later window could take
     * back, because NOT_ASSESSED never wins. Expressed per block rather than
     * per field, because naming the field here would put a clinical rule
     * outside the versioned data and `no-stray-clinical-constants.test.ts`
     * catches exactly that.
     */
    const previous = emptyOperational()
    previous.diagnosis = present('community-acquired pneumonia')

    expect(foldOperational(previous, emptyOperational()).diagnosis.state).toBe('NOT_ASSESSED')
  })

  it('lets the newest window win on every scalar in the block', () => {
    // The cost of the rule above, stated rather than hidden: a value named
    // mid-consultation can blank if a later window does not repeat it. Cosmetic
    // and self-correcting, where a latched conclusion is neither.
    const previous = emptyOperational()
    previous.mcDays = present('2')

    expect(foldOperational(previous, emptyOperational()).mcDays.state).toBe('NOT_ASSESSED')
  })

  it('still keeps clinical facts monotone, which is the safe direction there', () => {
    const previous = emptyFacts()
    previous.symptoms.cough = present('three days')

    expect(foldFacts(previous, emptyFacts()).symptoms.cough.state).toBe('PRESENT')
  })
})
