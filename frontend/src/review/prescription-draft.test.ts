import type { MedicationCandidateWire, Prescription, PrescriptionLine } from '@shared/types'
import { PrescriptionSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  acceptCandidate,
  capDictation,
  EMPTY_DRAFT,
  lineKeys,
  manualRow,
  type PrescriptionDraft,
  rowsFrom,
  setDrugByHand,
  summarise,
  toConfirm,
  toPrescription,
} from './prescription-draft.js'

/**
 * The data half of dictated prescription capture (#313, #365,
 * `docs/decisions.md` D-001).
 *
 * A drug name is only ever written by the doctor; the wire shape is exact,
 * because `lexiconId` and the sig fields disagree about what "absent" means; a
 * draft is not a prescription until it has both a name and the words it came
 * from; the matcher's candidate ordering survives untouched; and one drug's sig
 * never reaches another drug.
 *
 * These are pure, the way `TranscriptCorrections.test.ts` tests `applyProposal`,
 * so none of them needs a component. The claims that are properties of the
 * markup live in `PrescriptionBlock.test.tsx` and `PrescriptionTheatre.test.tsx`.
 */

const candidate = (over: Partial<MedicationCandidateWire> = {}): MedicationCandidateWire => ({
  lexiconId: 'amoxicillin',
  generic: 'amoxicillin',
  heard: 'amoxycillin',
  start: 0,
  end: 11,
  score: 0.94,
  ...over,
})

const filled: PrescriptionDraft = {
  drug: 'amoxicillin',
  lexiconId: 'amoxicillin',
  dose: '500 mg',
  route: 'oral',
  frequency: 'three-times-daily',
  duration: '5 days',
  food: 'after',
}

const DICTATED = 'amoxycillin 500 mg, makan tiga kali sehari, lepas makan, selama lima hari'

describe('acceptCandidate', () => {
  it('takes the proposal, never what was heard', () => {
    // The whole control. `generic` and `heard` both travel precisely so the
    // doctor chooses; writing `heard` here would record the recogniser's error
    // and writing either without this call would be automatic substitution.
    const next = acceptCandidate(EMPTY_DRAFT, candidate())

    expect(next.drug).toBe('amoxicillin')
    expect(next.drug).not.toBe('amoxycillin')
  })

  it('records the lexicon id, so the provenance is visible', () => {
    expect(acceptCandidate(EMPTY_DRAFT, candidate()).lexiconId).toBe('amoxicillin')
  })

  it('leaves every parsed field alone', () => {
    const next = acceptCandidate({ ...filled, drug: '', lexiconId: undefined }, candidate())

    expect(next.dose).toBe('500 mg')
    expect(next.frequency).toBe('three-times-daily')
    expect(next.food).toBe('after')
  })

  it('does not mutate the draft it was given', () => {
    const before = { ...EMPTY_DRAFT }
    acceptCandidate(before, candidate())

    expect(before).toEqual(EMPTY_DRAFT)
  })
})

describe('setDrugByHand', () => {
  it('drops the lexicon id, because the name is no longer the lexicon match', () => {
    const next = setDrugByHand(filled, 'amoxicillin-clavulanate')

    expect(next.drug).toBe('amoxicillin-clavulanate')
    expect('lexiconId' in next).toBe(false)
  })

  it('does not mutate the draft it was given', () => {
    const before = { ...filled }
    setDrugByHand(before, 'cefuroxime')

    expect(before.lexiconId).toBe('amoxicillin')
  })
})

describe('toPrescription', () => {
  it('produces a body the shared schema accepts', () => {
    // The schema is the contract the API validates against, so parsing here is
    // what makes the two shape rules below more than an assertion about types.
    expect(PrescriptionSchema.safeParse(toPrescription(filled, DICTATED)).success).toBe(true)
  })

  it('omits lexiconId rather than sending null', () => {
    // `lexiconId` is `.optional()` and not nullable, so an explicit null is a
    // 400 rather than an absent value.
    const next = toPrescription({ ...filled, lexiconId: undefined }, DICTATED)

    expect(next).not.toBeNull()
    expect(next !== null && 'lexiconId' in next).toBe(false)
    expect(PrescriptionSchema.safeParse(next).success).toBe(true)
  })

  it('sends an explicit null for every field the parser could not read', () => {
    // The opposite rule to `lexiconId`: these keys are required and nullable,
    // so a gap the doctor left travels as a gap rather than disappearing.
    const next = toPrescription({ ...EMPTY_DRAFT, drug: 'amoxicillin' }, DICTATED)

    expect(next).toMatchObject({
      dose: null,
      route: null,
      frequency: null,
      duration: null,
      food: null,
    })
    expect(PrescriptionSchema.safeParse(next).success).toBe(true)
  })

  it('refuses a draft with no drug name', () => {
    expect(toPrescription({ ...filled, drug: '   ' }, DICTATED)).toBeNull()
  })

  it('refuses a draft with nothing dictated', () => {
    // `dictated` is the evidence the structured fields came from. Without it
    // the record would claim a derivation from words nobody has.
    expect(toPrescription(filled, '  ')).toBeNull()
  })

  it('trims what it stores', () => {
    const next = toPrescription({ ...filled, drug: ' amoxicillin ' }, ` ${DICTATED} `)

    expect(next?.drug).toBe('amoxicillin')
    expect(next?.dictated).toBe(DICTATED)
  })
})

describe('capDictation', () => {
  it('joins what was typed to what was streamed, with one space', () => {
    expect(capDictation('amoxicillin', '500 mg three times a day', 400)).toEqual({
      text: 'amoxicillin 500 mg three times a day',
      capped: false,
    })
  })

  it('leaves a streamed phrase alone when the box was empty', () => {
    expect(capDictation('', 'paracetamol 1 g', 400)).toEqual({
      text: 'paracetamol 1 g',
      capped: false,
    })
  })

  it('does not double the separator when the typed half already ends in space', () => {
    expect(capDictation('amoxicillin  ', '500 mg', 400).text).toBe('amoxicillin 500 mg')
  })

  it('cuts at a word boundary and says it capped', () => {
    const { text, capped } = capDictation('', 'amoxicillin five hundred milligrams', 20)

    expect(capped).toBe(true)
    expect(text).toBe('amoxicillin five')
    expect(text.length).toBeLessThanOrEqual(20)
  })

  it('never emits a partial word, because a half drug name is worse than a short quote', () => {
    for (let limit = 4; limit <= 40; limit += 1) {
      const { text } = capDictation('', 'amoxicillin clavulanate 625 mg twice daily', limit)
      if (text === '') continue
      // Every word kept is a word that appeared whole in the source.
      for (const word of text.split(' ')) {
        expect('amoxicillin clavulanate 625 mg twice daily'.split(' ')).toContain(word)
      }
    }
  })

  it('yields nothing rather than a fragment when the first token exceeds the budget', () => {
    // Unreachable at the real 400 character limit, and the invariant is what
    // matters: this field never shows part of a drug name.
    expect(capDictation('', 'phenoxymethylpenicillin', 8)).toEqual({ text: '', capped: true })
  })

  it('keeps what was typed when the first streamed word will not fit', () => {
    expect(capDictation('amoxicillin', 'phenoxymethylpenicillin', 14)).toEqual({
      text: 'amoxicillin',
      capped: true,
    })
  })
})

/**
 * The segmentation that gives each accepted drug its own sig (#365).
 *
 * The parse endpoint answers one sig per phrase, so a four-drug dictation
 * cannot hand back four. Reusing the whole-phrase sig would attach
 * paracetamol's 500 mg to cetirizine, which is the wrong-dose failure D-001
 * exists to prevent, so this is the function that has to be right.
 */
describe('summarise', () => {
  it('reads a draft and a stored prescription the same way', () => {
    const stored: Prescription = {
      drug: 'amoxicillin',
      dose: '500 mg',
      route: 'oral',
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
      dictated: DICTATED,
    }

    expect(summarise(filled)).toBe(summarise(stored))
  })

  it('names nothing the parser could not read, rather than guessing', () => {
    expect(summarise({ ...EMPTY_DRAFT, dose: '10 ml' })).toBe('10 ml')
    expect(summarise(EMPTY_DRAFT)).toBe('')
  })
})

const DICTATION =
  'Amoxicillin 500 mg, sefuroxeem 250 mg, antibiotic 200 mg, all of them 2 times a day.'

const sig = (over: Partial<PrescriptionLine['sig']> = {}): PrescriptionLine['sig'] => ({
  dose: null,
  route: null,
  frequency: null,
  duration: null,
  food: null,
  ...over,
})

const SHARED = { field: 'frequency' as const, start: 58, end: 83 }

const LINES: PrescriptionLine[] = [
  {
    start: 0,
    end: 18,
    candidates: [candidate({ heard: 'Amoxicillin', score: 1 })],
    exact: true,
    sig: sig({ dose: '500 mg', frequency: 'twice-daily' }),
    shared: [SHARED],
  },
  {
    start: 20,
    end: 37,
    candidates: [
      candidate({
        lexiconId: 'cefuroxime',
        generic: 'cefuroxime',
        heard: 'sefuroxeem',
        start: 20,
        end: 30,
        score: 0.8,
      }),
    ],
    exact: false,
    sig: sig({ dose: '250 mg', frequency: 'twice-daily' }),
    shared: [SHARED],
  },
  {
    start: 39,
    end: 56,
    candidates: [],
    exact: false,
    sig: sig({ dose: '200 mg', frequency: 'twice-daily' }),
    shared: [SHARED],
  },
]

describe('rowsFrom', () => {
  it('ticks an exact name and leaves a near-match for the doctor', () => {
    const rows = rowsFrom(DICTATION, LINES, new Map())

    expect(rows.map(({ kind, ticked }) => [kind, ticked])).toEqual([
      ['heard', true],
      ['heard', false],
      ['unnamed', true],
    ])
    // The near-match is offered on its row, never accepted for the doctor, and
    // it is undecided until the doctor takes it or leaves it out.
    expect(rows[1]?.draft).toMatchObject({ drug: 'cefuroxime', lexiconId: 'cefuroxime' })
    expect(rows.map(({ undecided }) => undecided)).toEqual([false, true, false])
  })

  it('proposes no drug for a line with no recognised name', () => {
    const unnamed = rowsFrom(DICTATION, LINES, new Map())[2]

    expect(unnamed?.draft.drug).toBe('')
    expect(unnamed?.draft.lexiconId).toBeUndefined()
    expect(unnamed?.draft.dose).toBe('200 mg')
  })

  it("quotes the line's own words and the shared clause it used", () => {
    expect(rowsFrom(DICTATION, LINES, new Map())[0]?.evidence).toBe(
      'Amoxicillin 500 mg … all of them 2 times a day',
    )
  })

  it("lets the doctor's edits win over the parse, and drops the shared quote they replaced", () => {
    const key = lineKeys(DICTATION, LINES)[0] as string
    const [row] = rowsFrom(
      DICTATION,
      LINES,
      new Map([[key, { fields: { frequency: 'three-times-daily' as const } }]]),
    )

    expect(row?.draft.frequency).toBe('three-times-daily')
    expect(row?.shared).toEqual([])
    expect(row?.evidence).toBe('Amoxicillin 500 mg')
  })

  it('drops the lexicon provenance when a name is typed by hand', () => {
    const key = lineKeys(DICTATION, LINES)[1] as string
    const row = rowsFrom(DICTATION, LINES, new Map([[key, { drug: 'cefalexin' }]]))[1]

    expect(row?.draft.drug).toBe('cefalexin')
    expect(row?.draft.lexiconId).toBeUndefined()
  })
})

describe('lineKeys', () => {
  it('survives a correction earlier in the text moving every offset', () => {
    const before = lineKeys(DICTATION, LINES)
    const shifted = LINES.map((line) => ({ ...line, start: line.start + 6, end: line.end + 6 }))

    expect(lineKeys(`Okay. ${DICTATION}`, shifted)).toEqual(before)
  })

  it('keeps two keys for a drug said twice', () => {
    const twice = [LINES[0], LINES[0]] as PrescriptionLine[]
    expect(new Set(lineKeys(DICTATION, twice)).size).toBe(2)
  })
})

describe('toConfirm', () => {
  it('saves ticked rows only, and counts what still holds Confirm', () => {
    const rows = rowsFrom(DICTATION, LINES, new Map())
    const { ready, unnamed, undecided } = toConfirm(rows)

    expect(ready.map(({ drug }) => drug)).toEqual(['amoxicillin'])
    expect(unnamed).toBe(1)
    expect(undecided).toBe(1)
  })

  it('decides a near-match by a tick, a typed name or leaving it out', () => {
    const key = lineKeys(DICTATION, LINES)[1] as string
    for (const edit of [{ ticked: true }, { ticked: false }, { drug: 'cefalexin' }]) {
      expect(toConfirm(rowsFrom(DICTATION, LINES, new Map([[key, edit]]))).undecided).toBe(0)
    }
  })

  it('releases Confirm once the unnamed line is named or unticked', () => {
    const keys = lineKeys(DICTATION, LINES)
    const named = toConfirm(
      rowsFrom(DICTATION, LINES, new Map([[keys[2] as string, { drug: 'azithromycin' }]])),
    )
    const unticked = toConfirm(
      rowsFrom(DICTATION, LINES, new Map([[keys[2] as string, { ticked: false }]])),
    )

    expect(named.unnamed).toBe(0)
    expect(named.ready.map(({ drug }) => drug)).toEqual(['amoxicillin', 'azithromycin'])
    expect(unticked).toMatchObject({ unnamed: 0 })
  })

  it('never shares a dose through a shared clause', () => {
    const rows = rowsFrom(DICTATION, LINES, new Map())
    expect(rows.flatMap(({ shared }) => shared.map(({ field }) => field))).not.toContain('dose')
  })

  it('counts a manual row with no name yet', () => {
    expect(toConfirm([manualRow('manual-1', DICTATION)])).toMatchObject({ ready: [], unnamed: 1 })
  })

  it('produces prescriptions the wire schema accepts', () => {
    const { ready } = toConfirm(rowsFrom(DICTATION, LINES, new Map()))
    for (const prescription of ready) {
      expect(PrescriptionSchema.safeParse(prescription).success).toBe(true)
    }
  })
})
