import { MAX_ASR_CONTEXT_TERMS } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { CONFUSABLE_TARGETS } from '../../redflags/mishears.js'
import { ASR_VOCABULARY_VERSION, asrContextTerms } from './vocabulary.js'

describe('asrContextTerms', () => {
  it('covers every word the confusable table exists to recover', () => {
    // The derivation is the point: a pair added to `CONFUSABLES` must not be
    // able to arrive without the recogniser having been primed for its target.
    for (const target of CONFUSABLE_TARGETS) {
      expect(asrContextTerms()).toContain(target)
    }
  })

  it('hands out a fresh array, so no caller can poison the next session', () => {
    // This value crosses the audio egress, where nothing can be de-identified.
    asrContextTerms().push('Puan Siti binti Rahman')

    expect(asrContextTerms()).not.toContain('Puan Siti binti Rahman')
  })

  it('carries no duplicates', () => {
    const terms = asrContextTerms()

    expect(new Set(terms).size).toBe(terms.length)
  })

  it('stays within the shared bound', () => {
    expect(asrContextTerms().length).toBeLessThanOrEqual(MAX_ASR_CONTEXT_TERMS)
  })

  it('is lowercase throughout, so one spelling is primed rather than two', () => {
    for (const term of asrContextTerms()) {
      expect(term).toBe(term.toLowerCase())
    }
  })

  it('names the Malay symptom vocabulary the measurement turned on', () => {
    // docs/trd.md 20.7.1: a clinical Malay vocabulary carried the same clip
    // from "Dr. Sayyabah Taksudali Maharaj" to one word wrong. These are the
    // words that consultation is about.
    expect(asrContextTerms()).toEqual(
      expect.arrayContaining(['demam', 'batuk', 'selesema', 'sakit tekak', 'sesak nafas']),
    )
  })

  it('names drug vocabulary in English, because that is how it is spoken', () => {
    // Malaysian doctors name drugs in English inside otherwise-Malay speech,
    // so a term primed in Malay could not match the audio.
    expect(asrContextTerms()).toEqual(
      expect.arrayContaining(['paracetamol', 'amoxicillin', 'salbutamol']),
    )
  })

  it('carries no English rendering of a symptom the Malay list already covers', () => {
    // 20.7.1's fifth condition scored an English clinical context worse than
    // no context at all on Malay audio. Drug names are proper nouns and are
    // the stated exception; an English symptom word is the thing measured to
    // hurt, and would also duplicate the Malay term beside it.
    const terms = asrContextTerms()

    for (const english of ['fever', 'cough', 'sore throat', 'runny nose', 'shortness of breath']) {
      expect(terms).not.toContain(english)
    }
  })

  it('is versioned, so a change to clinical content is traceable', () => {
    expect(ASR_VOCABULARY_VERSION.id).toMatch(/^asr-vocabulary-v\d+$/)
    expect(ASR_VOCABULARY_VERSION.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
