import {
  MAX_PRESCRIPTIONS,
  type MedicationCandidateWire,
  type Prescription,
  PrescriptionSchema,
} from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptCandidate,
  candidateKey,
  EMPTY_DRAFT,
  PrescriptionBlock,
  type PrescriptionDraft,
  setDrugByHand,
  toPrescription,
  visibleCandidates,
} from './PrescriptionBlock.js'

/**
 * The four properties that carry dictated prescription capture in the UI
 * (#313, `docs/decisions.md` D-001).
 *
 * A drug name is only ever written by the doctor; the wire shape is exact,
 * because `lexiconId` and the sig fields disagree about what "absent" means;
 * a draft is not a prescription until it has both a name and the words it came
 * from; and the matcher's candidate ordering survives the component untouched.
 *
 * The transformations are tested pure, the way `TranscriptCorrections.test.ts`
 * tests `applyProposal`. The render block below exists for the one claim a pure
 * test structurally cannot make: that the component does not pre-fill the drug
 * field. "Starts empty" is a property of the markup, so only a render can
 * witness it, and it is the property the whole feature rests on.
 */

const mocks = vi.hoisted(() => ({ parsePrescription: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: { parsePrescription: mocks.parsePrescription } }))

const useDemoTour = vi.hoisted(() => vi.fn())
vi.mock('../demo/DemoTour.js', () => ({ useDemoTour }))

afterEach(cleanup)

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

const STORED: Prescription = {
  drug: 'paracetamol',
  dose: '1 g',
  route: 'oral',
  frequency: 'four-times-daily',
  duration: '3 days',
  food: null,
  dictated: 'paracetamol 1 g qid for three days',
}

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

const setCores = (cores: number) =>
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true })

const renderBlock = ({
  prescriptions = null,
  status = 'awaiting_review',
}: {
  prescriptions?: Prescription[] | null
  status?: 'awaiting_review' | 'approved'
} = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrescriptionBlock
        consultationId="consultation-1"
        prescriptions={prescriptions}
        status={status}
        onSave={onSave}
      />
    </QueryClientProvider>,
  )
  return onSave
}

const getToggle = () => screen.getByRole('button', { name: /prescriptions/i })

const expand = () => {
  const toggle = getToggle()
  if (toggle.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(toggle)
  }
}

/** Type a phrase and press Check, then wait for the parse to land. */
const check = async (phrase: string) => {
  expand()
  fireEvent.change(screen.getByLabelText('What You Prescribed'), { target: { value: phrase } })
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalled())
}

describe('PrescriptionBlock', () => {
  beforeEach(() => {
    mocks.parsePrescription.mockReset()
    useDemoTour.mockReturnValue({ active: false, currentStep: -1, steps: [] })
    // Above the floor by default, so the microphone is on offer. The floor's
    // own behaviour gets its own test below.
    setCores(8)
  })

  it('leaves the drug name empty after a parse that named a candidate', async () => {
    /*
     * The property the whole feature rests on, and the one a pure test cannot
     * witness. `docs/decisions.md` D-001 puts automatic substitution of a drug
     * name outside the boundary: the candidate is offered, and the doctor
     * accepts it. A field arriving pre-filled would be that substitution behind
     * one confirmation.
     */
    mocks.parsePrescription.mockResolvedValue({
      sig: {
        dose: '500 mg',
        route: null,
        frequency: 'three-times-daily',
        duration: '5 days',
        food: 'after',
      },
      candidates: [candidate()],
    })
    renderBlock()

    await check(DICTATED)

    // The parser's own fields did seed, so this is not just an inert screen.
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Dose').value).toBe('500 mg'),
    )
    expect(screen.getByLabelText<HTMLInputElement>('Drug').value).toBe('')
    // And the proposal is on offer rather than applied.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('fills the drug name only when the doctor accepts, and with the generic', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: { dose: null, route: null, frequency: null, duration: null, food: null },
      candidates: [candidate()],
    })
    renderBlock()
    await check(DICTATED)

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(screen.getByLabelText<HTMLInputElement>('Drug').value).toBe('amoxicillin')
  })

  it('renders candidates in the order the API returned them', async () => {
    // The #311 wrong-drug case end to end: the combination is returned first
    // despite the lower score, and must still be read first.
    mocks.parsePrescription.mockResolvedValue({
      sig: { dose: null, route: null, frequency: null, duration: null, food: null },
      candidates: [
        candidate({
          lexiconId: 'amoxicillin-clavulanate',
          generic: 'amoxicillin-clavulanate',
          score: 0.88,
        }),
        candidate({ score: 0.96 }),
      ],
    })
    renderBlock()
    await check(DICTATED)

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('amoxicillin-clavulanate')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('amoxicillin')).toBeTruthy()
  })

  it('rejecting a candidate writes nothing and just stops offering it', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: { dose: null, route: null, frequency: null, duration: null, food: null },
      candidates: [candidate()],
    })
    const onSave = renderBlock()
    await check(DICTATED)

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))

    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Drug').value).toBe('')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('confirms the whole list rather than a delta', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: {
        dose: '500 mg',
        route: null,
        frequency: 'three-times-daily',
        duration: '5 days',
        food: 'after',
      },
      candidates: [candidate()],
    })
    const onSave = renderBlock({ prescriptions: [STORED] })
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Prescription' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const sent = onSave.mock.calls[0]?.[0] as Prescription[]
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(STORED)
    expect(sent[1]).toMatchObject({
      drug: 'amoxicillin',
      lexiconId: 'amoxicillin',
      dose: '500 mg',
      route: null,
      dictated: DICTATED,
    })
  })

  it('removes by sending the list that remains', async () => {
    const onSave = renderBlock({ prescriptions: [STORED] })

    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Remove paracetamol' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]))
  })

  it('announces the run in a live region that is present before it has anything to say', () => {
    // A live region added to the DOM alongside its first content is the shape
    // screen readers miss, so it is mounted empty rather than conditionally.
    renderBlock()

    expand()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('offers no microphone below the hardware floor, and still takes typing', () => {
    // The degrade this feature promises: down to typing, never out to a hosted
    // engine. Nothing here may offer the relay or the socket.
    setCores(2)
    renderBlock()

    expand()
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    expect(screen.getByLabelText('What You Prescribed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy()
  })

  it('offers nothing to edit once the note is approved', () => {
    // `prescriptions` is refused by the PATCH gate past `awaiting_review`, so a
    // control here would be one that cannot work.
    renderBlock({ prescriptions: [STORED], status: 'approved' })

    expand()
    expect(screen.getByText('paracetamol')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove paracetamol' })).toBeNull()
  })

  it('renders nothing at all on an approved note that recorded none', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PrescriptionBlock
          consultationId="consultation-1"
          prescriptions={null}
          status="approved"
          onSave={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(container.textContent).toBe('')
  })

  it('shows the plain count for one prescription', () => {
    renderBlock({ prescriptions: [STORED] })

    expect(screen.getByText('1 prescription')).toBeTruthy()
  })

  it('shows the plain count for several prescriptions', () => {
    const second: Prescription = { ...STORED, drug: 'ibuprofen', dictated: 'ibuprofen 200 mg tds' }
    renderBlock({ prescriptions: [STORED, second] })

    expect(screen.getByText('2 prescriptions')).toBeTruthy()
  })

  it('shows the cap only when the limit is reached', () => {
    const atCap = Array.from({ length: MAX_PRESCRIPTIONS }, (_, index) => ({
      ...STORED,
      drug: `med-${index}`,
      dictated: `med-${index} 1 g daily`,
    }))
    renderBlock({ prescriptions: atCap })

    expect(
      screen.getByText(`${MAX_PRESCRIPTIONS} of ${MAX_PRESCRIPTIONS}, limit reached`),
    ).toBeTruthy()
  })

  it('is collapsed by default and the count stays visible', () => {
    renderBlock({ prescriptions: [STORED] })

    const toggle = getToggle()
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('1 prescription')).toBeTruthy()
    expect(body).toBeTruthy()
    expect(body?.classList.contains('hidden')).toBe(true)
  })

  it('toggles the body open and closed', () => {
    renderBlock({ prescriptions: [STORED] })

    const toggle = getToggle()
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body?.classList.contains('hidden')).toBe(true)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(body?.classList.contains('hidden')).toBe(false)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body?.classList.contains('hidden')).toBe(true)
  })

  it('marks the body to expand in print', () => {
    renderBlock({ prescriptions: [STORED] })

    const toggle = getToggle()
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')

    expect(body?.getAttribute('data-print')).toBe('block')
  })

  it('defaults open when the Prescriptions tour step is current', () => {
    useDemoTour.mockReturnValue({
      active: true,
      currentStep: 0,
      steps: [{ target: '[data-tour="prescription"]' }],
    })

    renderBlock({ prescriptions: [STORED] })

    const toggle = getToggle()
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(body?.classList.contains('hidden')).toBe(false)
    expect(screen.getByText('paracetamol')).toBeTruthy()
  })
})
