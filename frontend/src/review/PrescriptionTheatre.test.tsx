import type { MedicationCandidateWire, Prescription, PrescriptionLine } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.js'
import { PrescriptionTheatre } from './PrescriptionTheatre.js'

/**
 * Where a prescription is dictated and assembled (#365, D-001 amended 06/10/26).
 *
 * Four claims carry this surface, and each is a property of the markup that a
 * pure test structurally cannot make.
 *
 * 1. Only an exact name starts ticked. A near-match waits for the doctor's own
 *    tick, and a line with no recognised name proposes no drug at all.
 * 2. A dosed line nobody named holds Confirm, so it cannot be dropped silently.
 * 3. Every drug said is read in one parse, each with its own sig, and a field
 *    the doctor typed survives the box being read again.
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

/**
 * An on-device choice as earlier builds stored it, from the Audio dialog this
 * theatre used to carry. Nothing reads it any more, which is the point.
 */
const storeLegacyOnDeviceChoice = () =>
  localStorage.setItem(
    'catatmd.audio',
    JSON.stringify({
      deviceId: null,
      suppressNoise: true,
      boostQuietSpeech: false,
      engine: 'local',
      dictationEngine: 'local',
    }),
  )

/** Just enough of `MediaRecorder` for the on-device path to reach Listening. */
class FakeRecorder {
  state: RecordingState = 'inactive'
  mimeType = 'audio/webm'
  stream: MediaStream
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  constructor(stream: MediaStream) {
    this.stream = stream
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
  }
}

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

/** Type a phrase and wait for the box to be read, which happens once typing rests. */
const type = async (phrase: string) => {
  fireEvent.change(screen.getByLabelText('What You Prescribed'), { target: { value: phrase } })
  await waitFor(() =>
    expect(mocks.parsePrescription).toHaveBeenCalledWith('consultation-1', phrase.trim()),
  )
}

const table = () => screen.findByRole('list', { name: 'Prescription lines' })
const fields = (name: string) =>
  screen
    .getAllByLabelText(new RegExp(`^${name}, line \\d+$`))
    .map((field) => (field as HTMLInputElement).value)
const drugs = () => fields('Drug')
const doses = () => fields('Dose')
const ticked = () =>
  screen
    .getAllByRole('checkbox', { name: /^Include line/ })
    .map((box) => (box as HTMLInputElement).checked)
const confirmButton = () => screen.getByRole('button', { name: /Confirm/ })

const line = (over: Partial<PrescriptionLine> = {}): PrescriptionLine => ({
  start: 0,
  end: 0,
  candidates: [],
  exact: false,
  sig: NO_SIG,
  shared: [],
  ...over,
})

const response = (lines: PrescriptionLine[]) => ({
  sig: NO_SIG,
  candidates: lines.flatMap(({ candidates }) => candidates),
  lines,
  generics: ['amoxicillin', 'azithromycin', 'paracetamol'],
})

/** Where `part` sits in `text`, as a line's bounds. */
const at = (text: string, part: string) => ({
  start: text.indexOf(part),
  end: text.indexOf(part) + part.length,
})

/** The dictation reported on 06/10/26, which found two of its three drugs. */
const REPORTED =
  'Amoxicillin 500 mg, paracetamol 350 mg, antibiotic 200 mg, all of them 2 times a day.'
const SHARED_CLAUSE = { field: 'frequency' as const, ...at(REPORTED, 'all of them 2 times a day') }
const TWICE = { ...NO_SIG, frequency: 'twice-daily' as const }
const REPORTED_LINES: PrescriptionLine[] = [
  line({
    ...at(REPORTED, 'Amoxicillin 500 mg'),
    candidates: [candidate({ heard: 'Amoxicillin', ...at(REPORTED, 'Amoxicillin'), score: 1 })],
    exact: true,
    sig: { ...TWICE, dose: '500 mg' },
    shared: [SHARED_CLAUSE],
  }),
  line({
    ...at(REPORTED, 'paracetamol 350 mg'),
    candidates: [
      candidate({
        lexiconId: 'paracetamol',
        generic: 'paracetamol',
        heard: 'paracetamol',
        ...at(REPORTED, 'paracetamol'),
        score: 1,
      }),
    ],
    exact: true,
    sig: { ...TWICE, dose: '350 mg' },
    shared: [SHARED_CLAUSE],
  }),
  line({
    ...at(REPORTED, 'antibiotic 200 mg'),
    sig: { ...TWICE, dose: '200 mg' },
    shared: [SHARED_CLAUSE],
  }),
]
const REPORTED_RESPONSE = response(REPORTED_LINES)

const NEAR = 'sefuroxeem 250 mg twice a day'
const SEFUROXEEM = candidate({
  lexiconId: 'cefuroxime',
  generic: 'cefuroxime',
  heard: 'sefuroxeem',
  ...at(NEAR, 'sefuroxeem'),
  score: 0.8,
})

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
    renderTheatre({ autoStart: true })

    await waitFor(() =>
      expect(mocks.createLiveSession).toHaveBeenCalledWith(expect.anything(), 'dictation'),
    )
  })

  it('says it is getting ready rather than sitting blank while the engine resolves', () => {
    renderTheatre({ autoStart: true })

    expect(screen.getByRole('status').textContent).toBe('Getting ready.')
  })

  it('falls back to on-device when streaming is unavailable, and opens no socket', async () => {
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'no key'))
    renderTheatre({ autoStart: true })

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    expect(mocks.createLiveSession).not.toHaveBeenCalled()
  })

  /*
   * The engine is no longer a preference on this page. A device an older build
   * left on on-device would otherwise be the one place streaming was skipped,
   * with nothing on screen saying why.
   */
  it('streams even where an older build stored an on-device choice', async () => {
    storeLegacyOnDeviceChoice()
    renderTheatre({ autoStart: true })

    await waitFor(() =>
      expect(mocks.createLiveSession).toHaveBeenCalledWith(expect.anything(), 'dictation'),
    )
  })

  /*
   * `dialog.close()` fires `close` and never `cancel`, so a guard wired to
   * `onCancel` caught Escape and let the header's X and the Discard button
   * wipe the table without asking.
   */
  it('asks before the X button discards ticked lines', async () => {
    mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
    const { onClose } = renderTheatre()
    await type(REPORTED)
    await table()

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close prescription dictation' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(drugs()).toEqual(['amoxicillin', 'paracetamol', ''])
  })

  it('asks before Discard wipes the table', async () => {
    mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
    renderTheatre()
    await type(REPORTED)
    await table()

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(drugs()).toEqual(['amoxicillin', 'paracetamol', ''])
  })

  /*
   * A response for text the doctor has since changed must not be rendered: its
   * offsets belong to words no longer in the box.
   */
  it('drops a read of text the doctor has since changed', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    mocks.parsePrescription.mockImplementation((_id: string, dictated: string) =>
      dictated === REPORTED
        ? new Promise((resolve) => {
            releaseFirst = resolve
          })
        : Promise.resolve(response([])),
    )
    renderTheatre()
    await type(REPORTED)
    await type('cetirizine at night')
    await screen.findByText(/No drug name or dose was read/)

    releaseFirst(REPORTED_RESPONSE)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('list', { name: 'Prescription lines' })).toBeNull()
  })

  /*
   * A failed read left the doctor with nothing to work on before #365, and a
   * table out of step with the box afterwards. Both are named, with a retry.
   */
  it('still offers somewhere to work when the read fails, and a retry', async () => {
    mocks.parsePrescription.mockRejectedValueOnce(new Error('nope'))
    mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
    renderTheatre()
    await type(REPORTED)

    expect(await screen.findByRole('button', { name: 'Add Line' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }))

    expect(await table()).toBeTruthy()
  })

  it('takes the table away when the box is cleared, rather than leaving lines for no text', async () => {
    mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
    renderTheatre()
    await type(REPORTED)
    await table()

    fireEvent.change(screen.getByLabelText('What You Prescribed'), { target: { value: '' } })

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Prescription lines' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: /Confirm/ })).toHaveProperty('disabled', true)
  })

  it('does not claim nothing was read before anything was read', () => {
    renderTheatre()
    fireEvent.change(screen.getByLabelText('What You Prescribed'), {
      target: { value: 'amoxicillin' },
    })

    expect(screen.queryByText(/No drug name or dose was read/)).toBeNull()
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
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
    localStorage.clear()
  })

  describe('the prescription lines table', () => {
    it('reads every drug said into its own line, in one read', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      renderTheatre()
      await type(REPORTED)
      await table()

      expect(mocks.parsePrescription).toHaveBeenCalledTimes(1)
      expect(drugs()).toEqual(['amoxicillin', 'paracetamol', ''])
      expect(doses()).toEqual(['500 mg', '350 mg', '200 mg'])
    })

    it('ticks an exact name, and never a near-match', async () => {
      mocks.parsePrescription.mockResolvedValue(
        response([
          line({ ...at(NEAR, 'sefuroxeem 250 mg'), candidates: [SEFUROXEEM], exact: false }),
        ]),
      )
      renderTheatre()
      await type(NEAR)
      await table()

      expect(ticked()).toEqual([false])
      expect(screen.getByText(/Heard “sefuroxeem”, which is not an exact match/)).toBeTruthy()
      expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 1' }))

      expect((confirmButton() as HTMLButtonElement).disabled).toBe(false)
    })

    it('holds Confirm on a near-match until it is taken or left out, never dropping it quietly', async () => {
      // Clinical review, 06/10/26: "Paracetamol, Ponstan 500 mg" offered a
      // near-match for Ponstan, unticked, and Confirm saved paracetamol alone.
      mocks.parsePrescription.mockResolvedValue(
        response([
          ...REPORTED_LINES.slice(0, 1),
          line({ ...at(NEAR, 'sefuroxeem 250 mg'), candidates: [SEFUROXEEM], exact: false }),
        ]),
      )
      const { onSave } = renderTheatre()
      await type(NEAR)
      await table()

      expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByRole('status').textContent).toMatch(/1 line was not an exact match/)

      fireEvent.click(screen.getByRole('button', { name: 'Leave line 2 out' }))
      fireEvent.click(confirmButton())

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      const sent = onSave.mock.calls[0]?.[0] as Prescription[]
      expect(sent.map(({ drug }) => drug)).toEqual(['amoxicillin'])
    })

    it('holds Confirm until the line with no recognised name is named', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      const { onSave } = renderTheatre()
      await type(REPORTED)
      await table()

      expect(ticked()).toEqual([true, true, true])
      expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByRole('status').textContent).toMatch(/1 ticked line has no drug name/)
      fireEvent.click(confirmButton())
      expect(onSave).not.toHaveBeenCalled()

      fireEvent.change(screen.getByLabelText('Drug, line 3'), {
        target: { value: 'azithromycin' },
      })
      fireEvent.click(confirmButton())

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      const sent = onSave.mock.calls[0]?.[0] as Prescription[]
      expect(sent.map(({ drug }) => drug)).toEqual(['amoxicillin', 'paracetamol', 'azithromycin'])
      // Typed by hand, so it claims no lexicon match.
      expect(sent[2]?.lexiconId).toBeUndefined()
      expect(sent[2]).toMatchObject({ dose: '200 mg', frequency: 'twice-daily' })
    })

    it('leaves an unticked line out, and lets Confirm go without it', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      const { onSave } = renderTheatre()
      await type(REPORTED)
      await table()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 3' }))
      fireEvent.click(confirmButton())

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      const sent = onSave.mock.calls[0]?.[0] as Prescription[]
      expect(sent.map(({ drug }) => drug)).toEqual(['amoxicillin', 'paracetamol'])
    })

    it('proposes no drug for a line with no recognised name, only suggestions', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      renderTheatre()
      await type(REPORTED)
      await table()

      const field = screen.getByLabelText('Drug, line 3') as HTMLInputElement
      expect(field.value).toBe('')
      const suggestions = document.getElementById(field.getAttribute('list') ?? '')
      expect(suggestions?.querySelectorAll('option')).toHaveLength(3)
      expect(screen.getByText(/Needs a drug name/)).toBeTruthy()
      expect(field.getAttribute('aria-invalid')).toBe('true')
      expect(
        document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toMatch(/untick it to leave it out/)
    })

    it('shows the words each line was read from, and where a shared field came from', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      renderTheatre()
      await type(REPORTED)
      await table()

      const first = within(await table()).getAllByRole('listitem')[0] as HTMLElement
      expect(within(first).getByText('Amoxicillin').tagName).toBe('MARK')
      expect(within(first).getByText(/Frequency from “all of them 2 times a day”/)).toBeTruthy()
    })

    it('saves the shared clause with the line as its evidence', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      const { onSave } = renderTheatre({ stored: [STORED] })
      await type(REPORTED)
      await table()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 3' }))
      fireEvent.click(confirmButton())

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      const sent = onSave.mock.calls[0]?.[0] as Prescription[]
      // The whole list rather than a delta.
      expect(sent[0]).toEqual(STORED)
      expect(sent[1]).toMatchObject({
        drug: 'amoxicillin',
        lexiconId: 'amoxicillin',
        dose: '500 mg',
        frequency: 'twice-daily',
        route: null,
        dictated: 'Amoxicillin 500 mg … all of them 2 times a day',
      })
    })

    it('counts the prescriptions on the button, so one press is one commit', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      renderTheatre()
      await type(REPORTED)
      await table()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 3' }))

      expect(confirmButton().textContent).toMatch(/Confirm 2 Prescriptions/)
    })

    it('keeps a dose the doctor typed when the box is read again', async () => {
      mocks.parsePrescription.mockImplementation((_id: string, dictated: string) =>
        Promise.resolve(
          dictated === REPORTED
            ? REPORTED_RESPONSE
            : response(
                REPORTED_LINES.map((each) => ({
                  ...each,
                  start: each.start + 6,
                  end: each.end + 6,
                })),
              ),
        ),
      )
      renderTheatre()
      await type(REPORTED)
      await table()
      fireEvent.change(screen.getByLabelText('Dose, line 1'), { target: { value: '1 g' } })

      await type(`Okay. ${REPORTED}`)
      await waitFor(() => expect(mocks.parsePrescription).toHaveBeenCalledTimes(2))

      expect(doses()).toEqual(['1 g', '350 mg', '200 mg'])
    })

    it('holds Confirm while the box has changed and not been read yet', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
      renderTheatre()
      await type(REPORTED)
      await table()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 3' }))
      expect((confirmButton() as HTMLButtonElement).disabled).toBe(false)

      fireEvent.change(screen.getByLabelText('What You Prescribed'), {
        target: { value: `${REPORTED} Cetirizine 10 mg.` },
      })

      expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByRole('status').textContent).toBe('Reading the prescription.')
    })

    it('keeps the box editable while a read is in flight', async () => {
      mocks.parsePrescription.mockReturnValue(new Promise(() => {}))
      renderTheatre()
      await type(REPORTED)

      expect((screen.getByLabelText('What You Prescribed') as HTMLTextAreaElement).disabled).toBe(
        false,
      )
    })

    it("offers the matcher's other readings in its order, and takes one on the doctor's pick", async () => {
      // The #311 wrong-drug case: the combination is returned first despite the
      // lower score, and must still be read first.
      const text = 'amoxicillin clavulanate 625 mg twice daily'
      const combination = candidate({
        lexiconId: 'amoxicillin-clavulanate',
        generic: 'amoxicillin-clavulanate',
        heard: 'amoxicillin clavulanate',
        start: 0,
        end: 23,
        score: 0.88,
      })
      const single = candidate({ heard: 'amoxicillin', start: 0, end: 11, score: 0.96 })
      mocks.parsePrescription.mockResolvedValue(
        response([line({ start: 0, end: text.length, candidates: [combination, single] })]),
      )
      renderTheatre()
      await type(text)
      await table()

      expect(drugs()).toEqual(['amoxicillin-clavulanate'])
      fireEvent.click(screen.getByRole('button', { name: 'Read line 1 as amoxicillin' }))

      expect(drugs()).toEqual(['amoxicillin'])
      expect(ticked()).toEqual([true])
      // The button left with the choice; focus went to the name it set.
      expect(document.activeElement).toBe(screen.getByLabelText('Drug, line 1'))
    })

    it('keeps every line when the save fails, and says nothing was lost', async () => {
      mocks.parsePrescription.mockResolvedValue(REPORTED_RESPONSE)
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
      await type(REPORTED)
      await table()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Include line 3' }))
      fireEvent.click(confirmButton())

      expect(await screen.findByText(/Nothing was lost/)).toBeTruthy()
      expect(drugs()).toEqual(['amoxicillin', 'paracetamol', ''])
      expect(onClose).not.toHaveBeenCalled()
    })

    it('says so when nothing was read, rather than showing an empty space', async () => {
      mocks.parsePrescription.mockResolvedValue(response([]))
      renderTheatre()
      await type('advised rest and fluids')

      expect(await screen.findByText(/No drug name or dose was read/)).toBeTruthy()
    })

    it('takes a drug by hand, quoting the box as its evidence', async () => {
      const text = 'Strepsils one lozenge every four hours'
      mocks.parsePrescription.mockResolvedValue(response([]))
      const { onSave } = renderTheatre()
      await type(text)

      fireEvent.click(await screen.findByRole('button', { name: 'Add Line' }))
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByLabelText('Drug, line 1')),
      )
      fireEvent.change(screen.getByLabelText('Drug, line 1'), { target: { value: 'Strepsils' } })
      fireEvent.click(confirmButton())

      await waitFor(() => expect(onSave).toHaveBeenCalled())
      const sent = onSave.mock.calls[0]?.[0] as Prescription[]
      expect(sent[0]).toMatchObject({ drug: 'Strepsils', dictated: text })
      expect(sent[0]?.lexiconId).toBeUndefined()
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
      renderTheatre()

      await waitFor(() => expect(mocks.liveAsrConfig).toHaveBeenCalledWith('dictation'))
      expect(screen.queryByRole('checkbox', { name: /agreed/i })).toBeNull()
      expect(screen.queryByText(/streamed from this browser to Soniox/i)).toBeNull()
      expect(
        (screen.getByRole('button', { name: /^dictate$/i }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })
  })

  it('names the deployment when streaming is unavailable, and the network when it is not', async () => {
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'no key'))
    renderTheatre()

    expect(await screen.findByText(/not available on this deployment/)).toBeTruthy()
  })

  it('does not blame the deployment for a failure that is not the deployment', async () => {
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(500, 'oops', 'nope'))
    renderTheatre()

    expect(await screen.findByText(/could not be reached/)).toBeTruthy()
  })

  it('offers no microphone below the hardware floor, and still takes typing', async () => {
    // The degrade this feature promises: down to typing, never out to a hosted
    // engine. Nothing here may offer the relay or the socket. Below the floor
    // with streaming unavailable, the on-device model is the only engine left
    // and this machine cannot run it.
    setCores(2)
    mocks.liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'no key'))
    renderTheatre()

    expect(await screen.findByText(/not available on this deployment/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^dictate$/i })).toBeNull()
    expect(screen.getByLabelText('What You Prescribed')).toBeTruthy()
  })

  it('still offers Dictate below the hardware floor when streaming, because a socket loads no weights', async () => {
    setCores(2)
    renderTheatre()

    expect(await screen.findByRole('button', { name: /^dictate$/i })).toBeTruthy()
  })

  describe('the header', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('carries no audio settings of its own', async () => {
      renderTheatre()

      await waitFor(() => expect(mocks.liveAsrConfig).toHaveBeenCalledWith('dictation'))
      expect(screen.queryByRole('button', { name: /audio settings/i })).toBeNull()
    })

    it('labels the second dictation in Title Case', async () => {
      mocks.parsePrescription.mockResolvedValue(response([]))
      renderTheatre()
      await type(DICTATED)

      expect(await screen.findByRole('button', { name: 'Dictate Again' })).toBeTruthy()
    })

    /*
     * The words "Silent" and "No microphone access" became a wave. What they
     * said moved into the wave's accessible name rather than being dropped.
     */
    it('shows the microphone as a named wave while listening, with no status words', async () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        },
      })
      vi.stubGlobal('MediaRecorder', FakeRecorder)
      mocks.liveAsrConfig.mockRejectedValue(new ApiError(503, 'asr_unavailable', 'no key'))
      renderTheatre({ autoStart: true })

      expect(await screen.findByRole('img', { name: /^Microphone level: / })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Stop dictation' })).toBeTruthy()
      expect(screen.queryByText(/^(Silent|Hearing you now|No microphone access)$/)).toBeNull()
    })
  })
})
