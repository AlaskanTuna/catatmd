import type { MedicationCandidateWire, Prescription } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.js'
import { PrescriptionTheatre } from './PrescriptionTheatre.js'

/**
 * Where a prescription is dictated and assembled (#365).
 *
 * Four claims carry this surface, and each is a property of the markup that a
 * pure test structurally cannot make.
 *
 * 1. The drug name is never pre-filled. `docs/decisions.md` D-001 puts
 *    automatic substitution outside the boundary, so a candidate is offered and
 *    the doctor accepts it.
 * 2. Accepting produces something visible. The old surface filled a field below
 *    the fold and read as a dead button.
 * 3. Two drugs accepted from one dictation never share a sig, which is the
 *    wrong-dose failure the segmentation exists to prevent.
 * 4. No consent tick is asked for or claimed on this path any more, and the
 *    request that opens the socket says so.
 */

const mocks = vi.hoisted(() => ({
  parsePrescription: vi.fn(),
  liveAsrConfig: vi.fn(),
  createLiveSession: vi.fn(),
}))
/*
 * The real `ApiError`, because the config-failure copy turns on its `status`: a
 * 503 says this deployment has no key, anything else says the network did not
 * answer. A stub class would make both branches read alike.
 */
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

afterEach(cleanup)

const LIVE_CONFIG = {
  provider: 'soniox',
  region: 'us',
  websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
  config: {},
}

/** The standing preference, written the way the Audio dialog writes it. */
const writeEngine = (dictationEngine: 'local' | 'streaming') =>
  localStorage.setItem(
    'catatmd.audio',
    JSON.stringify({
      deviceId: null,
      suppressNoise: true,
      boostQuietSpeech: false,
      engine: 'local',
      dictationEngine,
    }),
  )

const setCores = (cores: number) =>
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true })

const candidate = (over: Partial<MedicationCandidateWire> = {}): MedicationCandidateWire => ({
  lexiconId: 'amoxicillin',
  generic: 'amoxicillin',
  heard: 'amoxycillin',
  start: 0,
  end: 11,
  score: 0.94,
  ...over,
})

const NO_SIG = { dose: null, route: null, frequency: null, duration: null, food: null }

const DICTATED = 'amoxycillin 500 mg, makan tiga kali sehari, lepas makan, selama lima hari'

const TWO_DRUGS = 'paracetamol 500 mg three times a day. cetirizine 10 mg once daily.'
const PARACETAMOL = candidate({
  lexiconId: 'paracetamol',
  generic: 'paracetamol',
  heard: 'paracetamol',
  start: 0,
  end: 11,
})
const CETIRIZINE = candidate({
  lexiconId: 'cetirizine',
  generic: 'cetirizine',
  heard: 'cetirizine',
  start: 38,
  end: 48,
})

const STORED: Prescription = {
  drug: 'ibuprofen',
  dose: '200 mg',
  route: 'oral',
  frequency: 'three-times-daily',
  duration: null,
  food: null,
  dictated: 'ibuprofen 200 mg tds',
}

const renderTheatre = ({
  stored = [],
  autoStart = false,
}: {
  stored?: Prescription[]
  autoStart?: boolean
} = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrescriptionTheatre
        consultationId="consultation-1"
        stored={stored}
        open
        autoStart={autoStart}
        patientName="Rahman bin Abdullah"
        onSave={onSave}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { onSave, onClose }
}

/** Type a phrase and press Check, then wait for the parse to land. */
const check = async (phrase: string) => {
  fireEvent.change(screen.getByLabelText('What You Prescribed'), { target: { value: phrase } })
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalled())
}

/** The staged list only, so a query cannot match the dictated text behind it. */
const confirming = () => screen.getByRole('list', { name: 'Prescriptions to confirm' })

/**
 * The pre-landing review on #365 found four failures that were silent: the
 * doctor saw no error and either the work vanished or the wrong thing ran.
 * Every one of them is pinned below, because a silent failure that no test
 * holds down is one that comes back without anybody noticing.
 */
describe('the silent failures found in review', () => {
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close
  // jsdom implements no `confirm`, so it is defined rather than spied on.
  const confirmSpy = vi.fn<(message?: string) => boolean>(() => true)

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
    confirmSpy.mockReset().mockReturnValue(true)
    window.confirm = confirmSpy
    /*
     * The hook opens the microphone before it mints a key, because the
     * permission prompt is the slow part and the key lives thirty seconds. With
     * no `mediaDevices` in jsdom the run fails there and never reaches the mint,
     * which is the call that tells the two engines apart from here.
     */
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      },
    })
    mocks.parsePrescription.mockReset()
    mocks.liveAsrConfig.mockReset().mockResolvedValue(LIVE_CONFIG)
    mocks.createLiveSession.mockReset().mockRejectedValue(new Error('no socket in jsdom'))
    setCores(8)
    localStorage.clear()
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
    localStorage.clear()
  })

  /*
   * The one the whole feature rested on. `streaming` is derived from a config
   * fetched asynchronously, so an autoStart that ran on the mount tick read it
   * as false and took the on-device branch, and the one-shot ref then refused
   * to retry once the config landed. Every doctor on the shipped streaming
   * default got the local model instead, with no word that it happened.
   *
   * Asserted through `createLiveSession`, because that call is the only
   * observable difference between the two engines from here.
   */
  it('waits for the engine before autoStart, rather than falling through to on-device', async () => {
    writeEngine('streaming')
    renderTheatre({ autoStart: true })

    await waitFor(() =>
      expect(mocks.createLiveSession).toHaveBeenCalledWith(expect.anything(), 'dictation'),
    )
  })

  it('says it is getting ready rather than sitting blank while the engine resolves', () => {
    writeEngine('streaming')
    renderTheatre({ autoStart: true })

    expect(screen.getByRole('status').textContent).toBe('Getting ready.')
  })

  it('starts the on-device engine immediately when that is the stored choice', async () => {
    // Nothing to wait for on this path, so the wait above must not delay it.
    writeEngine('local')
    renderTheatre({ autoStart: true })

    await waitFor(() => expect(mocks.liveAsrConfig).not.toHaveBeenCalled())
    expect(mocks.createLiveSession).not.toHaveBeenCalled()
  })

  /*
   * `dialog.close()` fires `close` and never `cancel`, so a guard wired to
   * `onCancel` caught Escape and let the header's X and the Discard button
   * wipe the staged list without asking.
   */
  it('asks before the X button discards staged prescriptions', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    const { onClose } = renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close prescription dictation' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(within(confirming()).getByText('amoxicillin')).toBeTruthy()
  })

  it('asks before Discard wipes the staged list', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(within(confirming()).getByText('amoxicillin')).toBeTruthy()
  })

  /*
   * Confirm counted only the rows that converted, so it read "Confirm 2
   * Prescriptions" beside three rows, saved two, and reset the third away.
   */
  it('refuses to confirm while a staged row has no drug name', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    const { onSave } = renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Add By Hand' }))

    const confirmButton = screen.getByRole('button', { name: /Confirm/ }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/Name every drug before confirming/)
    fireEvent.click(confirmButton)
    expect(onSave).not.toHaveBeenCalled()
  })

  /*
   * The row stays editable while its per-drug parse is in flight, and the merge
   * replaced every field. A response arriving half a second later overwrote a
   * dose the doctor had already typed, which on this field is the difference
   * between a gap and a wrong number.
   */
  it('never overwrites a dose the doctor typed while the parse was in flight', async () => {
    writeEngine('local')
    let releaseSegment: (value: unknown) => void = () => {}
    mocks.parsePrescription.mockImplementation((_id: string, dictated: string) => {
      if (dictated === DICTATED) {
        return Promise.resolve({ sig: NO_SIG, candidates: [candidate()] })
      }
      return new Promise((resolve) => {
        releaseSegment = resolve
      })
    })
    renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit prescription 1' }))
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '1 g' } })

    releaseSegment({ sig: { ...NO_SIG, dose: '500 mg' }, candidates: [] })

    await waitFor(() =>
      expect((screen.getByLabelText('Dose') as HTMLInputElement).value).toBe('1 g'),
    )
  })

  it('still fills a field the doctor left alone', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockImplementation((_id: string, dictated: string) =>
      dictated === DICTATED
        ? Promise.resolve({ sig: NO_SIG, candidates: [candidate()] })
        : Promise.resolve({ sig: { ...NO_SIG, dose: '500 mg' }, candidates: [] }),
    )
    renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(within(confirming()).getByText(/500 mg/)).toBeTruthy())
  })

  /*
   * The matcher offers a combination and the single agent inside it as separate
   * candidates. Resolving only the exact candidate left the contained one on
   * offer, so one phrase could become two prescriptions for two different
   * antibiotics.
   */
  it('stops offering a candidate contained in one already accepted', async () => {
    writeEngine('local')
    const combination = candidate({
      lexiconId: 'amoxicillin-clavulanate',
      generic: 'amoxicillin-clavulanate',
      heard: 'amoxicillin clavulanate',
      start: 0,
      end: 23,
    })
    const contained = candidate({ start: 0, end: 11 })
    mocks.parsePrescription.mockResolvedValue({
      sig: NO_SIG,
      candidates: [combination, contained],
    })
    renderTheatre()
    await check('amoxicillin clavulanate 625 mg twice daily')

    const offers = await screen.findAllByRole('button', { name: 'Accept' })
    expect(offers).toHaveLength(2)
    fireEvent.click(offers[0] as HTMLElement)

    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('hands both back when the row claiming them is removed', async () => {
    writeEngine('local')
    const combination = candidate({
      lexiconId: 'amoxicillin-clavulanate',
      generic: 'amoxicillin-clavulanate',
      heard: 'amoxicillin clavulanate',
      start: 0,
      end: 23,
    })
    const contained = candidate({ start: 0, end: 11 })
    mocks.parsePrescription.mockResolvedValue({
      sig: NO_SIG,
      candidates: [combination, contained],
    })
    renderTheatre()
    await check('amoxicillin clavulanate 625 mg twice daily')
    fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0] as HTMLElement)

    fireEvent.click(screen.getByRole('button', { name: 'Remove prescription 1' }))

    expect(await screen.findAllByRole('button', { name: 'Accept' })).toHaveLength(2)
  })

  /*
   * `parse.onError` set no state, so `parsedFrom` stayed null, so the entire
   * right column never rendered and the toast promising the fields were the
   * doctor's to fill in pointed at no fields.
   */
  it('still offers somewhere to work when the check fails', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockRejectedValue(new Error('nope'))
    renderTheatre()
    await check(DICTATED)

    expect(await screen.findByRole('button', { name: 'Add By Hand' })).toBeTruthy()
  })

  /*
   * The guard and the handler read two different sources: `disabled` fell back
   * to `parsedFrom` while the handler read the live box, so clearing the
   * textarea after a check left an enabled button that did nothing. That is the
   * dead-button failure this whole surface was rebuilt to remove.
   */
  it('disables Add By Hand when the box is cleared after a check', async () => {
    writeEngine('local')
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [] })
    renderTheatre()
    await check(DICTATED)
    expect(
      (screen.getByRole('button', { name: 'Add By Hand' }) as HTMLButtonElement).disabled,
    ).toBe(false)

    fireEvent.change(screen.getByLabelText('What You Prescribed'), { target: { value: '' } })

    expect(
      (screen.getByRole('button', { name: 'Add By Hand' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('does not claim nothing matched before anything was checked', () => {
    writeEngine('local')
    renderTheatre()
    fireEvent.change(screen.getByLabelText('What You Prescribed'), {
      target: { value: 'amoxicillin' },
    })

    expect(screen.queryByText(/No drug name in the list matched/)).toBeNull()
  })
})

describe('PrescriptionTheatre', () => {
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close

  beforeEach(() => {
    // jsdom ships `<dialog>` without these. Same stand-in
    // `ConsultationReview.test.tsx` uses.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
    mocks.parsePrescription.mockReset()
    mocks.liveAsrConfig.mockReset().mockResolvedValue(LIVE_CONFIG)
    mocks.createLiveSession.mockReset()
    setCores(8)
    localStorage.clear()
    writeEngine('local')
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
    localStorage.clear()
  })

  it('leaves the drug name unwritten after a parse that named a candidate', async () => {
    /*
     * The property the whole feature rests on. D-001 puts automatic
     * substitution of a drug name outside the boundary: the candidate is
     * offered, and the doctor accepts it. A row arriving pre-staged would be
     * that substitution behind a different control.
     */
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    renderTheatre()
    await check(DICTATED)

    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByText('Accept a drug name on the left, or add one by hand.')).toBeTruthy()
  })

  it('stages a visible row when the doctor accepts, carrying the generic', async () => {
    /*
     * The reported defect. Accept was wired and tested and did fill the Drug
     * field, but the field was below the fold in a 620px column and the
     * candidate row did not change, so the button read as dead.
     */
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    renderTheatre()
    await check(DICTATED)

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(within(confirming()).getByText('amoxicillin')).toBeTruthy()
    // And it stops being offered, because it is now a decision already made.
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('shows the stretch of text a row was read from', async () => {
    // The segmentation is a heuristic, so it shows its working: a wrong split
    // is visible on the row rather than hidden in the numbers.
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(await screen.findByText(new RegExp(`from .${DICTATED}`))).toBeTruthy()
  })

  it('gives each accepted drug its own sig, never the phrase-wide one', async () => {
    /*
     * The wrong-dose failure D-001 exists to prevent, end to end. The parse
     * endpoint answers one sig per phrase, so without the per-drug re-parse
     * paracetamol's 500 mg lands on cetirizine.
     */
    mocks.parsePrescription.mockImplementation((_id: string, dictated: string) => {
      if (dictated === TWO_DRUGS) {
        return Promise.resolve({
          sig: { ...NO_SIG, dose: '500 mg', frequency: 'three-times-daily' },
          candidates: [PARACETAMOL, CETIRIZINE],
        })
      }
      if (dictated.startsWith('paracetamol')) {
        return Promise.resolve({
          sig: { ...NO_SIG, dose: '500 mg', frequency: 'three-times-daily' },
          candidates: [],
        })
      }
      return Promise.resolve({
        sig: { ...NO_SIG, dose: '10 mg', frequency: 'once-daily' },
        candidates: [],
      })
    })
    renderTheatre()
    await check(TWO_DRUGS)

    const accepts = await screen.findAllByRole('button', { name: 'Accept' })
    fireEvent.click(accepts[0] as HTMLElement)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0] as HTMLElement)

    await waitFor(() => expect(within(confirming()).getAllByRole('listitem')).toHaveLength(2))
    const staged = within(confirming()).getAllByRole('listitem')
    const paracetamolRow = staged.find((row) => row.textContent?.includes('paracetamol'))
    const cetirizineRow = staged.find((row) => row.textContent?.includes('cetirizine'))

    await waitFor(() => expect(cetirizineRow?.textContent).toMatch(/10 mg/))
    expect(paracetamolRow?.textContent).toMatch(/500 mg/)
    expect(cetirizineRow?.textContent).not.toMatch(/500 mg/)
  })

  it('re-parses only the stretch belonging to the drug accepted', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: NO_SIG,
      candidates: [PARACETAMOL, CETIRIZINE],
    })
    renderTheatre()
    await check(TWO_DRUGS)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0] as HTMLElement)

    await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))
    expect(mocks.parsePrescription).toHaveBeenLastCalledWith(
      'consultation-1',
      'paracetamol 500 mg three times a day.',
    )
  })

  it('rejecting a candidate stages nothing and just stops offering it', async () => {
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    const { onSave } = renderTheatre()
    await check(DICTATED)

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))

    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText('Accept a drug name on the left, or add one by hand.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('puts a candidate back on offer when its row is removed', async () => {
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    renderTheatre()
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove prescription 1' }))

    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('renders candidates in the order the API returned them', async () => {
    // The #311 wrong-drug case: the combination is returned first despite the
    // lower score, and must still be read first.
    mocks.parsePrescription.mockResolvedValue({
      sig: NO_SIG,
      candidates: [
        candidate({
          lexiconId: 'amoxicillin-clavulanate',
          generic: 'amoxicillin-clavulanate',
          end: 23,
          score: 0.88,
        }),
        candidate({ score: 0.96 }),
      ],
    })
    renderTheatre()
    await check(DICTATED)

    const offered = within(
      await screen.findByRole('list', { name: 'Drug names heard' }),
    ).getAllByRole('listitem')
    expect(within(offered[0] as HTMLElement).getByText('amoxicillin-clavulanate')).toBeTruthy()
    expect(within(offered[1] as HTMLElement).getByText('amoxicillin')).toBeTruthy()
  })

  it('confirms the whole list rather than a delta, and closes', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: { ...NO_SIG, dose: '500 mg', frequency: 'three-times-daily' },
      candidates: [candidate()],
    })
    const { onSave, onClose } = renderTheatre({ stored: [STORED] })
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(within(confirming()).getByText(/500 mg/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))

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
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('counts the prescriptions on the button, so one press is one commit', async () => {
    mocks.parsePrescription.mockResolvedValue({
      sig: NO_SIG,
      candidates: [PARACETAMOL, CETIRIZINE],
    })
    renderTheatre()
    await check(TWO_DRUGS)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0] as HTMLElement)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0] as HTMLElement)

    expect(await screen.findByRole('button', { name: /Confirm 2 Prescriptions/ })).toBeTruthy()
  })

  it('keeps every row when the save fails, and says nothing was lost', async () => {
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [candidate()] })
    const onSave = vi.fn().mockRejectedValue(new Error('nope'))
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PrescriptionTheatre
          consultationId="consultation-1"
          stored={[]}
          open
          autoStart={false}
          onSave={onSave}
          onClose={onClose}
        />
      </QueryClientProvider>,
    )
    await check(DICTATED)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    // The per-drug parse has to settle first: Confirm refuses while one is in
    // flight, or the row would save with the dose still unread.
    await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))

    expect(await screen.findByText(/Nothing was lost/)).toBeTruthy()
    expect(within(confirming()).getByText('amoxicillin')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so when nothing in the lexicon matched, rather than showing an empty space', async () => {
    /*
     * Brand names are outside the lexicon by D-001, so this is the common case
     * rather than the rare one. Before #365 the block simply did not render and
     * the doctor got silence.
     */
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [] })
    renderTheatre()
    await check('Strepsils lozenges one lozenge every four hours')

    expect(await screen.findByText(/No drug name in the list matched/)).toBeTruthy()
  })

  it('takes a drug the lexicon never offered, by hand', async () => {
    mocks.parsePrescription.mockResolvedValue({ sig: NO_SIG, candidates: [] })
    const { onSave } = renderTheatre()
    await check('Strepsils lozenges one lozenge every four hours')

    fireEvent.click(await screen.findByRole('button', { name: 'Add By Hand' }))
    fireEvent.change(screen.getByLabelText('Drug'), { target: { value: 'Strepsils' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const sent = onSave.mock.calls[0]?.[0] as Prescription[]
    expect(sent[0]).toMatchObject({ drug: 'Strepsils' })
    // Typed by hand, so it claims no lexicon match.
    expect(sent[0]?.lexiconId).toBeUndefined()
  })

  /**
   * The reported bug, verbatim (#369).
   *
   * Two drugs were dictated in one breath and one was recorded. Strepsils is a
   * brand and brands are outside the lexicon by D-001, so the matcher offered a
   * single candidate; with no second candidate to bound it, the dextromethorphan
   * slice ran to the end of the text and its quote swallowed the second drug's
   * whole sig. Nothing said so, because the "nothing matched" block renders only
   * at a count of zero and the count here was one.
   */
  describe('a second drug the lexicon does not hold', () => {
    const REPORTED =
      'Dextromethorphan: dose 15 mg oral, wrote. 3 times daily when required for cough, ' +
      'preferably after food for 5 days. Strepsils lozenge: dose 1 lozenge, oral, every 3 to 4 ' +
      'days when required for sore throat, with or without food for 3 days. No antibiotics for now.'
    /** Where the sig parse stops: the end of `for 5 days`, before `Strepsils`. */
    const READ_TO = REPORTED.indexOf('for 5 days') + 'for 5 days'.length
    const DEXTRO = candidate({
      lexiconId: 'dextromethorphan',
      generic: 'dextromethorphan',
      heard: 'Dextromethorphan',
      start: 0,
      end: 16,
    })
    const DEXTRO_SIG = {
      dose: '15 mg',
      route: 'oral',
      frequency: 'when-required',
      duration: '5 days',
      food: 'after',
    }

    /** Accept the one candidate offered and wait for its own sig to land. */
    const acceptDextromethorphan = async () => {
      mocks.parsePrescription.mockResolvedValue({
        sig: DEXTRO_SIG,
        sigReadTo: READ_TO,
        candidates: [DEXTRO],
      })
      const handles = renderTheatre()
      await check(REPORTED)
      fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
      await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))
      return handles
    }

    it('stops the first row quote where its own sig stopped being read', async () => {
      await acceptDextromethorphan()

      const row = within(confirming()).getByText(/Dextromethorphan: dose 15 mg/)
      expect(row.textContent).toContain('for 5 days')
      // The defect itself: this row used to quote the second drug and the two
      // sentences after it, as evidence for fields none of that text supplied.
      expect(row.textContent).not.toContain('Strepsils')
      expect(row.textContent).not.toContain('No antibiotics')
    })

    it('offers the stretch no row claims, quoted and unnamed', async () => {
      await acceptDextromethorphan()

      const left = await screen.findByRole('list', { name: 'Not claimed by any row' })
      expect(within(left).getByText(/Strepsils lozenge/)).toBeTruthy()
      // Quoted, never read as a drug. Naming it would be the substitution D-001
      // bans, and the reason it is unclaimed is that no name was recognised.
      expect(within(left).queryByText('Strepsils', { exact: true })).toBeNull()
    })

    it('stages that stretch as its own row, with the sig read from it alone', async () => {
      await acceptDextromethorphan()
      fireEvent.click(await screen.findByRole('button', { name: 'Add As A Prescription' }))

      await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(3))
      const sent = mocks.parsePrescription.mock.calls[2]?.[1] as string
      expect(sent.startsWith('Strepsils lozenge')).toBe(true)
      expect(sent).not.toContain('Dextromethorphan')
      expect(within(confirming()).getAllByRole('listitem')).toHaveLength(2)
    })

    it('names no drug on the row it stages, so the doctor types it', async () => {
      // The row opens on an empty Drug field. Reading a name out of unmatched
      // text is exactly the look-alike substitution the lexicon refuses to do.
      await acceptDextromethorphan()
      fireEvent.click(await screen.findByRole('button', { name: 'Add As A Prescription' }))

      expect((await screen.findByLabelText('Drug')).getAttribute('value')).toBe('')
      expect(within(confirming()).getByText('Name this drug')).toBeTruthy()
    })

    it('sets a stretch aside on Dismiss, so the block does not become wallpaper', async () => {
      // A dictation almost always ends on something that is not a drug, so a
      // remainder that cannot be cleared would be on screen every time and
      // would stop being read. Dismissing is the same act as rejecting.
      await acceptDextromethorphan()
      fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

      await waitFor(() =>
        expect(screen.queryByRole('list', { name: 'Not claimed by any row' })).toBeNull(),
      )
    })

    it('hands the stretch back when the row claiming it is removed', async () => {
      await acceptDextromethorphan()
      expect(await screen.findByRole('list', { name: 'Not claimed by any row' })).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Remove prescription 1' }))

      // Releasing a source span mirrors how removing a row hands its candidates
      // back, so nothing is stranded by a decision the doctor undid.
      await waitFor(() =>
        expect(screen.queryByRole('list', { name: 'Not claimed by any row' })).toBeNull(),
      )
    })

    it('offers nothing while one row still accounts for every character', async () => {
      // Why the quote has to narrow first. A parse reporting no offset leaves
      // the claim as wide as it was, which is the state that had no remainder.
      mocks.parsePrescription.mockResolvedValue({
        sig: DEXTRO_SIG,
        sigReadTo: null,
        candidates: [DEXTRO],
      })
      renderTheatre()
      await check(REPORTED)
      fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
      await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))

      expect(screen.queryByRole('list', { name: 'Not claimed by any row' })).toBeNull()
    })
  })

  it('announces the run in a live region present before it has anything to say', () => {
    // A live region added to the DOM alongside its first content is the shape
    // screen readers miss, so it is mounted empty rather than conditionally.
    renderTheatre()

    expect(screen.getByRole('status')).toBeTruthy()
  })

  describe('the consent gate that used to be here', () => {
    /*
     * `.claude/rules/security.md` required two controls on this surface until
     * 10/09/26: a standing device preference and a per-consultation tick. The
     * tick was removed by owner decision (#365). These pin the removal, and in
     * particular that the client stopped *claiming* an agreement it no longer
     * collects, because the audit row records exactly what it claims.
     */
    it('asks for no tick and blocks nothing behind one', async () => {
      writeEngine('streaming')
      renderTheatre()

      await waitFor(() => expect(mocks.liveAsrConfig).toHaveBeenCalledWith('dictation'))
      expect(screen.queryByRole('checkbox', { name: /agreed/i })).toBeNull()
      expect(screen.queryByText(/streamed from this browser to Soniox/i)).toBeNull()
      expect(
        (screen.getByRole('button', { name: /^dictate$/i }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })

    it('asks the API for nothing once on-device is chosen', async () => {
      writeEngine('local')
      renderTheatre()

      await waitFor(() => expect(mocks.liveAsrConfig).not.toHaveBeenCalled())
    })
  })

  it('names the deployment when streaming is unavailable, and the network when it is not', async () => {
    writeEngine('streaming')
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'no key'))
    renderTheatre()

    expect(await screen.findByText(/not available on this deployment/)).toBeTruthy()
  })

  it('does not blame the deployment for a failure that is not the deployment', async () => {
    writeEngine('streaming')
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(500, 'oops', 'nope'))
    renderTheatre()

    expect(await screen.findByText(/could not be reached/)).toBeTruthy()
  })

  it('offers no microphone below the hardware floor, and still takes typing', () => {
    // The degrade this feature promises: down to typing, never out to a hosted
    // engine. Nothing here may offer the relay or the socket.
    setCores(2)
    writeEngine('local')
    renderTheatre()

    expect(screen.queryByRole('button', { name: /^dictate$/i })).toBeNull()
    expect(screen.getByLabelText('What You Prescribed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy()
  })

  it('still offers Dictate below the hardware floor when streaming, because a socket loads no weights', async () => {
    setCores(2)
    writeEngine('streaming')
    renderTheatre()

    expect(await screen.findByRole('button', { name: /^dictate$/i })).toBeTruthy()
  })
})
