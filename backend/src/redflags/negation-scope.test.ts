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

describe('a comma ends a denial before a clause that does not deny (#423)', () => {
  it.each([
    ['significant-dyspnoea', 'No fever, breathless since morning.'],
    ['significant-dyspnoea', 'No fever, very short of breath since this morning.'],
    ['haemoptysis', 'No cough, coughing up blood since yesterday.'],
    ['chest-pain', 'No fever, chest pain when I walk.'],
    ['chest-pain', 'No fever, no cough, chest pain since morning.'],
    ['chest-pain', 'Tiada demam, sakit dada sejak pagi.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(text)).toContain(trigger)
  })

  it.each([
    // A list under one denial joins its last item with "or", "nor" or "atau".
    ['chest-pain', 'No fever, cough or chest pain.'],
    ['chest-pain', 'No fever, chest pain or cough.'],
    ['significant-dyspnoea', 'No fever, chest pain, nor shortness of breath.'],
    ['chest-pain', 'Tiada demam, batuk atau sakit dada.'],
    // A denying verb takes a whole list.
    ['chest-pain', 'Denies fever, chest pain, shortness of breath.'],
    ['significant-dyspnoea', 'Denies fever, chest pain, shortness of breath.'],
    ['chest-pain', 'Patient denied fever, chest pain.'],
    // Each item denied on its own.
    ['chest-pain', 'No fever, no chest pain, no cough.'],
  ])('%s stays silent on "%s"', (trigger, text) => {
    expect(ruleIds(text)).not.toContain(trigger)
  })
})

describe('a report after a comma is not a list just because it says "or" or "not" (#426)', () => {
  it.each([
    ['significant-dyspnoea', 'No fever, breathless when I walk or climb stairs.'],
    ['chest-pain', 'No fever, chest pain whether I sit or stand.'],
    ['haemoptysis', 'No fever, coughed up blood once or twice.'],
    ['significant-dyspnoea', 'Tiada demam, sesak nafas sejak pagi atau petang.'],
    ['chest-pain', 'No fever, chest pain that will not go away.'],
    ['chest-pain', 'Tiada demam, sakit dada tak hilang.'],
    ['significant-dyspnoea', 'Denied fever, now breathless.'],
    ['haemoptysis', 'He denied fever, coughing up blood today.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(text)).toContain(trigger)
  })

  it.each([
    // Still lists under the one denial.
    ['chest-pain', 'No fever, cough or chest pain.'],
    ['chest-pain', 'No fever, chest pain or cough.'],
    ['chest-pain', 'Tiada demam, batuk atau sakit dada.'],
    ['chest-pain', 'Denies fever, chest pain, shortness of breath.'],
    ['chest-pain', 'No fever, no chest pain.'],
    ['chest-pain', "No, I don't have chest pain."],
  ])('%s stays silent on "%s"', (trigger, text) => {
    expect(ruleIds(text)).not.toContain(trigger)
  })
})
