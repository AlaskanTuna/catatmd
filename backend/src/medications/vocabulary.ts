/**
 * Dose, frequency and duration vocabulary, in one place because two modules
 * read it: `parseSig` needs a mapping (`tds` to `three-times-daily`) and
 * `suggestions/safety.ts` needs an alternation for its bare-dose guard. The
 * alternation is derived from the table rather than written twice.
 *
 * The English fragments moved here from `safety.ts`, where they were inlined
 * in one composed regex. Recomposing that regex from these constants leaves
 * its source byte for byte identical; `safety.test.ts` covers every unit
 * branch to keep it that way.
 *
 * Dosing is bilingual and drug names are not. `docs/trd.md` §20.1 records the
 * reason: Malaysian consultations are Malay-dominant with English switches,
 * but "medical vocabulary is English". A doctor says "makan tiga kali sehari"
 * and still says "amoxicillin".
 *
 * No I/O, no clock, no randomness (`redflags/evaluate.ts` posture).
 */

/*
 * The three closed sets moved to `shared/` when #312 gave them a wire contract,
 * and are re-exported here so this module's public surface is unchanged.
 *
 * They had to move rather than be mirrored: a prescription stores a route, a
 * frequency and a food timing, so the SPA parses them and `shared/` is the only
 * place both sides can read. Declaring a second copy beside `PrescriptionSchema`
 * is exactly the drift the shared-contract rule exists to stop, and a Zod enum
 * that had silently fallen behind this parser would be a validation failure on
 * a value the parser had just produced.
 *
 * Everything below this line is parser-internal and stays here.
 */
import type { SigFrequency } from '@shared/types'

export {
  SIG_FOOD_TIMINGS,
  SIG_FREQUENCIES,
  SIG_ROUTES,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
} from '@shared/types'

/**
 * Units exactly as `safety.ts` accepted them, including both `μg` and `ug`.
 * A regex fragment rather than a list because `units?` is a pattern.
 */
export const DOSE_UNIT = 'mg|g|mcg|μg|ug|ml|units?|iu'

/** The `/kg`, `per day`, `per dose` tail. Guard-only: a sig does not carry it. */
export const DOSE_RATE = 'kg|day|dose'

/** Loose English frequency words. Guard-only; `parseSig` needs whole phrases. */
export const FREQUENCY_WORD =
  'once|twice|thrice|daily|every\\s+\\d+\\s*(?:hours?|h)|(?:one|two|three|four)\\s+times?(?:\\s+daily)?'

/** Guard-only duration tail. */
export const DURATION_DAYS = 'for\\s+\\d+\\s+days?'

/**
 * Latin abbreviations. Order is load-bearing twice over: the derived
 * alternation reproduces `safety.ts`'s original source exactly, and `q` must
 * stay first with a trailing `\b` on the group so it cannot short-circuit
 * `qid`. `q` alone means "every" and is meaningless without a number, so it
 * maps to nothing rather than being guessed at.
 */
export const FREQUENCY_ABBREVIATIONS: readonly {
  readonly token: string
  readonly frequency: SigFrequency | null
}[] = [
  { token: 'q', frequency: null },
  { token: 'od', frequency: 'once-daily' },
  { token: 'bd', frequency: 'twice-daily' },
  { token: 'bid', frequency: 'twice-daily' },
  { token: 'tds', frequency: 'three-times-daily' },
  { token: 'tid', frequency: 'three-times-daily' },
  { token: 'qid', frequency: 'four-times-daily' },
  { token: 'qhs', frequency: 'at-night' },
  { token: 'qds', frequency: 'four-times-daily' },
  { token: 'stat', frequency: 'immediately' },
]

export const FREQUENCY_ABBREVIATION = FREQUENCY_ABBREVIATIONS.map(({ token }) => token).join('|')

/**
 * Numerals as spoken, both languages. `se-` is deliberately absent: it is a
 * bound prefix meaning "one", so a normaliser that decomposed `sehari` into
 * `1 hari` would read "tiga kali sehari, selama lima hari" as a one-day
 * course. `sekali sehari` is matched as a whole phrase instead.
 */
export const SPOKEN_NUMERALS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['satu', 1],
  ['dua', 2],
  ['tiga', 3],
  ['empat', 4],
  ['lima', 5],
  ['enam', 6],
  ['tujuh', 7],
  ['lapan', 8],
  ['delapan', 8],
  ['sembilan', 9],
  ['sepuluh', 10],
])

/** Countable dosage-form units, kept in the doctor's own words. */
export const COUNTABLE_UNITS = ['biji', 'sudu', 'tablet', 'tablets', 'capsule', 'capsules'] as const

/**
 * Duration units. These *are* translated to English, unlike dose units,
 * because `hari` and `minggu` have exact time-word equivalents while `biji`
 * and `sudu` do not: `sudu` is 5 ml or 15 ml depending on the spoon, and
 * converting it would be a clinical judgement this module must not make.
 */
export const DURATION_UNITS: ReadonlyMap<string, 'days' | 'weeks'> = new Map([
  ['day', 'days'],
  ['days', 'days'],
  ['hari', 'days'],
  ['week', 'weeks'],
  ['weeks', 'weeks'],
  ['minggu', 'weeks'],
])

/**
 * Every token the sig vocabulary owns. `matchMedication` refuses to score
 * these against a drug name, so "makan tiga kali sehari" cannot raise a
 * candidate on its own words.
 */
export const SIG_STOPWORDS: ReadonlySet<string> = new Set([
  ...SPOKEN_NUMERALS.keys(),
  ...COUNTABLE_UNITS,
  ...DURATION_UNITS.keys(),
  ...FREQUENCY_ABBREVIATIONS.map(({ token }) => token),
  'mg',
  'g',
  'mcg',
  'μg',
  'ug',
  'ml',
  'unit',
  'units',
  'iu',
  'kali',
  'sehari',
  'sekali',
  'seminggu',
  'makan',
  'ubat',
  'selama',
  'sebelum',
  'selepas',
  'lepas',
  'bila',
  'perlu',
  'setiap',
  'jam',
  'malam',
  'once',
  'twice',
  'thrice',
  'daily',
  'times',
  'time',
  'every',
  'hour',
  'hours',
  'night',
  'food',
  'meal',
  'meals',
  'before',
  'after',
  'with',
  'for',
  'take',
  'needed',
  'required',
  'when',
  'oral',
  'orally',
  'mouth',
  'topical',
  'topically',
  'inhaled',
  'nasal',
  'spray',
  'puff',
  'puffs',
])
