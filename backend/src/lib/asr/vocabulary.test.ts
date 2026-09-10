import { MAX_ASR_CONTEXT_TERMS } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { MEDICATION_LEXICON } from '../../medications/lexicon.js'
import { parseSig } from '../../medications/sig.js'
import { CONFUSABLE_TARGETS } from '../../redflags/mishears.js'
import {
  ASR_VOCABULARY_VERSION,
  asrContextTerms,
  dictationContextTerms,
  SIG_DICTATION_TERMS,
} from './vocabulary.js'

/** Every name the spelling aid may offer the doctor. */
const LEXICON_NAMES = MEDICATION_LEXICON.flatMap(({ generic, synonyms }) => [generic, ...synonyms])

/**
 * Brands `ENGLISH_DRUG_TERMS` carries and the lexicon deliberately does not
 * (D-001). Listed so "no brand names" is a check rather than a claim about a
 * derivation nobody re-reads.
 */
const BRAND_NAMES = ['panadol', 'augmentin', 'piriton', 'ventolin', 'difflam', 'strepsils']

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
    // **There is no headroom left.** The deduped set sits exactly on the cap,
    // so this assertion is what a term added to any of the four sources trips.
    // Raising `MAX_ASR_CONTEXT_TERMS` is its own reviewed decision: its
    // docblock says the small cap exists so the list stays reviewable by eye,
    // which is the only review a value crossing the audio egress can get. The
    // next term added here has to displace one.
    expect(asrContextTerms().length).toBeLessThanOrEqual(MAX_ASR_CONTEXT_TERMS)
  })

  it('primes every drug name the spelling aid may offer', () => {
    // The same chain the confusable assertion above closes, one layer along:
    // `matchMedication` can only offer a lexicon name, so a name the recogniser
    // was never primed for is a missing link rather than a second defence.
    // Written by hand this had already drifted, leaving eleven drugs unprimed,
    // every urinary antibacterial among them.
    const terms = asrContextTerms()

    for (const name of LEXICON_NAMES) {
      expect(terms).toContain(name)
    }
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

describe('dictationContextTerms', () => {
  it('primes every drug name the doctor can accept from the parse', () => {
    // The chain assertion, and the reason this set is derived rather than
    // written: a prescription dictation exists to produce a lexicon match, so a
    // name the recogniser was not primed for cannot be matched at all.
    const terms = dictationContextTerms()

    for (const name of LEXICON_NAMES) {
      expect(terms).toContain(name)
    }
  })

  it.each(SIG_DICTATION_TERMS)('primes "%s", which parseSig can act on', (phrase) => {
    // The mirror of the drug assertion above, on the other half of a sig. A
    // phrase primed but unparseable is the same broken chain: the recogniser
    // would be biased toward words no field can come from, spending budget that
    // crosses the audio egress on nothing.
    const parsed = parseSig(phrase)

    expect(
      Object.values(parsed).some((field) => field !== null),
      `parseSig produced no field from "${phrase}"`,
    ).toBe(true)
  })

  it('carries no brand name, because the lexicon it derives from carries none', () => {
    // D-001 puts brands outside the lexicon's boundary, so a derived set
    // structurally cannot hold one. Asserted rather than commented, because the
    // structural argument only holds while the derivation does.
    const terms = dictationContextTerms()

    for (const brand of BRAND_NAMES) {
      expect(terms).not.toContain(brand)
    }
  })

  it('carries no symptom register, which is the wrong domain for a sig', () => {
    // docs/trd.md 20.7.1 measured a wrong-domain context scoring worse than no
    // context at all. A dictated prescription is fifteen seconds of drug audio,
    // so the sixty-odd Malay symptom terms ambient sends would be exactly that
    // effect, and `CONFUSABLE_TARGETS` is symptom vocabulary too.
    const terms = dictationContextTerms()

    for (const symptom of ['selesema', 'sakit tekak', 'sesak nafas', ...CONFUSABLE_TARGETS]) {
      expect(terms).not.toContain(symptom)
    }
  })

  it('hands out a fresh array, so no caller can poison the next session', () => {
    dictationContextTerms().push('Puan Siti binti Rahman')

    expect(dictationContextTerms()).not.toContain('Puan Siti binti Rahman')
  })

  it('carries no duplicates', () => {
    const terms = dictationContextTerms()

    expect(new Set(terms).size).toBe(terms.length)
  })

  it('stays within the shared bound', () => {
    expect(dictationContextTerms().length).toBeLessThanOrEqual(MAX_ASR_CONTEXT_TERMS)
  })

  it('is lowercase throughout, so one spelling is primed rather than two', () => {
    for (const term of dictationContextTerms()) {
      expect(term).toBe(term.toLowerCase())
    }
  })
})
