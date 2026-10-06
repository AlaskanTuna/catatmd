import type { PrescriptionLine } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { parsePrescriptionLines } from './lines.js'

/**
 * Cutting a dictation into lines (D-001, amended 06/10/26).
 *
 * The safety argument is in three directions. A dose must stay with the drug
 * it was said beside. A dosed line with no recognised name must surface as its
 * own line rather than vanish into a neighbour. And a shared clause may fill
 * every field except the dose.
 */

const URTI = 'adult-acute-urti' as const

const read = (text: string) =>
  parsePrescriptionLines(text, URTI).map((line: PrescriptionLine) => ({
    text: text.slice(line.start, line.end),
    drug: line.candidates[0]?.lexiconId ?? null,
    exact: line.exact,
    sig: line.sig,
    shared: line.shared.map(({ field }) => field),
  }))

describe('parsePrescriptionLines', () => {
  it('reads the dictation that found only two drugs', () => {
    const lines = read(
      'Amoxicillin 500 mg, paracetamol 350 mg, antibiotic 200 mg, all of them 2 times a day.',
    )

    expect(lines.map(({ text }) => text)).toEqual([
      'Amoxicillin 500 mg',
      'paracetamol 350 mg',
      'antibiotic 200 mg',
    ])
    expect(lines.map(({ drug }) => drug)).toEqual(['amoxicillin', 'paracetamol', null])
    expect(lines.map(({ sig }) => sig.dose)).toEqual(['500 mg', '350 mg', '200 mg'])
    // "all of them" reaches every line, the unnamed one included.
    expect(lines.every(({ sig }) => sig.frequency === 'twice-daily')).toBe(true)
    expect(lines.every(({ shared }) => shared.join() === 'frequency')).toBe(true)
  })

  it('never shares a dose, and never drops one', () => {
    const lines = read('amoxicillin, paracetamol 1 g, all of them 500 mg')

    expect(lines.map(({ drug }) => drug)).toEqual(['amoxicillin', 'paracetamol', null])
    expect(lines[0]?.sig.dose).toBeNull()
    expect(lines[2]).toMatchObject({ text: 'all of them 500 mg', sig: { dose: '500 mg' } })
  })

  it("keeps a line's own field over a shared one", () => {
    const lines = read('amoxicillin 500 mg three times a day, cetirizine 10 mg, both for 5 days')

    expect(lines[0]?.sig).toMatchObject({ frequency: 'three-times-daily', duration: '5 days' })
    expect(lines[0]?.shared).toEqual(['duration'])
    expect(lines[1]?.sig.frequency).toBeNull()
  })

  it('shares in Malay as well as English', () => {
    const lines = read(
      'paracetamol 500 mg dua kali sehari, cetirizine 10 mg, semua selama lima hari',
    )

    expect(lines.map(({ sig }) => sig.duration)).toEqual(['5 days', '5 days'])
    expect(lines[1]?.sig.frequency).toBeNull()
  })

  it('does not read "both nostrils" as speaking for every line', () => {
    const lines = read('cetirizine 10 mg at night, salbutamol 2 puffs in both nostrils twice daily')

    expect(lines[0]?.sig.frequency).toBe('at-night')
    expect(lines.flatMap(({ shared }) => shared)).toEqual([])
  })

  it('carries the sig across commas to the drug it follows', () => {
    const [line, ...rest] = read('amoxicillin, 500 mg three times a day, after food, for five days')

    expect(rest).toEqual([])
    expect(line?.sig).toEqual({
      dose: '500 mg',
      route: null,
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
    })
  })

  it('reads a dose said before the name', () => {
    expect(read('500 mg of amoxicillin three times a day')[0]).toMatchObject({
      drug: 'amoxicillin',
      sig: { dose: '500 mg' },
    })
  })

  it('splits on "and" when it joins two dosed lines', () => {
    expect(read('paracetamol 350 mg and antibiotic 200 mg').map(({ text }) => text)).toEqual([
      'paracetamol 350 mg',
      'antibiotic 200 mg',
    ])
  })

  it('never gives a dose to a drug that a different name was said before', () => {
    // Keeping "Panadol 1 g" on amoxicillin's line would record 1 g amoxicillin.
    const lines = read('Panadol 1 g amoxicillin 500 mg')

    expect(lines).toMatchObject([
      { text: 'Panadol 1 g', drug: null, sig: { dose: '1 g' } },
      { text: 'amoxicillin 500 mg', drug: 'amoxicillin', sig: { dose: '500 mg' } },
    ])
    // The matcher also reads "g amoxicillin" as the combination. A unit is not
    // another word, so the name heard as written is still exact.
    expect(lines[1]?.exact).toBe(true)
  })

  it('starts a new line when a sig repeats fields the line already has', () => {
    const lines = read('amoxicillin 500 mg three times a day, Panadol, four times a day')

    expect(lines).toMatchObject([
      { text: 'amoxicillin 500 mg three times a day', sig: { frequency: 'three-times-daily' } },
      { text: 'Panadol, four times a day', drug: null, sig: { frequency: 'four-times-daily' } },
    ])
  })

  it('reads the #369 dictation into two lines, the brand left for the doctor to name', () => {
    const lines = read(
      'Dextromethorphan: dose 15 mg oral, wrote. 3 times daily when required for cough, ' +
        'preferably after food for 5 days. Strepsils lozenge: dose 1 lozenge, oral, every 3 to 4 ' +
        'days when required for sore throat, with or without food for 3 days. No antibiotics for now.',
    )

    expect(lines.map(({ drug }) => drug)).toEqual(['dextromethorphan', null])
    expect(lines[0]?.sig).toEqual({
      dose: '15 mg',
      route: 'oral',
      frequency: 'when-required',
      duration: '5 days',
      food: 'after',
    })
    expect(lines[1]?.text.startsWith('Strepsils lozenge')).toBe(true)
  })

  it('does not read "as needed" beside a schedule as a second drug', () => {
    expect(read('paracetamol 1 g, four times a day, as needed')).toHaveLength(1)
  })

  it('does not mistake an indication for a drug name', () => {
    const lines = read('paracetamol 1 g, as needed for fever')

    expect(lines).toHaveLength(1)
    expect(lines[0]?.sig.frequency).toBe('when-required')
  })

  it('treats the same drug said again before a dose as a self-correction', () => {
    const lines = read('amoxicillin, sorry, amoxicillin 500 mg')

    expect(lines).toHaveLength(1)
    expect(lines[0]?.sig.dose).toBe('500 mg')
  })

  it('ignores an opening with no sig in it', () => {
    expect(read('Okay, prescription. Amoxicillin 500 mg tds.').map(({ text }) => text)).toEqual([
      'Amoxicillin 500 mg tds',
    ])
  })

  it('does not split a drug name on a joining word inside it', () => {
    const [line] = parsePrescriptionLines(
      'amoxicillin and clavulanic acid 625 mg twice a day',
      URTI,
    )

    expect(line?.candidates.map(({ lexiconId }) => lexiconId)).toContain('amoxicillin-clavulanate')
    expect(line?.sig.dose).toBe('625 mg')
  })
})

describe('a dose never reaches the wrong drug (clinical review, 06/10/26)', () => {
  it('gives a dose to the name said just before it, not to the drug before that', () => {
    expect(read('Paracetamol, Brufen, 400 mg three times a day')).toMatchObject([
      { text: 'Paracetamol', drug: 'paracetamol', sig: { dose: null } },
      { text: 'Brufen, 400 mg three times a day', drug: null, sig: { dose: '400 mg' } },
    ])
  })

  it('never merges a look-alike into the drug before it as a self-correction', () => {
    const lines = read('Cefuroxime, cefixime 200 mg twice a day')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ drug: 'cefuroxime', sig: { dose: null } })
    expect(lines[1]).toMatchObject({ exact: false, sig: { dose: '200 mg' } })
  })

  it('ticks neither drug when two are said in one breath', () => {
    const lines = read('amoxicillin three times a day 1 g paracetamol')

    expect(lines.map(({ drug }) => drug)).toEqual(['amoxicillin', 'paracetamol'])
    expect(lines.map(({ exact }) => exact)).toEqual([false, false])
  })

  it('keeps a spray counted in puffs off the dosed drug before it', () => {
    const lines = read('Cetirizine 10 mg, nasal spray two puffs, both nostrils twice daily')

    expect(lines[0]).toMatchObject({ text: 'Cetirizine 10 mg', sig: { frequency: null } })
    expect(lines[1]).toMatchObject({ drug: null, sig: { frequency: 'twice-daily' } })
    expect(lines.flatMap(({ shared }) => shared)).toEqual([])
  })

  it("keeps a named product's sig with the product", () => {
    const lines = read(
      'Dextromethorphan 10 ml three times a day, Strepsils lozenge, oral, every 4 hours',
    )

    expect(lines[0]).toMatchObject({ sig: { route: null } })
    expect(lines[1]?.text).toBe('Strepsils lozenge, oral, every 4 hours')
  })

  it('still gives puffs to an inhaler named without a dose', () => {
    expect(read('salbutamol, 2 puffs four times a day')).toHaveLength(1)
  })
})

describe('exact', () => {
  it('holds for a name heard as written', () => {
    expect(read('cetirizine 10 mg')[0]?.exact).toBe(true)
  })

  it('never holds for a near-match', () => {
    expect(read('sefuroxeem 250 mg twice a day')[0]).toMatchObject({
      drug: 'cefuroxime',
      exact: false,
    })
  })

  it('never holds for a single agent inside a combination also heard', () => {
    // The #311 finding: plain amoxicillin outranking the combination said.
    expect(read('amoxicillin and clavulanic acid 625 mg twice a day')[0]?.exact).toBe(false)
  })

  it('never holds for a line with no name', () => {
    expect(read('Panadol 1 g four times a day')[0]).toMatchObject({ drug: null, exact: false })
  })
})

describe('candidates', () => {
  it("are the matcher's, quoted from the untouched text", () => {
    const text = 'sefuroxeem 250 mg twice a day'
    const [line] = parsePrescriptionLines(text, URTI)

    for (const candidate of line?.candidates ?? []) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.heard)
    }
  })

  it('are empty for an empty dictation', () => {
    expect(parsePrescriptionLines('', URTI)).toEqual([])
    expect(parsePrescriptionLines('   ', URTI)).toEqual([])
  })
})
