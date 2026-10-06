import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

/**
 * How far a denial reaches inside one patient turn (#394, #398). Both bugs
 * were silences: a genuine report sat in a turn that also held a denial, and
 * the denial swallowed it. Every case that fires here was silent under v13.
 */

const patient = (text: string): Transcript => ({
  source: 'asr_live',
  labelsReviewed: false,
  turns: [{ speaker: 'patient', text }],
})

const ruleIds = (text: string): string[] =>
  evaluateRedFlags(patient(text), ALL_REDFLAG_TRIGGERS)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)

describe('a denied first mention does not silence a later one in the same turn (#394)', () => {
  it.each([
    ['uti-systemic-deterioration', 'I never passed out before. Today I passed out.'],
    ['chest-pain', 'I never had chest pain before. Today I have chest pain.'],
    [
      'significant-dyspnoea',
      'I never had shortness of breath before. Today I have shortness of breath.',
    ],
    ['chest-pain', 'Dulu tak ada sakit dada. Sekarang sakit dada.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(text)).toContain(trigger)
  })

  it.each([
    ['uti-systemic-deterioration', 'I never passed out, and I have never passed out since.'],
    ['chest-pain', 'No chest pain. No chest pain at all.'],
  ])('%s stays silent when every mention is denied: "%s"', (trigger, text) => {
    expect(ruleIds(text)).not.toContain(trigger)
  })
})

describe('a comma followed by a new subject ends a denial (#398)', () => {
  it.each([
    ['chest-pain', 'No fever, I have chest pain.'],
    ['uti-systemic-deterioration', 'No fever, I passed out.'],
    ['uti-systemic-features', 'No cough, my body is shaking.'],
    ['chest-pain', "No fever, there's chest pain since this morning."],
    ['uti-systemic-deterioration', 'Tak ada demam, saya pengsan semalam.'],
    ['uti-systemic-features', 'Tak batuk, badan saya menggigil.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(text)).toContain(trigger)
  })

  it.each([
    // The two the issue requires to stay silent. Ending scope at every comma
    // would fire on the first, because "don't" is not read as a negator.
    ['chest-pain', "No, I don't have chest pain."],
    ['chest-pain', 'No fever or chest pain.'],
    // A new clause that carries its own negation keeps the denial in reach.
    ['uti-systemic-deterioration', "No, I haven't passed out."],
    ['uti-systemic-deterioration', 'No fever, I never passed out.'],
    ['chest-pain', 'No fever, no chest pain.'],
    ['chest-pain', 'No fever, I have no chest pain.'],
    ['chest-pain', 'Tak demam, saya tak ada sakit dada.'],
    // Negation spelled the way a typed or pasted transcript spells it.
    ['chest-pain', 'No, I dont have chest pain.'],
    ['uti-systemic-deterioration', 'No fever, I havent passed out.'],
    ['chest-pain', 'No, I deny chest pain.'],
    ['chest-pain', "No, I've had zero chest pain."],
    ['chest-pain', 'Tak, saya takdak sakit dada.'],
    ['chest-pain', 'Tak, saya xde sakit dada.'],
  ])('%s stays silent on "%s"', (trigger, text) => {
    expect(ruleIds(text)).not.toContain(trigger)
  })
})
