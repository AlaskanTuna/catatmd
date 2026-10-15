/**
 * Number words, read as the digits they spell (#435, docs/trd.md §9, "Spoken
 * Digit Runs").
 *
 * Every other number detector reads ASCII digits, and batch transcription
 * writes an identifier the way it was said: "sembilan zero empat tujuh dua dua
 * sama enam". This module turns such text into runs of digits, with enough
 * about each run for `detectSpokenNumbers` to decide whether it is an
 * identifier. It decides nothing itself.
 *
 * **The tables are this module's own, not `SPOKEN_NUMERALS` in
 * `medications/vocabulary.ts`.** That list is tuned for reading a dose, and a
 * change made for the dose parser must not be able to move what the PHI
 * boundary tokenises.
 *
 * **The scan is linear in the input.** One tokenising pass with a regex that
 * cannot backtrack across it, one pass building units, one building runs, and
 * a clause scan bounded at `CLAUSE_WORDS` per cue. `detect()` as a whole is not
 * linear in the number of matches, because `resolveOverlaps` is not.
 */

const SINGLES = new Map<string, number>([
  ['zero', 0],
  ['oh', 0],
  ['o', 0],
  ['nought', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['kosong', 0],
  ['sifar', 0],
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
  ['零', 0],
  ['〇', 0],
  ['一', 1],
  ['幺', 1],
  ['二', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
])

const ENGLISH_TEENS = new Map<string, number>([
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
])

const ENGLISH_TENS = new Map<string, number>([
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
])

const ENGLISH_ONES = new Map<string, number>(
  ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].map((w, i) => [
    w,
    i + 1,
  ]),
)

const MALAY_TEENS = new Map<string, number>([
  ['sepuluh', 10],
  ['sebelas', 11],
])

const MALAY_ONES = new Map<string, number>([
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
])

/** What may take `belas` or `puluh` after it: two to nine. */
const MALAY_MULTIPLIERS = new Map([...MALAY_ONES].filter(([, value]) => value >= 2))

const REPEATS = new Map<string, number>([
  ['double', 2],
  ['triple', 3],
])

/**
 * Words and characters that never sit inside a spoken identifier, and that a
 * decimal, a quantity or a reading is built from. Any non-unit ends a run; these
 * also end the clause after an identity cue, where other words do not.
 */
const BREAKERS = new Set([
  'point',
  'titik',
  'hundred',
  'ratus',
  'over',
  'kali',
  '两',
  '十',
  '百',
  '千',
  '万',
  '点',
])

/** At most one of these may sit in the gap between two units. */
const SEPARATORS = new Set([',', '-', '–', '/', ':', '，', '：', '、'])

/** A hesitation inside a reading is a pause, and counts as its gap's one separator. */
const HESITATIONS = new Set(['uh', 'um', 'umm', 'er', 'erm', 'ah', 'eh'])

/** Words that may sit between an identity cue and the reading it introduces. */
const FILLERS = new Set([
  'number',
  'no',
  'nombor',
  'card',
  'kad',
  'is',
  'was',
  "it's",
  'its',
  'my',
  'saya',
  'dia',
  'ialah',
  'adalah',
  'ni',
  'ini',
  'punya',
])
const MAX_FILLERS = 3

/** Words that open a new clause, so a reading cannot run on into it. */
const OPENERS = new Set([
  'and',
  'but',
  'so',
  'then',
  'also',
  'dan',
  'tapi',
  'tetapi',
  'lepas',
  'lagi',
  'sebab',
  'kerana',
  'juga',
])

/** How many words after its anchor a cued clause may reach. */
const CLAUSE_WORDS = 16

const HAN = '\\p{Script=Han}'
const LETTER = `(?:(?!${HAN})[\\p{L}\\p{M}])`
/*
 * A Han character, an ASCII digit group, a word of letters (an apostrophe may
 * join two runs of them, so "it's" is one word), or any other single
 * non-space character. Newlines are kept as tokens, because a line break ends
 * a run. Each alternative consumes what it matches with no overlap between
 * them, so the expression cannot backtrack across the input.
 */
const TOKEN = new RegExp(
  `(${HAN})|([0-9]+)|(${LETTER}+(?:['’]${LETTER}+)*)|([\\n\\r]|[^\\s])`,
  'gu',
)

type TokenKind = 'han' | 'digits' | 'word' | 'separator' | 'mark'

interface Token {
  readonly kind: TokenKind
  /** Lower-cased, with a curly apostrophe made straight. */
  readonly text: string
  readonly start: number
  readonly end: number
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = []
  for (const m of text.matchAll(TOKEN)) {
    const [whole, han, digits, word] = m
    const pause = word !== undefined && HESITATIONS.has(word.toLowerCase())
    const kind: TokenKind = han
      ? 'han'
      : digits
        ? 'digits'
        : word && !pause
          ? 'word'
          : pause || SEPARATORS.has(whole)
            ? 'separator'
            : 'mark'
    const normal = kind === 'word' ? whole.toLowerCase().replace(/’/g, "'") : whole
    tokens.push({ kind, text: normal, start: m.index, end: m.index + whole.length })
  }
  return tokens
}

interface Unit {
  /** Each unit's digits, in order: `['38']` for "thirty-eight", `['9', '9']` for "double nine". */
  readonly digits: readonly string[]
  /** False only for an ASCII digit group. */
  readonly spoken: boolean
  /** How many words it was said in, for the clause bound. */
  readonly words: number
  /** Index of the first token after it. */
  readonly next: number
}

interface Item {
  readonly start: number
  readonly end: number
  readonly token: Token
  readonly unit?: Unit
}

const isSingle = (digits: string) => digits.length === 1

function singleAt(token: Token | undefined): string | undefined {
  if (!token) return undefined
  if (token.kind === 'digits') return isSingle(token.text) ? token.text : undefined
  if (token.kind !== 'word' && token.kind !== 'han') return undefined
  return SINGLES.get(token.text)?.toString()
}

/** The token after `i`, across whitespace or one hyphen, as a compound is said. */
const joined = (tokens: readonly Token[], i: number) =>
  tokens[i + 1]?.text === '-' ? i + 2 : i + 1

const spokenUnit = (digits: number[], words: number, next: number): Unit => ({
  digits: digits.map(String),
  spoken: true,
  words,
  next,
})

/**
 * An ASCII digit group is one unit whatever its length, so "38, 39, 38" is
 * three readings and never nine single digits. A group written against a letter
 * is part of a word, as in SpO2 or B12, and is no unit at all.
 */
function digitGroupAt(tokens: readonly Token[], i: number, token: Token): Unit | undefined {
  const before = tokens[i - 1]
  const after = tokens[i + 1]
  if (before?.kind === 'word' && before.end === token.start) return undefined
  if (after?.kind === 'word' && after.start === token.end) return undefined
  return { digits: [token.text], spoken: false, words: 1, next: i + 1 }
}

function unitAt(tokens: readonly Token[], i: number, previous: Item | undefined): Unit | undefined {
  const token = tokens[i]
  if (!token) return undefined
  if (token.kind === 'digits') return digitGroupAt(tokens, i, token)
  if (token.kind === 'han') {
    const value = SINGLES.get(token.text)
    return value === undefined ? undefined : spokenUnit([value], 1, i + 1)
  }
  if (token.kind !== 'word') return undefined
  const word = token.text

  const times = REPEATS.get(word)
  if (times !== undefined) {
    const j = joined(tokens, i)
    const digit = singleAt(tokens[j])
    if (digit === undefined) return undefined
    return { digits: Array(times).fill(digit), spoken: true, words: 2, next: j + 1 }
  }

  const tens = ENGLISH_TENS.get(word)
  if (tens !== undefined) {
    // "thirty-eight" is 38, not 3 and 8, which is what keeps a spoken fever log
    // from counting as single digits. "ten one" is never a compound.
    const j = joined(tokens, i)
    const ones = tokens[j]?.kind === 'word' ? ENGLISH_ONES.get(tokens[j]?.text ?? '') : undefined
    if (ones !== undefined) return spokenUnit([tens + ones], 2, j + 1)
    return spokenUnit([tens], 1, i + 1)
  }

  const teen = ENGLISH_TEENS.get(word) ?? MALAY_TEENS.get(word)
  if (teen !== undefined) return spokenUnit([teen], 1, i + 1)

  const multiplier = MALAY_MULTIPLIERS.get(word)
  if (multiplier !== undefined) {
    const j = joined(tokens, i)
    const after = tokens[j]
    if (after?.kind === 'word' && after.text === 'belas') {
      return spokenUnit([10 + multiplier], 2, j + 1)
    }
    if (after?.kind === 'word' && after.text === 'puluh') {
      const k = joined(tokens, j)
      const ones = tokens[k]?.kind === 'word' ? MALAY_ONES.get(tokens[k]?.text ?? '') : undefined
      if (ones !== undefined) return spokenUnit([multiplier * 10 + ones], 3, k + 1)
      return spokenUnit([multiplier * 10], 2, j + 1)
    }
  }

  const single = SINGLES.get(word)
  if (single !== undefined) return spokenUnit([single], 1, i + 1)

  // "sama" ("same") repeats a single said directly before it, with nothing but
  // whitespace between. Anywhere else it is an ordinary Malay word.
  const last = previous?.unit?.digits.at(-1)
  if (word === 'sama' && previous?.unit?.next === i && last !== undefined && isSingle(last)) {
    return { digits: [last], spoken: true, words: 1, next: i + 1 }
  }
  return undefined
}

function itemise(tokens: readonly Token[]): Item[] {
  const items: Item[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] as Token
    const unit = unitAt(tokens, i, items.at(-1))
    if (unit) {
      const end = tokens[unit.next - 1]?.end ?? token.end
      items.push({ start: token.start, end, token, unit })
      i = unit.next
    } else {
      items.push({ start: token.start, end: token.end, token })
      i++
    }
  }
  return items
}

interface Counts {
  /** How many units it holds. An ASCII digit group is one unit. */
  readonly units: number
  /** How many of those are a number word, not an ASCII digit group. */
  readonly spoken: number
}

export interface SpokenDigitRun extends Counts {
  readonly start: number
  readonly end: number
  /** The digits the run spells, "9047222" for "sembilan zero empat tujuh dua dua sama". */
  readonly digits: string
  /** How many units are a single digit, zero to nine. */
  readonly singles: number
  /** How many are a number word of two digits or more, as "thirty-eight" or "sepuluh". */
  readonly compounds: number
  /** How many digits it holds that were written as ASCII digits. */
  readonly asciiDigits: number
  /** Every step +1, or every step -1, which is counting rather than an identifier. */
  readonly progression: boolean
}

export interface SpokenNumberClause extends Counts {
  readonly start: number
  readonly end: number
  /** How many ordinary words it took in on the way to its last number word. */
  readonly fragments: number
}

function isProgression(values: readonly number[]): boolean {
  if (values.length < 2) return false
  const step = (values[1] ?? 0) - (values[0] ?? 0)
  if (step !== 1 && step !== -1) return false
  return values.every((value, i) => i === 0 || value - (values[i - 1] ?? 0) === step)
}

function count(members: readonly Item[]): Counts {
  let units = 0
  let spoken = 0
  for (const { unit } of members) {
    units += unit?.digits.length ?? 0
    if (unit?.spoken) spoken += unit.digits.length
  }
  return { units, spoken }
}

function describeRun(run: readonly Item[]): SpokenDigitRun {
  const units = run.flatMap((item) => item.unit?.digits ?? [])
  const compounds = run.flatMap((item) =>
    item.unit?.spoken ? item.unit.digits.filter((digits) => !isSingle(digits)) : [],
  )
  return {
    ...count(run),
    start: run[0]?.start ?? 0,
    end: run.at(-1)?.end ?? 0,
    digits: units.join(''),
    singles: units.filter(isSingle).length,
    compounds: compounds.length,
    asciiDigits: run.reduce(
      (sum, item) => sum + (item.unit?.spoken ? 0 : item.end - item.start),
      0,
    ),
    progression: isProgression(units.map(Number)),
  }
}

const isWordLike = (item: Item) => item.token.kind === 'word' || item.token.kind === 'han'

/** An IC's length, the longest identifier read here. Past it, a separator starts something else. */
const WHOLE_DIGITS = 12

/** Two units are one reading across whitespace and at most one separator. */
const joinsAcross = (items: readonly Item[], from: number, to: number) =>
  to === from + 1 || (to === from + 2 && items[from + 1]?.token.kind === 'separator')

/**
 * Runs of units: one unit, then any number more, each separated from the last
 * by whitespace and at most one separator.
 *
 * A run holding no number word is never reported, so text whose numbers are all
 * written as digits produces nothing here and passes the gate exactly as it did
 * before this module existed.
 */
function buildRuns(items: readonly Item[]): { runs: SpokenDigitRun[]; runAt: Map<number, number> } {
  const runs: SpokenDigitRun[] = []
  const runAt = new Map<number, number>()
  let current: number[] = []

  const flush = () => {
    const members = current.map((k) => items[k] as Item)
    if (members.some((item) => item.unit?.spoken)) {
      for (const k of current) runAt.set(k, runs.length)
      runs.push(describeRun(members))
    }
    current = []
  }

  let digits = 0
  items.forEach((item, k) => {
    if (!item.unit) return
    const last = current.at(-1)
    const continues =
      last !== undefined && joinsAcross(items, last, k) && (last === k - 1 || digits < WHOLE_DIGITS)
    if (!continues) {
      flush()
      digits = 0
    }
    current.push(k)
    digits += item.unit.digits.join('').length
  })
  flush()
  return { runs, runAt }
}

function firstItemFrom(items: readonly Item[], offset: number): number {
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((items[mid]?.start ?? 0) < offset) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * The anchor after a cue: the first unit, past at most `MAX_FILLERS` filler
 * words and at most one separator in each gap. Anything else means there is
 * no anchor.
 */
function anchorAfter(items: readonly Item[], from: number): number | undefined {
  let k = from
  for (let fillers = 0; ; fillers++) {
    if (items[k]?.token.kind === 'separator') k++
    const item = items[k]
    if (!item) return undefined
    if (item.unit) return k
    if (fillers === MAX_FILLERS || item.token.kind !== 'word' || !FILLERS.has(item.token.text)) {
      return undefined
    }
    k++
    // "IC no. 9..." abbreviates rather than ends a sentence.
    const stop = items[k]
    if (item.token.text === 'no' && stop?.token.text === '.' && stop.start === item.end) k++
  }
}

/**
 * The clause from an anchor to whichever comes first: a breaker, an opener, a
 * word in `stops`, sentence punctuation, a line break or a minted token, a
 * separator not followed by a unit it joins, an ordinary word once an IC's
 * worth of digits has been read, or `CLAUSE_WORDS` words.
 *
 * Ending on a unit, the whole clause is the reading, fragments included,
 * because a garbled reading is still the identifier. Ending on a word, only
 * the run at the anchor is: running on past a comma, an opener or the end of a
 * sentence into ordinary words is how #174 masked "500 mg".
 *
 * `stops` holds the other detectors' cue words. A fragment taken into the
 * token takes its cue with it, and an address or a name that needed the cue to
 * be found would then pass in clear.
 */
function clauseFrom(
  items: readonly Item[],
  anchor: number,
  runs: readonly SpokenDigitRun[],
  runAt: ReadonlyMap<number, number>,
  stops: ReadonlySet<string>,
): SpokenNumberClause | undefined {
  let words = 0
  let last = anchor
  let digits = 0
  let fragments = 0
  let fragmentsAtLast = 0
  for (let k = anchor; k < items.length; k++) {
    const item = items[k] as Item
    if (item.token.kind === 'separator') {
      // Past an IC's worth of digits, "..., two tablets" is the next thing said.
      if (items[k + 1]?.unit && digits < WHOLE_DIGITS) continue
      break
    }
    const { unit } = item
    const size = unit?.words ?? 1
    if (words + size > CLAUSE_WORDS) break
    if (unit) {
      digits += unit.digits.join('').length
      fragmentsAtLast = fragments
    } else {
      const text = item.token.text
      if (!isWordLike(item) || BREAKERS.has(text) || OPENERS.has(text) || stops.has(text)) break
      // A whole IC already read: "pulse one oh two" after it is not more of it.
      // Short of that, a hesitation ("uh") inside a reading is.
      if (digits >= WHOLE_DIGITS) break
      fragments++
    }
    words += size
    last = k
  }

  if (items[last]?.unit) {
    const members = items.slice(anchor, last + 1)
    const counts = count(members)
    if (counts.spoken === 0) return undefined
    return {
      ...counts,
      start: items[anchor]?.start ?? 0,
      end: items[last]?.end ?? 0,
      fragments: fragmentsAtLast,
    }
  }
  const at = runs[runAt.get(anchor) ?? -1]
  return at && { start: at.start, end: at.end, units: at.units, spoken: at.spoken, fragments: 0 }
}

export interface SpokenNumberScan {
  readonly runs: SpokenDigitRun[]
  /** One per cue whose reading opens with a number word, in cue order. */
  readonly clauses: SpokenNumberClause[]
}

export interface ClauseCues {
  /** Offsets where an identity cue ends. */
  readonly cueEnds: readonly number[]
  /** Lower-cased words that end a clause, the other detectors' cues. */
  readonly stops: ReadonlySet<string>
}

/**
 * Runs of units in `text`, and the clause after each offset in `cueEnds` where
 * an identity cue ends. Neither is reported unless it holds a number word.
 */
export function scanSpokenNumbers(
  text: string,
  { cueEnds, stops }: ClauseCues = { cueEnds: [], stops: new Set() },
): SpokenNumberScan {
  const items = itemise(tokenise(text))
  const { runs, runAt } = buildRuns(items)
  const clauses: SpokenNumberClause[] = []
  for (const cueEnd of cueEnds) {
    const anchor = anchorAfter(items, firstItemFrom(items, cueEnd))
    if (anchor === undefined) continue
    const clause = clauseFrom(items, anchor, runs, runAt, stops)
    if (clause) clauses.push(clause)
  }
  return { runs, clauses }
}

export const spokenDigitRuns = (text: string): SpokenDigitRun[] => scanSpokenNumbers(text).runs
