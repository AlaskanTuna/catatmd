import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { scanSpokenNumbers, spokenDigitRuns } from './spoken-numbers.js'

/*
 * The scanner on its own (#435, docs/trd.md §9, "Spoken Digit Runs"). What the
 * detector does with a run is pinned in `deid.test.ts`; these pin what a run is.
 */
const digitsOf = (text: string) => spokenDigitRuns(text).map((run) => run.digits)

describe('single-digit units', () => {
  it.each([
    ['zero oh o nought one two three four five six seven eight nine', '0000123456789'],
    ['kosong sifar satu dua tiga empat lima enam tujuh lapan delapan sembilan', '001234567889'],
    ['零〇一幺二三四五六七八九', '001123456789'],
  ])('reads %j', (text, digits) => {
    expect(digitsOf(text)).toEqual([digits])
    const [run] = spokenDigitRuns(text)
    expect(run?.singles).toBe(digits.length)
    expect(run?.units).toBe(digits.length)
  })

  it('reads Mandarin numerals with no space between them', () => {
    expect(digitsOf('九零零四一二')).toEqual(['900412'])
  })

  it('matches whole words, case-insensitively', () => {
    expect(digitsOf('someone tone often')).toEqual([])
    expect(digitsOf('Nine ZERO four')).toEqual(['904'])
  })

  it('reports the span of the run in the original text', () => {
    const text = 'IC is nine zero four.'
    const [run] = spokenDigitRuns(text)
    expect(text.slice(run?.start, run?.end)).toBe('nine zero four')
  })
})

describe('multi-digit units', () => {
  it.each([
    ['ten', '10'],
    ['nineteen', '19'],
    ['twenty', '20'],
    ['thirty-eight', '38'],
    ['thirty eight', '38'],
    ['sepuluh', '10'],
    ['sebelas', '11'],
    ['tiga belas', '13'],
    ['lima puluh', '50'],
    ['dua puluh lima', '25'],
    ['tiga puluh lapan', '38'],
  ])('reads %j as one unit', (text, digits) => {
    expect(spokenDigitRuns(text)).toEqual([
      expect.objectContaining({ digits, units: 1, singles: 0 }),
    ])
  })

  it('never compounds ten with a single', () => {
    expect(spokenDigitRuns('ten one')).toEqual([
      expect.objectContaining({ digits: '101', units: 2, singles: 1 }),
    ])
  })

  it('keeps a spoken fever log out of single digits', () => {
    expect(spokenDigitRuns('thirty-eight, thirty-seven, thirty-nine, thirty-eight')).toEqual([
      expect.objectContaining({ digits: '38373938', units: 4, singles: 0 }),
    ])
  })
})

describe('repeats', () => {
  it.each([
    ['double nine', '99', 2],
    ['double-nine', '99', 2],
    ['triple zero', '000', 3],
    ['dua sama', '22', 2],
    ['empat dua sama enam', '4226', 4],
  ])('reads %j', (text, digits, singles) => {
    expect(spokenDigitRuns(text)).toEqual([expect.objectContaining({ digits, singles })])
  })

  it('treats sama anywhere but directly after a single as an ordinary word', () => {
    expect(digitsOf('sama dua')).toEqual(['2'])
    expect(digitsOf('dua puluh sama')).toEqual(['20'])
    expect(digitsOf('dua, sama')).toEqual(['2'])
    expect(digitsOf('tuduwa wa sama nam')).toEqual([])
  })

  it('treats double with no single after it as an ordinary word', () => {
    expect(digitsOf('double vision')).toEqual([])
    expect(digitsOf('double twenty')).toEqual(['20'])
  })
})

describe('ASCII digits', () => {
  it('counts each ASCII digit as a single unit inside a mixed run', () => {
    expect(spokenDigitRuns('012 three four')).toEqual([
      expect.objectContaining({ digits: '01234', units: 5, singles: 5 }),
    ])
  })

  it('never reports a run made only of ASCII digits', () => {
    for (const text of ['012 345 6789', '900412086543', '500 mg', '120/80', '38.5']) {
      expect(spokenDigitRuns(text), text).toEqual([])
    }
  })
})

describe('separators and breakers', () => {
  it('joins units across one separator per gap', () => {
    expect(digitsOf('nine, zero - four / one : two – three')).toEqual(['904123'])
    expect(digitsOf('九，零、四：一')).toEqual(['9041'])
  })

  it('splits a run at a second separator in the same gap', () => {
    expect(digitsOf('nine zero, - four one')).toEqual(['90', '41'])
  })

  it.each([
    ['nine point two', ['9', '2']],
    ['satu titik lima', ['1', '5']],
    ['one hundred two', ['1', '2']],
    ['satu ratus dua', ['1', '2']],
    ['one twenty over eighty', ['120', '80']],
    ['tiga kali sehari', ['3']],
    ['三十八点五', ['3', '8', '5']],
    ['两三', ['3']],
    ['一百二', ['1', '2']],
    ['三千四', ['3', '4']],
    ['五万六', ['5', '6']],
    ['nine zero? four', ['90', '4']],
    ['nine zero! four', ['90', '4']],
    ['nine zero; four', ['90', '4']],
    ['九零？四', ['90', '4']],
    ['九零！四', ['90', '4']],
    ['九零；四', ['90', '4']],
    ['nine zero. four', ['90', '4']],
    ['九零。四', ['90', '4']],
    ['nine zero\nfour', ['90', '4']],
    ['nine zero\0four', ['90', '4']],
    ['nine zero mg four', ['90', '4']],
  ])('breaks %j', (text, runs) => {
    expect(digitsOf(text)).toEqual(runs)
  })
})

describe('progressions', () => {
  it.each([
    ['one two three four five six', true],
    ['six five four three two one', true],
    ['five six seven eight nine ten', true],
    ['satu dua tiga empat lima enam', true],
    ['one two four five six seven', false],
    ['nine zero zero four one two', false],
    ['seven', false],
  ])('%j is a progression: %s', (text, progression) => {
    expect(spokenDigitRuns(text)[0]?.progression).toBe(progression)
  })
})

describe('the clause after an identity cue', () => {
  const clauseAfter = (text: string, cue: string) => {
    const at = text.indexOf(cue) + cue.length
    const [clause] = scanSpokenNumbers(text, [at]).clauses
    return clause && { text: text.slice(clause.start, clause.end), units: clause.units }
  }

  it('skips up to three fillers before the anchor', () => {
    expect(clauseAfter('My IC number is nine zero.', 'IC')).toEqual({ text: 'nine zero', units: 2 })
    expect(clauseAfter('IC: nine zero.', 'IC')).toEqual({ text: 'nine zero', units: 2 })
    expect(clauseAfter('IC no. saya, nine zero.', 'IC')).toEqual({ text: 'nine zero', units: 2 })
    expect(clauseAfter('IC number is my nine zero.', 'IC')).toEqual({ text: 'nine zero', units: 2 })
    expect(clauseAfter('IC number is my saya nine zero.', 'IC')).toBeUndefined()
  })

  it('finds no anchor unless the next word is a number unit', () => {
    expect(clauseAfter('IC and nine zero.', 'IC')).toBeUndefined()
    expect(clauseAfter('IC sembionywarz tiga.', 'IC')).toBeUndefined()
  })

  it('takes the whole clause when it ends on a number unit, fragments included', () => {
    expect(clauseAfter('IC nine semak zero.', 'IC')).toEqual({ text: 'nine semak zero', units: 2 })
  })

  it('takes only the run at the anchor when the clause ends on a word', () => {
    expect(clauseAfter('IC two three days ago.', 'IC')).toEqual({ text: 'two three', units: 2 })
    expect(clauseAfter('IC tiga hari lagi.', 'IC')).toEqual({ text: 'tiga', units: 1 })
  })

  it('continues past a separator before a number unit, and stops at one before a word', () => {
    expect(clauseAfter('IC nine zero, zero four.', 'IC')?.text).toBe('nine zero, zero four')
    expect(clauseAfter('IC nine zero, biawak four.', 'IC')?.text).toBe('nine zero')
  })

  it.each([
    ['IC nine zero and four.', 'nine zero'],
    ['IC sembilan dua dan empat.', 'sembilan dua'],
    ['IC nine zero point four.', 'nine zero'],
    ['IC nine zero\nfour.', 'nine zero'],
    ['IC nine zero\0four.', 'nine zero'],
    ['IC nine zero. Four.', 'nine zero'],
    ['IC nine zero (four).', 'nine zero'],
  ])('ends the clause in %j', (text, clause) => {
    expect(clauseAfter(text, 'IC')?.text).toBe(clause)
  })

  it('stops sixteen words after the anchor', () => {
    const text = `IC nine ${'semak '.repeat(15)}zero four.`
    expect(clauseAfter(text, 'IC')).toEqual({ text: 'nine', units: 1 })
    const fits = `IC nine ${'semak '.repeat(13)}zero four.`
    expect(clauseAfter(fits, 'IC')?.text).toBe(fits.slice(3, -1))
  })

  it('never reports a clause made only of ASCII digits', () => {
    expect(clauseAfter('IC saya 900412086543, doktor.', 'IC')).toBeUndefined()
  })
})

describe('linear time', () => {
  it.each([
    ['a long run', 'one '.repeat(100_000)],
    ['long gaps', `one${' '.repeat(200_000)}two`],
    ['separators', 'one, '.repeat(60_000)],
    ['repeats', 'dua sama '.repeat(50_000)],
    ['compounds', 'dua puluh '.repeat(50_000)],
    ['doubles', 'double '.repeat(100_000)],
    ['Mandarin', '一'.repeat(300_000)],
    ['ordinary words', 'semak '.repeat(100_000)],
  ])('scans %s in linear time', (_shape, text) => {
    const started = performance.now()
    spokenDigitRuns(text)
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('scans a clause after every one of many cues in linear time', () => {
    const text = 'IC number is nine semak '.repeat(40_000)
    const cues = [...text.matchAll(/IC/g)].map((m) => m.index + 2)
    const started = performance.now()
    scanSpokenNumbers(text, cues)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

describe('the PHI boundary owns its own tables', () => {
  it('does not import the medication vocabulary', () => {
    // A dose-parser change must not be able to move what the gate tokenises.
    const source = readFileSync(new URL('./spoken-numbers.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*['"][^'"]*medications/)
  })
})
