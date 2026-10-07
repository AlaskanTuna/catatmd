import type { PrescriptionLine } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { lexiconFor } from './lexicon.js'
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

  it('cuts where a look-alike reading reaches back over the boundary', () => {
    // The matcher also reads "day. Amoxicillin" as a far look-alike of
    // doxycycline. Treated as a name, that window hid the full stop, and
    // paracetamol's frequency went to amoxicillin, ticked.
    for (const stop of ['.', ',']) {
      const lines = read(`Paracetamol 1 g, 4 times a day${stop} Amoxicillin 500 mg, 3 times a day.`)

      expect(lines).toMatchObject([
        { drug: 'paracetamol', sig: { dose: '1 g', frequency: 'four-times-daily' } },
        { drug: 'amoxicillin', sig: { dose: '500 mg', frequency: 'three-times-daily' } },
      ])
      expect(lines).toHaveLength(2)
    }
  })

  it("keeps each drug's own sig whichever two drugs sit side by side", () => {
    // A look-alike reading depends on which names are adjacent, so every pair
    // is read: "day. Amoxicillin" was the one that reached back, 28 times.
    const generics = lexiconFor(URTI)
      .map(({ generic }) => generic)
      .filter((generic) => !generic.includes('-'))
    const wrong: string[] = []
    for (const first of generics) {
      for (const second of generics) {
        if (first === second) continue
        const text = `${first}, 500 mg, once a day. ${second}, 20 mg, at night.`
        const lines = read(text)
        const right =
          lines.length === 2 &&
          lines[0]?.drug === first &&
          lines[0].sig.dose === '500 mg' &&
          lines[0].sig.frequency === 'once-daily' &&
          lines[1]?.drug === second &&
          lines[1].sig.dose === '20 mg' &&
          lines[1].sig.frequency === 'at-night'
        if (!right) wrong.push(text)
      }
    }
    expect(wrong).toEqual([])
  }, 30_000)

  it('reads no name from a look-alike heard over the sig words before a boundary', () => {
    // "a day, Brufen" also reads as ibuprofen. As a name it took "a day" from
    // amoxicillin, which was left with "three times" and no frequency.
    expect(read('Amoxicillin three times a day, Brufen 400 mg')).toMatchObject([
      { text: 'Amoxicillin three times a day', drug: 'amoxicillin', exact: true },
      { text: 'Brufen 400 mg', drug: null, sig: { dose: '400 mg' } },
    ])
  })

  it('reads no name from a window of sig words alone', () => {
    // "10 mg sekali" also reads as a far look-alike of amoxicillin-clavulanate,
    // which made it a drug line and left cetirizine with no sig.
    expect(read('cetirizine 10 mg sekali sehari waktu malam')).toMatchObject([
      { drug: 'cetirizine', exact: true, sig: { dose: '10 mg', frequency: 'once-daily' } },
    ])
  })

  it('keeps a name heard in short fragments', () => {
    // Each fragment is shorter than a name, but together they read as ibuprofen.
    expect(read('Paracetamol prn, ibu pro fen 400 mg')).toMatchObject([
      { drug: 'paracetamol', sig: { dose: null } },
      { drug: 'ibuprofen', sig: { dose: '400 mg' } },
    ])
  })

  it('never gives a dose to the drug before when a name sits beside it', () => {
    // Brufen is a brand, outside the lexicon, so only the words around the dose
    // show that it is not paracetamol's.
    for (const text of [
      'Paracetamol, plus 400 mg Brufen tds',
      'Paracetamol, then 400 mg of Brufen tds',
      'Paracetamol three times a day, for 7 days Brufen 400 mg',
      'Paracetamol, after food Brufen 400 mg',
    ]) {
      const lines = read(text)

      expect(lines[0]).toMatchObject({ drug: 'paracetamol', sig: { dose: null } })
      // Unticked: unnamed, or "of Brufen" heard as a near-match of ibuprofen.
      expect(lines[1]).toMatchObject({ exact: false, sig: { dose: '400 mg' } })
    }
    // What follows the dose further on is not a name: an indication stays.
    expect(read('Paracetamol, 1 g as needed for fever')).toMatchObject([
      { drug: 'paracetamol', sig: { dose: '1 g' } },
    ])
    // Nor is a word the sig reads, beside the dose or before it.
    for (const text of [
      'Cetirizine, 10 mg nocte',
      'Cetirizine, 10 mg waktu malam',
      'Cetirizine, nocte 10 mg',
      'Paracetamol, 1 g bersama makanan',
      'Paracetamol, 1 g secara oral',
    ]) {
      expect(read(text)).toMatchObject([{ exact: true, sig: { dose: expect.any(String) } }])
      expect(read(text)).toHaveLength(1)
    }
  })

  it('holds a dose said after a joining word with no name', () => {
    for (const text of ['Paracetamol, plus 400 mg', 'Paracetamol, also 400 mg']) {
      expect(read(text)).toMatchObject([
        { drug: 'paracetamol', sig: { dose: null } },
        { drug: null, sig: { dose: '400 mg' } },
      ])
    }
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
