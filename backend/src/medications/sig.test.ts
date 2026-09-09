import { describe, expect, it } from 'vitest'
import { parseSig, type Sig } from './sig.js'

/**
 * Rojak is the register, not an edge case (issue #311).
 *
 * `docs/trd.md` §20.1 is titled "Model Selection For Malaysian Code-Switched
 * Speech" and §20.3 measures a Malay-dominant consultation with mid-sentence
 * English switches. A doctor is at least as likely to say "makan tiga kali
 * sehari" as "TDS", so the two fixtures below are the same prescription and
 * have to produce the same object.
 */

const EMPTY: Sig = { dose: null, route: null, frequency: null, duration: null, food: null }

describe('parseSig reads the same prescription in either language', () => {
  const rojak = 'amoxicillin 500 mg, makan tiga kali sehari, lepas makan, selama lima hari'
  const english = 'amoxicillin 500mg TDS after food for five days'

  it('parses the fully code-switched dictation', () => {
    expect(parseSig(rojak)).toEqual({
      dose: '500 mg',
      route: null,
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
    })
  })

  it('parses the English dictation identically', () => {
    expect(parseSig(english)).toEqual(parseSig(rojak))
  })

  it('does not read selama lima hari as a one-day course', () => {
    // `sehari` is se+hari, a bound prefix meaning "one". A numeral
    // normaliser that decomposed it would take the `hari` inside the
    // frequency phrase and report a one-day course on a five-day
    // prescription. This is the assertion that forbids that.
    expect(parseSig(rojak).duration).toBe('5 days')
    expect(parseSig('sekali sehari selama dua minggu')).toMatchObject({
      frequency: 'once-daily',
      duration: '2 weeks',
    })
  })
})

describe('parseSig leaves a field null rather than guessing', () => {
  it('reads no route from food timing alone', () => {
    // `makan` is the verb "take", exactly as English "take 500 mg" names no
    // route. Reading it as oral would also make the two fixtures above
    // disagree, because one has a bare `makan` and the other has no route
    // word at all.
    expect(parseSig('lepas makan')).toEqual({ ...EMPTY, food: 'after' })
    expect(parseSig('makan tiga kali sehari').route).toBeNull()
  })

  it('reads nothing from an empty or unparseable phrase', () => {
    expect(parseSig('')).toEqual(EMPTY)
    expect(parseSig('   ')).toEqual(EMPTY)
    expect(parseSig('patient reviewed and reassured')).toEqual(EMPTY)
  })

  it('refuses a frequency it cannot name', () => {
    // Seven times a day and every five hours are not in the closed set, and
    // rounding either to a neighbour would be interpretation.
    expect(parseSig('tujuh kali sehari').frequency).toBeNull()
    expect(parseSig('every 5 hours').frequency).toBeNull()
  })

  it('keeps every-6-hours distinct from four-times-daily', () => {
    // Clinically different instructions. Folding one into the other would be
    // the module deciding something the doctor did not say.
    expect(parseSig('500 mg every 6 hours').frequency).toBe('every-6-hours')
    expect(parseSig('500 mg qid').frequency).toBe('four-times-daily')
  })
})

describe('parseSig dose handling', () => {
  it('normalises spacing and case but never the unit itself', () => {
    expect(parseSig('500mg').dose).toBe('500 mg')
    expect(parseSig('500 MG').dose).toBe('500 mg')
    expect(parseSig('1 g stat').dose).toBe('1 g')
    expect(parseSig('2.5 ml bd').dose).toBe('2.5 ml')
  })

  it('keeps a countable Malay unit in the doctor own words', () => {
    // `sudu` is 5 ml or 15 ml depending on the spoon and `biji` assumes a
    // dosage form. Translating either would be a clinical judgement.
    expect(parseSig('makan dua biji tiga kali sehari').dose).toBe('2 biji')
    expect(parseSig('satu sudu bila perlu').dose).toBe('1 sudu')
  })
})

describe('parseSig vocabulary', () => {
  it.each([
    ['sekali sehari', 'once-daily'],
    ['dua kali sehari', 'twice-daily'],
    ['tiga kali sehari', 'three-times-daily'],
    ['empat kali sehari', 'four-times-daily'],
    ['bila perlu', 'when-required'],
    ['od', 'once-daily'],
    ['bd', 'twice-daily'],
    ['tds', 'three-times-daily'],
    ['qid', 'four-times-daily'],
    ['prn', 'when-required'],
    ['stat', 'immediately'],
    ['three times a day', 'three-times-daily'],
  ])('reads %s as %s', (text, frequency) => {
    expect(parseSig(text).frequency).toBe(frequency)
  })

  it.each([
    ['sebelum makan', 'before'],
    ['selepas makan', 'after'],
    ['lepas makan', 'after'],
    ['before food', 'before'],
    ['after meals', 'after'],
    ['with food', 'with'],
  ])('reads %s as food timing %s', (text, food) => {
    expect(parseSig(text).food).toBe(food)
  })

  it.each([
    ['selama lima hari', '5 days'],
    ['selama dua minggu', '2 weeks'],
    ['for five days', '5 days'],
    ['for 10 days', '10 days'],
  ])('reads %s as %s', (text, duration) => {
    expect(parseSig(text).duration).toBe(duration)
  })

  it.each([
    ['by mouth', 'oral'],
    ['orally', 'oral'],
    ['PO', 'oral'],
    ['two puffs', 'inhaled'],
    ['nasal spray', 'nasal'],
    ['apply topically', 'topical'],
  ])('reads %s as route %s', (text, route) => {
    expect(parseSig(text).route).toBe(route)
  })

  it('reads an explicit route alongside the rest', () => {
    // Route is not dead code: neither required fixture carries one, so this
    // is the case that exercises it end to end.
    expect(parseSig('amoxicillin 500 mg by mouth tds for five days')).toEqual({
      dose: '500 mg',
      route: 'oral',
      frequency: 'three-times-daily',
      duration: '5 days',
      food: null,
    })
  })
})
