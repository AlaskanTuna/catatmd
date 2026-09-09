import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  ConsultationDetail,
  ConsultationListItem,
  Fixture,
  GuidelineDocument,
  PatientListItem,
} from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { ConsultationList } from '../routes/ConsultationList.js'
import { ConsultationReview } from '../routes/ConsultationReview.js'
import { Guidelines } from '../routes/Guidelines.js'
import { PatientList } from '../routes/PatientList.js'
import { DemoStepBar } from './DemoStepBar.js'
import { DemoTourProvider, TOUR_STEP_COUNT, TOUR_STEPS, type TourStep } from './DemoTour.js'
import { HelpButton } from './HelpButton.js'
import { Spotlight } from './Spotlight.js'

/**
 * The tour's honesty contract (issue #179).
 *
 * The tour's whole argument is that it narrates the real pipeline rather than
 * replaying a script, and `HelpButton` states that to the user before they
 * agree to start. Teaching CatatAI is the change most likely to break that,
 * because the obvious implementation is a canned exchange. These pin the shape
 * that keeps the claim true.
 */

const catatai = TOUR_STEPS.find((step) => step.target === '[data-tour="catatai"]')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the CatatAI step', () => {
  it('exists exactly once, on the anchor the copilot button already carries', () => {
    const matches = TOUR_STEPS.filter((step) => step.target === '[data-tour="catatai"]')
    expect(matches).toHaveLength(1)
  })

  it('is counted by construction rather than by a hand-edited constant', () => {
    // The failure this prevents is a step added to the array while the dialog
    // keeps advertising the old number.
    expect(TOUR_STEP_COUNT).toBe(TOUR_STEPS.length)
  })

  it('says the copilot reads the consultation including the doctor edits', () => {
    expect(catatai?.hint).toMatch(/reads the consultation/i)
    expect(catatai?.hint).toMatch(/own edits/i)
  })

  it('says the copilot proposes rather than writes', () => {
    expect(catatai?.hint).toMatch(/proposes changes/i)
  })

  /*
   * The claim that distinguishes this product from a scribe. It is the one
   * most likely to be cut for brevity, and cutting it turns the tour into an
   * advertisement for an autonomous note-writer, which this is not.
   */
  it('says the copilot can neither approve a note nor retract a red flag', () => {
    expect(catatai?.hint).toMatch(/never approve a note/i)
    expect(catatai?.hint).toMatch(/retract a red flag/i)
  })

  it('is honest that it is inactive, rather than implying a live copilot', () => {
    expect(catatai?.hint).toMatch(/inactive/i)
    expect(catatai?.hint).toMatch(/not a scripted conversation|never saved/i)
  })

  it('lands before the approval step, so the cannot-approve claim precedes it', () => {
    const catataiAt = TOUR_STEPS.findIndex((step) => step.target === '[data-tour="catatai"]')
    const approveAt = TOUR_STEPS.findIndex((step) => step.target === '[data-tour="approve"]')
    expect(catataiAt).toBeGreaterThanOrEqual(0)
    expect(catataiAt).toBeLessThan(approveAt)
  })

  it('walks a consultation, so the anchor is on a screen the tour reaches', () => {
    expect(catatai?.route).toBe('/consultations/:id')
    expect(catatai?.subject).toBe('flagged')
  })
})

/**
 * A source-scanning tripwire, in the shape the backend uses for invariants the
 * type system cannot express.
 *
 * `HelpButton` promises "Nothing is mocked or replayed" before the user agrees
 * to start. #179 resolved that by keeping the promise true: the tour describes
 * the copilot and shows its real panel inactive, and stages no conversation.
 * If someone later adds a scripted exchange, this test is what makes the
 * promise a deliberate decision rather than something quietly falsified.
 */
describe('tour steps', () => {
  it('has twelve steps in the documented order', () => {
    expect(TOUR_STEPS).toHaveLength(12)
    expect(TOUR_STEPS.map((step) => step.label)).toEqual([
      'Patients',
      'Consultations',
      'Capture',
      'Transcript',
      'Red Flags',
      'Gaps',
      'Checklist',
      'Prescriptions',
      'CatatAI',
      'Approval',
      'Citations',
      'Corpus',
    ])
  })

  it('rejects copy that could become a stale count', () => {
    const numberWords = [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
      'twenty',
      'twenty-one',
      'twenty-two',
      'twenty-three',
      'twenty-four',
      'twenty-five',
      'twenty-six',
      'twenty-seven',
      'twenty-eight',
      'twenty-nine',
      'thirty',
    ]
    const nouns = [
      'field',
      'fields',
      'consultation',
      'consultations',
      'row',
      'rows',
      'gap',
      'gaps',
      'entry',
      'entries',
      'step',
      'steps',
      'these',
    ]
    const staleCountPattern = new RegExp(
      `\\b(\\d+|(?:${numberWords.join('|')}))\\b(?:\\s+\\S+){0,3}\\s+\\b(?:${nouns.join('|')})\\b`,
      'i',
    )

    for (const step of TOUR_STEPS) {
      expect(step.hint).not.toMatch(staleCountPattern)
    }

    expect('paginates 15 rows').toMatch(staleCountPattern)
    expect('twenty-five of these').toMatch(staleCountPattern)
    expect('twenty-four gaps').toMatch(staleCountPattern)
  })
})

describe('the no-mocking promise', () => {
  // Read from the workspace root rather than `import.meta.url`, which is not a
  // file: URL under the jsdom environment this suite runs in.
  const source = readFileSync(resolve(process.cwd(), 'src/demo/HelpButton.tsx'), 'utf8')

  it('is still made to the user before the tour starts', () => {
    expect(source).toContain('Nothing is mocked or replayed.')
  })

  it('is still accompanied by the real-pipeline claim it qualifies', () => {
    expect(source).toMatch(/runs the real pipeline on a simulated transcript/i)
  })
})

/**
 * Regression for the tour stalling when the live analysis falls back to seeded
 * consultations. The fallback must not leave the Next control disabled, and the
 * fallback notice must stay visible.
 */
describe('fallback handling', () => {
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    global.MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0)
    Element.prototype.scrollIntoView = () => {}

    const native = {
      showModal: HTMLDialogElement.prototype.showModal,
      close: HTMLDialogElement.prototype.close,
    }
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
    return () => {
      Object.assign(HTMLDialogElement.prototype, native)
    }
  })

  const fixture: Fixture = {
    id: 'urti-hard-red-flag',
    label: 'Hard red flag',
    transcript: {
      source: 'fixture',
      turns: [{ speaker: 'doctor', text: 'test' }],
    },
  } as unknown as Fixture

  const listItem: ConsultationListItem = {
    id: 'seeded-1',
    status: 'awaiting_review',
    title: 'Seeded consultation',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ConsultationListItem

  const detail: ConsultationDetail = {
    id: 'seeded-1',
    status: 'awaiting_review',
    noteTemplate: 'soap',
    captureMode: 'manual',
    title: 'Seeded consultation',
    createdAt: new Date(),
    updatedAt: new Date(),
    transcript: fixture.transcript,
    analysis: {
      note: { subjective: '', objective: '', assessment: '', plan: '' },
      gaps: [],
      redFlags: [
        {
          id: 'rf-1',
          label: 'Airway compromise',
          severity: 'emergency',
          evidence: 'stridor',
          source: 'rule',
        },
      ],
      suggestions: [
        {
          id: 's-1',
          text: 'Escalate immediately',
          citations: [{ guidelineId: 'g1' }],
        },
      ],
    },
    editedNote: null,
    editedMedicalRecordNote: null,
    prescriptions: null,
    approvedAt: null,
    approvedBy: null,
    patient: null,
    acknowledgedRedFlagIds: [],
    reviewedGapIds: [],
    redFlagDispositions: [],
    gapDispositions: [],
  } as unknown as ConsultationDetail

  it('keeps the Next control enabled and shows the fallback notice after the live analysis fails', async () => {
    vi.spyOn(api, 'fixtures').mockResolvedValue([fixture] as Fixture[])
    vi.spyOn(api, 'analyzeEphemeral').mockRejectedValue(new Error('analysis failed'))
    vi.spyOn(api, 'listConsultations').mockResolvedValue([listItem] as ConsultationListItem[])
    vi.spyOn(api, 'getConsultation').mockResolvedValue(detail)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/patients']}>
          <DemoTourProvider>
            <DemoStepBar />
            <Spotlight />
            <HelpButton />
          </DemoTourProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const help = screen.getByRole('button', { name: /Take the guided tour/i })
    fireEvent.click(help)

    await waitFor(() => {
      expect(screen.getByText('Start Tour')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Start Tour'))

    await waitFor(() => {
      expect(within(screen.getByRole('alert')).getByText('Patients')).toBeTruthy()
    })

    // Step 0 -> Step 1
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Next/i }))

    await waitFor(() => {
      expect(within(screen.getByRole('alert')).getByText('Consultations')).toBeTruthy()
    })

    // Step 1 -> Step 2 (the first analysis-dependent step)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Next/i }))

    await waitFor(
      () => {
        expect(screen.getByText(/Showing prepared consultations/i)).toBeTruthy()
      },
      { timeout: 3000 },
    )

    await waitFor(
      () => {
        const next = screen.queryByRole('button', { name: /Next/i })
        expect(next).toBeTruthy()
        expect((next as HTMLButtonElement).disabled).toBe(false)
      },
      { timeout: 3000 },
    )
  })
})

/**
 * Every tour step's target selector must resolve against the page it routes to,
 * so the spotlight ring has an element to draw around.
 */
describe('tour anchors', () => {
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0)

    const nativeShowModal = HTMLDialogElement.prototype.showModal
    const nativeClose = HTMLDialogElement.prototype.close
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }

    return () => {
      HTMLDialogElement.prototype.showModal = nativeShowModal
      HTMLDialogElement.prototype.close = nativeClose
    }
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const anchorDetail: ConsultationDetail = {
    id: 'tour-anchor-test',
    status: 'awaiting_review',
    noteTemplate: 'soap',
    captureMode: 'manual',
    title: 'Tour anchor test',
    createdAt: new Date(),
    updatedAt: new Date(),
    transcript: {
      source: 'fixture',
      turns: [{ speaker: 'doctor', text: 'The patient has stridor and a sore throat' }],
    },
    analysis: {
      note: { subjective: '', objective: '', assessment: '', plan: '' },
      gaps: [
        {
          id: 'g-1',
          question: 'Any known drug allergies?',
          rationale: 'Needed before prescribing.',
          priority: 'high',
          source: { kind: 'unsourced', reason: 'Not covered in the transcript' },
        },
      ],
      redFlags: [
        {
          id: 'rf-1',
          label: 'Airway compromise',
          severity: 'emergency',
          evidence: 'stridor',
          source: 'rule',
          ruleId: 'airway-compromise',
        },
      ],
      suggestions: [
        {
          id: 's-1',
          text: 'Escalate immediately for airway compromise.',
          citations: [{ guidelineId: 'moh-nag-2024' }],
        },
      ],
      clinicalFacts: {
        symptoms: {},
        history: {},
        observations: {},
        examination: {},
      },
      operational: {
        diagnosis: { state: 'NOT_ASSESSED', value: '' },
        medicationsDispensed: [],
        mcDays: { state: 'NOT_ASSESSED', value: '' },
        referral: { state: 'NOT_ASSESSED', value: '' },
        followUp: { state: 'NOT_ASSESSED', value: '' },
      },
      retrievedGuidelines: [],
    },
    editedNote: null,
    editedMedicalRecordNote: null,
    prescriptions: [
      {
        drug: 'amoxicillin',
        dictated: 'amoxicillin 500 mg three times a day after food for five days',
        dose: '500 mg',
        route: 'oral',
        frequency: 'three-times-daily',
        duration: 'five days',
        food: 'after',
      },
    ],
    approvedAt: null,
    approvedBy: null,
    patient: null,
    acknowledgedRedFlagIds: [],
    reviewedGapIds: [],
    redFlagDispositions: [],
    gapDispositions: [],
  } as unknown as ConsultationDetail

  const patient: PatientListItem = {
    id: 'p-1',
    name: 'Ahmad Test',
    nric: '123456-78-9012',
    gender: 'male',
    dateOfBirth: '1990-01-01',
    lastSeenAt: new Date().toISOString(),
    consultationCount: 1,
  } as unknown as PatientListItem

  const listItem: ConsultationListItem = {
    id: 'tour-anchor-test',
    status: 'awaiting_review',
    title: 'Tour anchor test',
    patientName: 'Ahmad Test',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ConsultationListItem

  const guideline: GuidelineDocument = {
    id: 'moh-nag-2024',
    title: 'National Antibiotic Guideline 2024',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    sourceUrl: 'https://example.com/nag',
    jurisdiction: 'Malaysia',
    sourceLicence: 'MOH copyright',
    pageCount: 100,
    chunkCount: 20,
    ingestedAt: new Date(),
    profiles: ['cough'],
    verbatimAllowed: false,
  } as unknown as GuidelineDocument

  function queryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
  }

  function requireTarget(step: TourStep): string {
    if (!step.target) throw new Error(`${step.label} step has no target`)
    return step.target
  }

  it('resolves anchors on the review page', async () => {
    vi.spyOn(api, 'getConsultation').mockResolvedValue(anchorDetail)
    vi.spyOn(api, 'guidelineDocuments').mockResolvedValue([guideline] as GuidelineDocument[])
    vi.spyOn(api, 'getConsultationAudio').mockResolvedValue(null)

    const client = queryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/consultations/tour-anchor-test']}>
          <DemoTourProvider>
            <Routes>
              <Route path="/consultations/:id" element={<ConsultationReview />} />
            </Routes>
          </DemoTourProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const reviewSteps = TOUR_STEPS.filter((step) => step.route === '/consultations/:id')
    for (const step of reviewSteps) {
      await waitFor(() => {
        expect(document.querySelector(requireTarget(step))).not.toBeNull()
      })
    }
  })

  it('resolves the patients anchor', async () => {
    vi.spyOn(api, 'listPatients').mockResolvedValue([patient] as PatientListItem[])

    const client = queryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/patients']}>
          <Routes>
            <Route path="/patients" element={<PatientList />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const step = TOUR_STEPS.find((s) => s.route === '/patients')
    if (!step) throw new Error('Patients step not found')
    await waitFor(() => {
      expect(document.querySelector(requireTarget(step))).not.toBeNull()
    })
  })

  it('resolves the consultations anchor', async () => {
    vi.spyOn(api, 'listConsultations').mockResolvedValue([listItem] as ConsultationListItem[])

    const client = queryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/consultations']}>
          <Routes>
            <Route path="/consultations" element={<ConsultationList />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const step = TOUR_STEPS.find((s) => s.route === '/consultations')
    if (!step) throw new Error('Consultations step not found')
    await waitFor(() => {
      expect(document.querySelector(requireTarget(step))).not.toBeNull()
    })
  })

  it('resolves the corpus anchor', async () => {
    vi.spyOn(api, 'guidelineDocuments').mockResolvedValue([guideline] as GuidelineDocument[])

    const client = queryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/guidelines']}>
          <Routes>
            <Route path="/guidelines" element={<Guidelines />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const step = TOUR_STEPS.find((s) => s.route === '/guidelines')
    if (!step) throw new Error('Corpus step not found')
    await waitFor(() => {
      expect(document.querySelector(requireTarget(step))).not.toBeNull()
    })
  })
})
