import type { MedicationCandidateWire, Prescription } from '@shared/types'
import { PrescriptionSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  acceptCandidate,
  candidateKey,
  capDictation,
  EMPTY_DRAFT,
  type PrescriptionDraft,
  setDrugByHand,
  sliceForCandidate,
  summarise,
  toPrescription,
  visibleCandidates,
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

describe('visibleCandidates', () => {
  it('preserves the order the matcher returned, and never re-sorts by score', () => {
    /*
     * The clinical-safety finding on #311 in one case: a contained single agent
     * scores higher on a shorter span than the combination actually dictated.
     * The matcher's own order is the fix, so a component that sorted by score
     * would reintroduce the wrong-drug proposal at position one.
     */
    const combination = candidate({
      lexiconId: 'amoxicillin-clavulanate',
      generic: 'amoxicillin-clavulanate',
      heard: 'amoxicillin clavulanate',
      end: 23,
      score: 0.88,
    })
    const single = candidate({ score: 0.96 })

    const order = visibleCandidates([combination, single], new Set())

    expect(order.map(({ lexiconId }) => lexiconId)).toEqual([
      'amoxicillin-clavulanate',
      'amoxicillin',
    ])
  })

  it('drops only what was rejected', () => {
    const first = candidate()
    const second = candidate({ lexiconId: 'amoxapine', generic: 'amoxapine', score: 0.71 })

    const open = visibleCandidates([first, second], new Set([candidateKey(second)]))

    expect(open).toEqual([first])
  })

  it('keeps two proposals on one span apart', () => {
    // Up to three candidates share a span, so identity cannot be the offsets
    // alone or rejecting one would dismiss its neighbours.
    const first = candidate()
    const second = candidate({ lexiconId: 'amoxapine', generic: 'amoxapine' })

    expect(candidateKey(first)).not.toBe(candidateKey(second))
  })
})

/**
 * The character cap, tested pure because it is the thing that stops a session.
 *
 * `PrescriptionSchema.dictated` is `max(2000)`, and `dictated` is the evidence
 * field the doctor reads back to check the parse. Both halves matter: the text
 * has to stay whole words, and the caller has to be told, because the caller is
 * what ends the stream rather than letting it bill for words it discards.
 */
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
describe('sliceForCandidate', () => {
  const FOUR =
    'paracetamol 500 mg three times a day. cetirizine 10 mg once daily. dextromethorphan 10 ml when needed.'
  const paracetamol = candidate({
    lexiconId: 'paracetamol',
    generic: 'paracetamol',
    heard: 'paracetamol',
    start: 0,
    end: 11,
  })
  const cetirizine = candidate({
    lexiconId: 'cetirizine',
    generic: 'cetirizine',
    heard: 'cetirizine',
    start: 38,
    end: 48,
  })
  const dextromethorphan = candidate({
    lexiconId: 'dextromethorphan',
    generic: 'dextromethorphan',
    heard: 'dextromethorphan',
    start: 66,
    end: 82,
  })
  const all = [paracetamol, cetirizine, dextromethorphan]

  it('stops at the next drug name, so one drug never carries the next drug dose', () => {
    const slice = sliceForCandidate(FOUR, all, paracetamol)

    expect(slice).toBe('paracetamol 500 mg three times a day.')
    expect(slice).not.toContain('10 mg')
  })

  /*
   * The cost of starting at the name rather than at the previous drug's end,
   * stated as a test so it is a decision rather than a surprise. A dose spoken
   * before the name is lost and the field stays empty, which asks the doctor a
   * question. The alternative fills it with the previous drug's dose, which
   * answers one they never asked.
   */
  it('loses a dose stated before the name, and leaves the field empty rather than wrong', () => {
    const text = '500 mg of amoxicillin, then cetirizine'
    const amoxicillin = candidate({ start: 10, end: 21 })
    const second = candidate({
      lexiconId: 'cetirizine',
      generic: 'cetirizine',
      heard: 'cetirizine',
      start: 28,
      end: 38,
    })

    expect(sliceForCandidate(text, [amoxicillin, second], amoxicillin)).toBe('amoxicillin, then')
  })

  it('never opens with the previous drug trailing sig', () => {
    const slice = sliceForCandidate(FOUR, all, cetirizine)

    expect(slice.startsWith('cetirizine')).toBe(true)
    expect(slice).not.toContain('500 mg')
  })

  it('runs to the end for the last drug named', () => {
    expect(sliceForCandidate(FOUR, all, dextromethorphan)).toBe(
      'dextromethorphan 10 ml when needed.',
    )
  })

  it('is bounded on both sides for a drug in the middle', () => {
    expect(sliceForCandidate(FOUR, all, cetirizine)).toBe('cetirizine 10 mg once daily.')
  })

  /*
   * The matcher offers up to three candidates per span, and a combination
   * contains the single agent it is built from. An overlapping candidate must
   * bound neither side, or `amoxicillin-clavulanate` would be cut short by the
   * `amoxicillin` found inside it and lose its own dose.
   */
  it('is not cut short by a candidate overlapping its own span', () => {
    const text = 'amoxicillin-clavulanate 625 mg twice daily, then loratadine'
    const combination = candidate({
      lexiconId: 'amoxicillin-clavulanate',
      generic: 'amoxicillin-clavulanate',
      heard: 'amoxicillin clavulanate',
      start: 0,
      end: 23,
    })
    const contained = candidate({ start: 0, end: 11 })
    const later = candidate({
      lexiconId: 'loratadine',
      generic: 'loratadine',
      heard: 'loratadine',
      start: 48,
      end: 58,
    })

    expect(sliceForCandidate(text, [combination, contained, later], combination)).toBe(
      'amoxicillin-clavulanate 625 mg twice daily, then',
    )
  })

  it('returns the whole phrase when only one drug was heard', () => {
    const only = candidate()
    expect(sliceForCandidate(DICTATED, [only], only)).toBe(DICTATED)
  })
})

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
