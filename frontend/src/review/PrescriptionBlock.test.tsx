import { MAX_PRESCRIPTIONS, type Prescription } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrescriptionBlock } from './PrescriptionBlock.js'

/**
 * The card that lists what was prescribed (#313, #365).
 *
 * **It stopped being a compose surface on 10/09/26.** Dictation, drug-name
 * decisions and the sig fields moved into `PrescriptionTheatre`, and what is
 * left here is a record plus the two doors into that theatre. These tests cover
 * the record: the counts, the collapse, the empty state, removal, and the two
 * doors opening the right thing. The compose behaviour is pinned in
 * `PrescriptionTheatre.test.tsx`, and the pure transformations in
 * `prescription-draft.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  parsePrescription: vi.fn(),
  liveAsrConfig: vi.fn(),
  createLiveSession: vi.fn(),
}))
vi.mock('../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.js')>()
  return {
    ApiError: actual.ApiError,
    api: {
      parsePrescription: mocks.parsePrescription,
      liveAsrConfig: mocks.liveAsrConfig,
      createLiveSession: mocks.createLiveSession,
    },
  }
})

const useDemoTour = vi.hoisted(() => vi.fn())
vi.mock('../demo/DemoTour.js', () => ({ useDemoTour }))

afterEach(cleanup)

const STORED: Prescription = {
  drug: 'paracetamol',
  dose: '1 g',
  route: 'oral',
  frequency: 'four-times-daily',
  duration: '3 days',
  food: null,
  dictated: 'paracetamol 1 g qid for three days',
}

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
        patientName="Rahman bin Abdullah"
        onSave={onSave}
      />
    </QueryClientProvider>,
  )
  return onSave
}

const getToggle = () => screen.getByRole('button', { name: /prescriptions/i })

const expand = () => {
  const toggle = getToggle()
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
}

describe('PrescriptionBlock', () => {
  beforeEach(() => {
    mocks.parsePrescription.mockReset()
    mocks.liveAsrConfig.mockReset().mockRejectedValue(new Error('no provider here'))
    useDemoTour.mockReturnValue({ active: false, currentStep: -1, steps: [] })
  })

  it('carries no compose surface of its own', () => {
    /*
     * The whole point of #365. A dictation box, a candidate list and six sig
     * fields did not fit the 620px middle column, and a doctor pressing Accept
     * saw nothing because the field it filled was below the fold. Anything that
     * reappears here has undone that.
     */
    renderBlock({ prescriptions: [STORED] })

    expand()
    expect(screen.queryByLabelText('What You Prescribed')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByLabelText('Drug')).toBeNull()
  })

  it('offers two doors and opens the theatre through either', () => {
    renderBlock()

    expand()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('What You Prescribed')).toBeTruthy()
  })

  it('names the patient in the theatre it opens', () => {
    renderBlock()

    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Rahman bin Abdullah')).toBeTruthy()
  })

  it('says what to do rather than reporting a count of nothing', () => {
    // An empty state is a feature: it names both ways in, and says the drug
    // name stays the doctor's to accept.
    renderBlock()

    expand()
    expect(screen.getByText(/Nothing prescribed yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })

  it('removes by sending the list that remains', async () => {
    const onSave = renderBlock({ prescriptions: [STORED] })

    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Remove paracetamol' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]))
  })

  it('summarises a stored prescription with the words it came from', () => {
    renderBlock({ prescriptions: [STORED] })

    expand()
    expect(screen.getByText('paracetamol')).toBeTruthy()
    expect(screen.getByText('1 g · Oral · Four Times Daily · for 3 days')).toBeTruthy()
    expect(screen.getByText(/Dictated: paracetamol 1 g qid for three days/)).toBeTruthy()
  })

  it('offers nothing to edit once the note is approved', () => {
    // `prescriptions` is refused by the PATCH gate past `awaiting_review`, so a
    // control here would be one that cannot work.
    renderBlock({ prescriptions: [STORED], status: 'approved' })

    expand()
    expect(screen.getByText('paracetamol')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
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

  it('shows the cap and closes both doors when the limit is reached', () => {
    const atCap = Array.from({ length: MAX_PRESCRIPTIONS }, (_, index) => ({
      ...STORED,
      drug: `med-${index}`,
      dictated: `med-${index} 1 g daily`,
    }))
    renderBlock({ prescriptions: atCap })

    expand()
    expect(
      screen.getByText(`${MAX_PRESCRIPTIONS} of ${MAX_PRESCRIPTIONS}, limit reached`),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dictate' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true)
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
