import {
  DOSE_UNIT,
  DURATION_UNITS,
  FREQUENCY_ABBREVIATIONS,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
  SPOKEN_NUMERALS,
} from './vocabulary.js'

/**
 * Turns a dictated dosing phrase into fields, in the register a Malaysian GP
 * actually speaks. "makan tiga kali sehari, lepas makan, selama lima hari"
 * and "TDS after food for five days" are the same prescription and parse to
 * the same object.
 *
 * **Every field is nullable and stays null rather than being guessed.** The
 * verbatim dictation travels alongside these fields, so an unparsed phrase is
 * still visible to the doctor; a wrong parse is not.
 *
 * Each match consumes its span, so no later pattern can reread those
 * characters. That is what keeps `makan` in "lepas makan" from also reading
 * as the verb "take". Rules are tried in the order they are declared and
 * there is no length tiebreak, so a whole phrase must be declared above any
 * word it contains; the tests pin the cases where that matters.
 *
 * Pure functions: no I/O, no clock, no randomness.
 */

export type Sig = {
  /** Amount and unit as said, normalised only in spacing and case: `500 mg`. */
  readonly dose: string | null
  readonly route: SigRoute | null
  readonly frequency: SigFrequency | null
  /** Translated to English, because `hari` and `minggu` have exact equivalents. */
  readonly duration: string | null
  readonly food: SigFoodTiming | null
}

const EMPTY: Sig = { dose: null, route: null, frequency: null, duration: null, food: null }

const NUMERAL = [...SPOKEN_NUMERALS.keys()].join('|')
const DURATION_UNIT = [...DURATION_UNITS.keys()].join('|')

const numberOf = (word: string): number | null => {
  const digits = Number.parseFloat(word)
  if (!Number.isNaN(digits)) return digits
  return SPOKEN_NUMERALS.get(word.toLowerCase()) ?? null
}

type Rule<T> = { readonly pattern: RegExp; readonly read: (match: RegExpMatchArray) => T | null }

const rule = <T>(source: string, read: (match: RegExpMatchArray) => T | null): Rule<T> => ({
  pattern: new RegExp(source, 'gi'),
  read,
})

/**
 * `sekali sehari` and friends are whole phrases, never `se` plus a numeral.
 * `se-` is a bound prefix meaning "one", so decomposing it would read
 * "tiga kali sehari, selama lima hari" as a one-day course.
 */
const FREQUENCY_RULES: readonly Rule<SigFrequency>[] = [
  rule('\\bsekali\\s+sehari\\b', () => 'once-daily'),
  rule(`\\b(${NUMERAL}|\\d+)\\s+kali\\s+sehari\\b`, (match) => {
    switch (numberOf(match[1] as string)) {
      case 1:
        return 'once-daily'
      case 2:
        return 'twice-daily'
      case 3:
        return 'three-times-daily'
      case 4:
        return 'four-times-daily'
      default:
        return null
    }
  }),
  rule('\\bbila\\s+perlu\\b', () => 'when-required'),
  rule('\\bwhen\\s+(?:required|needed)\\b|\\bas\\s+needed\\b|\\bprn\\b', () => 'when-required'),
  rule('\\bonce\\s+(?:a\\s+day|daily|per\\s+day)\\b', () => 'once-daily'),
  rule('\\btwice\\s+(?:a\\s+day|daily|per\\s+day)\\b', () => 'twice-daily'),
  rule(`\\b(${NUMERAL}|\\d+)\\s+times?\\s+(?:a\\s+day|daily|per\\s+day)\\b`, (match) => {
    switch (numberOf(match[1] as string)) {
      case 1:
        return 'once-daily'
      case 2:
        return 'twice-daily'
      case 3:
        return 'three-times-daily'
      case 4:
        return 'four-times-daily'
      default:
        return null
    }
  }),
  rule('\\bevery\\s+(\\d+)\\s*(?:hours?|h)\\b|\\bsetiap\\s+(\\d+)\\s*jam\\b', (match) => {
    const hours = Number.parseInt((match[1] ?? match[2]) as string, 10)
    return hours === 4 || hours === 6 || hours === 8 || hours === 12
      ? (`every-${hours}-hours` as SigFrequency)
      : null
  }),
  rule('\\bat\\s+night\\b|\\bnocte\\b|\\bwaktu\\s+malam\\b', () => 'at-night'),
  // Latin abbreviations last: `stat` and `od` are short and could sit inside a
  // longer phrase that one of the rules above should have claimed first.
  ...FREQUENCY_ABBREVIATIONS.filter(
    (entry): entry is { token: string; frequency: SigFrequency } => entry.frequency !== null,
  ).map(({ token, frequency }) => rule<SigFrequency>(`\\b${token}\\b`, () => frequency)),
]

const ROUTE_RULES: readonly Rule<SigRoute>[] = [
  // `makan` is absent by design. It is the verb "take", exactly as English
  // "take 500 mg" names no route, and reading it as one would make the two
  // required fixtures disagree.
  rule(
    '\\bby\\s+mouth\\b|\\borally\\b|\\boral\\b|\\bp\\.?o\\.?\\b|\\bsecara\\s+oral\\b',
    () => 'oral',
  ),
  rule('\\btopical(?:ly)?\\b|\\bsapu\\b', () => 'topical'),
  rule('\\binhaled?\\b|\\bpuffs?\\b|\\bvia\\s+inhaler\\b|\\bsedut\\b', () => 'inhaled'),
  rule('\\bnasal(?:ly)?\\b|\\bnose\\s+spray\\b|\\bnasal\\s+spray\\b', () => 'nasal'),
]

const FOOD_RULES: readonly Rule<SigFoodTiming>[] = [
  rule('\\bsebelum\\s+makan\\b', () => 'before'),
  rule('\\b(?:selepas|lepas)\\s+makan\\b', () => 'after'),
  rule('\\bbefore\\s+(?:food|meals?|eating)\\b', () => 'before'),
  rule('\\bafter\\s+(?:food|meals?|eating)\\b', () => 'after'),
  rule('\\bwith\\s+(?:food|meals?)\\b|\\bbersama\\s+makanan\\b', () => 'with'),
]

const DOSE_RULES: readonly Rule<string>[] = [
  rule(
    `\\b(\\d+(?:\\.\\d+)?)\\s*(${DOSE_UNIT})\\b`,
    (match) => `${match[1]} ${(match[2] as string).toLowerCase()}`,
  ),
  // Countable forms keep the doctor's own word. `sudu` is 5 ml or 15 ml
  // depending on the spoon, so translating it would be a clinical judgement.
  rule(`\\b(${NUMERAL}|\\d+)\\s+(biji|sudu|tablets?|capsules?)\\b`, (match) => {
    const count = numberOf(match[1] as string)
    return count === null ? null : `${count} ${(match[2] as string).toLowerCase()}`
  }),
]

const DURATION_RULES: readonly Rule<string>[] = [
  rule(`\\b(?:selama|for)\\s+(${NUMERAL}|\\d+)\\s+(${DURATION_UNIT})\\b`, (match) => {
    const count = numberOf(match[1] as string)
    const unit = DURATION_UNITS.get((match[2] as string).toLowerCase())
    return count === null || unit === undefined ? null : `${count} ${unit}`
  }),
]

type Claim = { readonly start: number; readonly end: number }

/**
 * First rule that matches unclaimed characters wins, in declaration order. A
 * claimed span is never reread, which is what makes `lepas makan` consume
 * both words. Declaration order is load-bearing and hand-maintained: a rule
 * placed above a longer phrase it appears inside would claim the short match
 * first.
 */
const firstUnclaimed = <T>(text: string, rules: readonly Rule<T>[], claims: Claim[]): T | null => {
  for (const { pattern, read } of rules) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      if (claims.some((claim) => start < claim.end && claim.start < end)) continue

      const value = read(match)
      if (value === null) continue

      claims.push({ start, end })
      return value
    }
  }
  return null
}

export const parseSig = (text: string): Sig => {
  if (text.trim() === '') return EMPTY

  const claims: Claim[] = []

  // Food timing first: it owns the only phrases in which `makan` is a noun,
  // and claiming them keeps every later rule off those characters.
  const food = firstUnclaimed(text, FOOD_RULES, claims)
  const duration = firstUnclaimed(text, DURATION_RULES, claims)
  const frequency = firstUnclaimed(text, FREQUENCY_RULES, claims)
  const dose = firstUnclaimed(text, DOSE_RULES, claims)
  const route = firstUnclaimed(text, ROUTE_RULES, claims)

  return { dose, route, frequency, duration, food }
}
