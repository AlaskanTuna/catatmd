import type { ConsultationDetail } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'

/**
 * The id the tour's own consultation answers to.
 *
 * Not a real row and never persisted. `ConsultationReview` recognises it and
 * reads the detail out of this context instead of fetching, which is what keeps
 * the demo on the same renderer as the real review screen. A second renderer is
 * how "it narrates the real pipeline" quietly stops being true.
 */
export const DEMO_CONSULTATION_ID = 'demo-ephemeral'

/**
 * The guided walkthrough's state machine (#28).
 *
 * **It narrates the real pipeline; it never mocks it.** Every note, gap, red
 * flag and citation the tour points at was produced by the actual
 * de-identification gate, model call, rules engine and evidence check. There
 * are no hardcoded analysis payloads here and no stubbed responses.
 *
 * **It is self-contained: it analyses its own transcript and persists nothing**
 * (issue #80). `analyze-ephemeral` runs the whole pipeline and writes no
 * `Consultation`, so the analysis exists only in this component's state and
 * ends when the tour does. "Wiped instantly on exit" is therefore true by
 * construction rather than by a delete call that could fail or be skipped.
 *
 * That shape was forced rather than preferred. Issue #64 moved `AuditEvent` to
 * `onDelete: Restrict` so a deletion cannot silently break the tamper-evident
 * hash chain, and the tombstone erasure replacing it has no HTTP endpoint
 * pending a retention decision. There is no way to clean up after creating
 * rows, so the answer is to create none.
 *
 * **The seeded walk survives as a fallback, and it announces itself.** If the
 * live analysis fails, the tour walks the demo account's stored consultations
 * instead, and says so on screen. Silently substituting prepared output would
 * have the demo assert it is running the real pipeline at the exact moment an
 * evaluator is judging that claim, which is a worse failure than a visible
 * degradation.
 */

/**
 * Which consultation a step needs.
 *
 * Two, not one, and this is forced by the data rather than chosen. No single
 * consultation in the seeded spread carries both red flags and cited
 * suggestions: the flagged one has five flags and zero citations, and the ones
 * with citations have no flags. A tour pinned to a single consultation
 * therefore has to point one of its stops at an element that does not exist.
 */
type Subject = 'flagged' | 'cited' | 'prescribed'

export interface TourStep {
  label: string
  /** `:id` is substituted with the consultation resolved for `subject`. */
  route: string
  subject?: Subject
  /** A CSS selector, by convention a `data-tour` attribute. */
  target?: string
  hint: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    /*
     * First, because registration is where the clinic workflow actually starts:
     * reception writes a card before the doctor sees anyone, and the visit is
     * filed against it. A tour that opened on the consultation list described
     * the second half of a process and left the first half invisible.
     */
    label: 'Patients',
    route: '/patients',
    target: '[data-tour="patients"]',
    hint: "Reception registers the patient as on paper. The record is the doctor's, and identifiers are removed by detection before anything leaves the server.",
  },
  {
    label: 'Consultations',
    route: '/consultations',
    target: '[data-tour="consultation-list"]',
    hint: 'Consultations are filed under Draft, Awaiting Review, and Approved. The list opens on Awaiting Review and paginates so each category stays scannable.',
  },
  {
    label: 'Capture',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="capture-settings"]',
    hint: 'Consultation Settings chooses the capture mode and the note template. Ambient streams to Soniox; press to record uses the engine set in Audio Settings, on the device by default or uploaded to ILMU in Malaysia.',
  },
  {
    label: 'Transcript',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="transcript"]',
    hint: 'The source is shown beside the output, and underlined words can be corrected or a recorded turn can be played back. The recogniser is primed for Malay clinical terms and proposes mishear corrections, so the text the doctor reads is the one most likely said.',
  },
  {
    label: 'Red Flags',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour^="flag-"]',
    hint: 'Escalation triggers. A "Rule" badge means a deterministic rules engine fired; the model may add candidates but can never suppress or downgrade one.',
  },
  {
    label: 'Gaps',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="gap"]',
    hint: 'Each prompt is a question the consultation never answered. The Sources chips show whether it came from a guideline document or the record checklist, and why that source expects it.',
  },
  {
    label: 'Checklist',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="checklist"]',
    hint: 'The Completeness Checklist opens in a scroller with aligned rows. Every field is listed, so an unasked question reads as "Not Assessed" rather than vanishing.',
  },
  {
    label: 'Prescriptions',
    route: '/consultations/:id',
    subject: 'prescribed',
    target: '[data-tour="prescription"]',
    hint: 'The doctor dictates a medication, checks the parsed fields, and confirms it. Confirmed prescriptions, when there are any, are listed under the plan.',
  },
  {
    // Deliberately before Approval: the claim that lands hardest here is the
    // one about what the copilot cannot do, and the next stop is the control
    // it cannot press.
    label: 'CatatAI',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="catatai"]',
    hint: "The review copilot reads the consultation as it stands, including the doctor's own edits, and proposes changes that the doctor chooses to apply. It can never approve a note or retract a red flag, and it is inactive here because the tour's consultation is never saved.",
  },
  {
    label: 'Approval',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="approve"]',
    hint: 'Nothing is final until the doctor approves it through a two-step confirmation. The tour will not press this for you.',
  },
  {
    // A different consultation on purpose: the one with red flags has no cited
    // suggestions, and this stop needs a real citation to point at.
    label: 'Citations',
    route: '/consultations/:id',
    subject: 'cited',
    target: '[data-tour="suggestion"]',
    hint: 'Each suggestion carries a guideline ID chip that expands to its source, and the model may only cite IDs it was given, so a citation cannot be invented. Open-licence sources show the quoted span with a page link; the National Antimicrobial Guideline is attributed and linked without a quote.',
  },
  {
    label: 'Corpus',
    route: '/guidelines',
    target: '[data-tour="corpus"]',
    hint: "The corpus is the retrieved Malaysian guideline library, shown as one browsable list with a source dropdown. Red flags and Missing Information prompts cite whole documents; the model cites retrieved passages with page anchors, and the Ministry of Health's copyrighted text is attributed, not quoted.",
  },
]

export const TOUR_STEP_COUNT = TOUR_STEPS.length

/**
 * `live` means the tour analysed its own transcript through the real pipeline
 * and is showing output that exists only in this browser tab. `seeded` means
 * that call did not complete and it fell back to walking the demo account's
 * stored consultations.
 *
 * The distinction is surfaced to the viewer rather than kept internal, and that
 * is the whole point of tracking it. The demo's central claim is that it runs
 * the real pipeline instead of a canned script; a fallback that stayed silent
 * would have the tour assert something false at the exact moment it is being
 * assessed. Failing loudly mid-demo is the wrong answer too. Falling back and
 * saying so is the only option that is neither fragile nor dishonest.
 */
type TourMode = 'live' | 'seeded'

/**
 * Why the live analysis did not happen, separated because the two causes call
 * for different actions from whoever is presenting.
 *
 * `rate_limited` is a 429 from the endpoint's own 5/min bucket, and it means the
 * pipeline would have worked and was simply asked too soon, so waiting a minute
 * restores the live path. `failed` is anything else, where retrying gains
 * nothing. Collapsing the two would tell a presenter in a rehearsal that their
 * pipeline is broken when they had only started the tour twice in quick
 * succession.
 *
 * Both still fall back rather than erroring, because a tour that dies on screen
 * is worse than a tour that degrades and says so.
 */
type FallbackReason = 'rate_limited' | 'failed'

interface DemoTourValue {
  active: boolean
  /** 0-indexed; -1 when inactive. */
  currentStep: number
  steps: TourStep[]
  /** True while the opening analysis is running. */
  preparing: boolean
  mode: TourMode
  /** Meaningful only while `mode` is `seeded`. */
  fallbackReason: FallbackReason
  /**
   * Jump to an arbitrary step. Used by the step list so the walkthrough is
   * still navigable when a single Next control is disabled or waiting.
   */
  goTo: (index: number) => void
  /**
   * The tour's own consultation, held only in React state.
   *
   * Never written to the database, never to `localStorage`, never to the query
   * cache. Dropping this reference is the entire cleanup path, which is why
   * "wiped instantly on exit" is true by construction rather than by a delete
   * call that could fail or be skipped.
   */
  ephemeral: ConsultationDetail | null
  /**
   * Applies a review action to the in-memory consultation.
   *
   * Acknowledging a flag, marking a gap reviewed, editing the note and
   * approving all reach the API by id on a stored consultation, and the tour's
   * consultation has no id to reach. Without this every control on the review
   * screen would 404 mid-demo, on the screen the demo exists to show. The
   * transitions are the same ones the real screen performs; only the storage
   * differs, and it is discarded when the tour ends.
   */
  updateEphemeral: (next: ConsultationDetail) => void
  start: () => void
  next: () => void
  back: () => void
  stop: () => void
}

const DemoTourContext = createContext<DemoTourValue | null>(null)

/**
 * Pick the consultation the tour walks.
 *
 * **Scored by how many of the tour's stops it can actually show, not by which
 * is newest.** Most of the steps point at something inside one consultation,
 * and any of those anchors can be legitimately absent: a consultation with no
 * red flags renders no flag card, one whose findings sit outside the guideline
 * corpus renders no suggestion. Pointing a coachmark at an element that does
 * not exist is the failure this scoring prevents, and it is not hypothetical:
 * the seeded spread contains a consultation with flags but no citations.
 *
 * Red flags are weighted highest because the rule-versus-model distinction is
 * the single thing this product most needs to demonstrate.
 *
 * The list endpoint carries only id, status and timestamps, so details have to
 * be fetched to score at all. That is one read per analysed consultation
 * against an account holding five, paid once at start, and it warms the cache
 * the review screen is about to use anyway.
 */

export type Subjects = Record<Subject, string | null>

async function pickConsultations(
  fetchDetail: (id: string) => Promise<ConsultationDetail>,
): Promise<Subjects> {
  const list = await api.listConsultations()
  // A draft has no analysis at all, so none of the review-page anchors exist on it.
  const analysed = list.filter((item) => item.status !== 'draft')
  const fallback = analysed[0]?.id ?? list[0]?.id ?? null
  if (analysed.length === 0) return { flagged: fallback, cited: fallback, prescribed: fallback }

  const details = (
    await Promise.all(
      analysed.map((item) =>
        fetchDetail(item.id)
          .then((detail) => ({ id: item.id, detail }))
          .catch(() => null),
      ),
    )
  ).filter((entry): entry is { id: string; detail: ConsultationDetail } => entry !== null)

  // The approval stop needs the *unapproved* bar, which only renders while the
  // consultation is still awaiting review, so an approved one cannot be the
  // flagged subject even if it has the most flags.
  const approvedIds = new Set(
    list.filter((item) => item.status === 'approved').map((item) => item.id),
  )

  const awaitingIds = new Set(
    list.filter((item) => item.status === 'awaiting_review').map((item) => item.id),
  )

  /*
   * Red flags outrank an unapproved status when the two cannot both be had.
   *
   * The stored spread drifts, because approving a consultation during a demo is
   * permanent and there is no un-approve. Observed exactly that: the only
   * consultation carrying flags is now approved, which under a
   * strictly-unapproved rule pushed the Red Flags stop onto a consultation with
   * none. An approved consultation still renders its flag cards and only loses
   * the approve bar, so preferring flags costs the Approval stop its ring and
   * saves the more important one.
   *
   * The primary path does not have this problem: it analyses a fixture chosen
   * for its flags and is never approved.
   */
  const flagged =
    details.find((entry) => entry.detail.analysis?.redFlags?.length && !approvedIds.has(entry.id))
      ?.id ??
    details.find((entry) => entry.detail.analysis?.redFlags?.length)?.id ??
    details.find((entry) => !approvedIds.has(entry.id))?.id ??
    fallback

  const cited = details.find((entry) => entry.detail.analysis?.suggestions?.length)?.id ?? flagged

  const prescribed =
    details.find((entry) => entry.detail.prescriptions?.length)?.id ??
    details.find((entry) => awaitingIds.has(entry.id))?.id ??
    fallback

  return { flagged, cited, prescribed }
}

/**
 * Analyse a bundled fixture without persisting it.
 *
 * The fixture corpus is synthetic by mandate (`AGENTS.md`), so the transcript
 * the demo analyses carries no patient data before de-identification even runs.
 * The de-identification gate still runs on it, because the endpoint applies the
 * same pipeline to every caller and a demo-shaped exception to the PHI boundary
 * is exactly the kind of hole that stops being demo-shaped later.
 */
/*
 * Not `fixtures[0]`, and the difference decides whether the demo works.
 *
 * The corpus is ordered for the intake screen, and its first entry is the
 * gap-heavy case, which yields many gaps and **no red flags at all**.
 * The tour's headline stop is the rule-versus-model distinction, so analysing
 * that fixture would leave the single most important screen empty while every
 * other step looked fine.
 *
 * `urti-hard-red-flag` produces the airway-compromise `EMERGENCY` marked `Rule`
 * above model-sourced `URGENT` candidates, which is that distinction
 * demonstrating itself without narration.
 */
const DEMO_FIXTURE_ID = 'urti-hard-red-flag'

async function runEphemeral(): Promise<ConsultationDetail> {
  const fixtures = await api.fixtures()
  const fixture = fixtures.find((entry) => entry.id === DEMO_FIXTURE_ID) ?? fixtures[0]
  if (!fixture) throw new Error('no fixtures available')

  const analysis = await api.analyzeEphemeral(fixture.transcript)
  const now = new Date()
  return {
    id: DEMO_CONSULTATION_ID,
    status: 'awaiting_review',
    noteTemplate: 'soap',
    captureMode: 'manual',
    // Unnamed, so the tour's consultation renders through the same timestamp
    // fallback a real un-analysed one does. Deriving a title here would mean
    // running the composer on ephemeral analysis the tour never persists.
    title: null,
    createdAt: now,
    updatedAt: now,
    transcript: fixture.transcript,
    analysis,
    editedNote: null,
    editedMedicalRecordNote: null,
    prescriptions: null,
    approvedAt: null,
    approvedBy: null,
    // The tour's consultation is ephemeral and belongs to no registered patient.
    patient: null,
    acknowledgedRedFlagIds: [],
    reviewedGapIds: [],
    redFlagDispositions: [],
    gapDispositions: [],
  }
}

/**
 * Which consultation a step's route points at.
 *
 * A pure function taking the analysis explicitly rather than a closure reading
 * it from state, because the tour now starts before the analysis finishes. A
 * step that waits for it resumes with the resolved value in hand, and a closure
 * captured at render time would still hold the `null` it started with.
 *
 * `ephemeral` being non-null is what "live" means; there is no separate flag.
 */
function resolveStepRoute(
  step: TourStep,
  resolved: Subjects,
  ephemeral: ConsultationDetail | null,
): string {
  if (!step.route.includes(':id')) return step.route

  if (ephemeral) {
    /*
     * Live mode has one consultation, so most consultation steps point at the
     * same in-memory record, with measured exceptions.
     *
     * The Citations stop needs a cited suggestion to point at, and whether the
     * analysis produces one is a property of the transcript rather than a
     * guarantee. The fixture chosen for its red flags is a severe presentation
     * whose correct handling is "escalate now", and escalation is not a
     * guideline-cited recommendation: analysing it against production returned
     * five red flags and zero suggestions. Sending the Citations step there
     * would leave the closed-corpus claim pointing at an element that does not
     * exist.
     *
     * The Prescriptions stop needs a stored consultation, because the tour's own
     * analysis is never persisted and a demo record has no id to record a
     * prescription against.
     *
     * Those two stops fall back to stored consultations that carry the anchor.
     * Reading a seeded row persists nothing, so this costs the ephemeral
     * guarantee nothing; the tour simply stops narrating its own analysis for
     * the stops its own analysis cannot illustrate.
     */
    const wantsCitation = step.subject === 'cited'
    const hasCitation = (ephemeral.analysis?.suggestions?.length ?? 0) > 0
    if (wantsCitation && !hasCitation && resolved.cited) {
      return step.route.replace(':id', resolved.cited)
    }
    if (step.subject === 'prescribed') {
      const id = resolved.prescribed ?? resolved.flagged ?? resolved.cited
      if (id) return step.route.replace(':id', id)
    }
    return step.route.replace(':id', DEMO_CONSULTATION_ID)
  }

  const id = resolved[step.subject ?? 'flagged'] ?? resolved.flagged
  // Without an id there is nothing to review; the list is the honest
  // destination rather than a route with a literal ":id" in it.
  return id ? step.route.replace(':id', id) : '/consultations'
}

/** What the opening work resolves to, handed to whichever step waits on it. */
interface TourData {
  own: ConsultationDetail | null
  resolved: Subjects
}

export function DemoTourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [active, setActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [preparing, setPreparing] = useState(false)
  const [mode, setMode] = useState<TourMode>('live')
  const [fallbackReason, setFallbackReason] = useState<FallbackReason>('failed')
  const [ephemeral, setEphemeral] = useState<ConsultationDetail | null>(null)
  const [subjects, setSubjects] = useState<Subjects>({
    flagged: null,
    cited: null,
    prescribed: null,
  })
  /** Where the tour last sent the browser, so a user-driven navigation is
      distinguishable from the tour's own. */
  const expectedPath = useRef<string | null>(null)

  /**
   * The opening analysis, in flight.
   *
   * Held in a ref rather than state because nothing renders from it directly;
   * it exists so a step that needs the consultation can await the same promise
   * instead of racing it or starting a second one.
   */
  const data = useRef<Promise<TourData> | null>(null)

  /**
   * The resolved result of that opening analysis, kept once `data.current`
   * lands so later steps can navigate without re-blocking on `preparing`.
   */
  const settled = useRef<TourData | null>(null)

  /*
   * The tour opens immediately and the analysis catches up, rather than the
   * tour waiting for the analysis.
   *
   * Running the real pipeline costs about 50 seconds against production, and
   * blocking on it meant a minute of spinner before anything appeared, which
   * reads as broken rather than as thorough. The first two stops, the
   * consultation list and the intake screen, do not touch the analysis at all,
   * so there is nothing to wait for until the third. By the time a viewer has
   * read those two the call has usually landed, and if it has not, the wait
   * happens at the stop that genuinely needs it, with the product on screen
   * rather than a modal.
   */
  const start = useCallback(() => {
    // Reset state from any previous run so a fresh tour does not inherit a
    // stale fallback notice or a stuck `preparing` flag.
    setPreparing(false)
    setMode('live')
    setFallbackReason('failed')
    setEphemeral(null)
    setSubjects({ flagged: null, cited: null, prescribed: null })
    settled.current = null

    data.current = (async () => {
      /*
       * Both paths resolve concurrently, even when the live one succeeds.
       *
       * The seeded subjects are needed in live mode too, because the Citations
       * step falls back to a stored consultation when the analysis produces no
       * suggestions. The scoring reads finish in well under a second against a
       * call taking roughly fifty, and they warm the cache the review screen is
       * about to use.
       */
      const seeded = pickConsultations((consultation) =>
        queryClient
          .fetchQuery({
            queryKey: ['consultation', consultation],
            queryFn: () => api.getConsultation(consultation),
          })
          .then((detail) => detail as ConsultationDetail),
      ).catch(() => ({ flagged: null, cited: null, prescribed: null }) as Subjects)

      // Live first. The seeded walk is the fallback, not the plan.
      //
      // No automatic retry, deliberately. The endpoint allows 5/min per IP, so
      // a retry on failure turns one flaky call into a 429 and reports a rate
      // limit where the real fault was something else.
      const own = await runEphemeral().catch((error: unknown) => {
        setFallbackReason(
          error instanceof ApiError && error.status === 429 ? 'rate_limited' : 'failed',
        )
        return null
      })
      const resolved = await seeded

      setEphemeral(own)
      setSubjects(resolved)
      setMode(own ? 'live' : 'seeded')
      settled.current = { own, resolved }
      return { own, resolved }
    })()

    setActive(true)
    setCurrentStep(0)

    const first = TOUR_STEPS[0] as TourStep
    expectedPath.current = first.route
    navigate(first.route)
  }, [navigate, queryClient])

  const goTo = useCallback(
    async (index: number) => {
      const step = TOUR_STEPS[index]
      if (!step) return

      // Clear any leftover preparing state from a previous step before this one
      // begins. The step list can now jump to a non-consultation step to escape
      // a stuck analysis wait.
      setPreparing(false)

      let target = ephemeral
      let subject = subjects

      // Only the steps that need a consultation wait for one. Awaiting an
      // already-settled promise costs a microtask, so this is free once the
      // analysis has landed. Once it has landed, the cached `settled` value
      // keeps later steps from re-entering `preparing`.
      if (step.route.includes(':id')) {
        if (settled.current) {
          target = settled.current.own
          subject = settled.current.resolved
        } else if (data.current) {
          setPreparing(true)
          try {
            const value = await data.current
            target = value.own
            subject = value.resolved
          } finally {
            setPreparing(false)
          }
        }
      }

      setCurrentStep(index)
      const path = resolveStepRoute(step, subject, target)
      expectedPath.current = path
      navigate(path)
    },
    [subjects, ephemeral, navigate],
  )

  /**
   * Ending the tour is the whole cleanup path.
   *
   * Dropping the reference is what "wiped instantly" means here: the analysis
   * lived in React state and nowhere else, so there is no row to delete, no
   * cache entry to invalidate and no request that can fail halfway. Exit,
   * finish and interrupt all land on this one function so none of them can
   * leave the data behind.
   */
  const stop = useCallback(() => {
    setActive(false)
    setCurrentStep(-1)
    setPreparing(false)
    setEphemeral(null)
    setSubjects({ flagged: null, cited: null, prescribed: null })
    expectedPath.current = null
    // Dropped so the next tour analyses afresh. Keeping it would hand a second
    // run the first run's consultation, which is a persisted demo by another
    // name and undoes the guarantee this whole design exists for.
    data.current = null
    settled.current = null
  }, [])

  const next = useCallback(() => {
    /*
     * The last step closes the tour rather than dead-ending on a disabled
     * button, so there is always exactly one obvious way forward, and it hands
     * the viewer the intake screen on the way out.
     *
     * The tour ends on the guideline corpus, which is a reference page and a
     * dead end. What someone most plausibly wants after being shown how a
     * consultation is analysed is to run one, so finishing lands there instead
     * of leaving them where the narration happened to stop.
     *
     * Leaving early through End or Escape deliberately does not redirect. That
     * is someone getting out, not arriving, and sending them somewhere they did
     * not ask to go would be exactly the interruption the tour avoids elsewhere.
     */
    if (currentStep >= TOUR_STEPS.length - 1) {
      stop()
      // Ends where the workflow starts: the patient the visit will be filed to.
      navigate('/patients')
      return
    }
    void goTo(currentStep + 1)
  }, [currentStep, goTo, stop, navigate])

  const back = useCallback(() => {
    if (currentStep > 0) void goTo(currentStep - 1)
  }, [currentStep, goTo])

  /*
   * "Interrupted" counts as an exit, per the requirement on issue #80.
   *
   * The tour navigates constantly, so a location change is only a user
   * interruption when it lands somewhere the tour did not send it. Comparing
   * against the path the tour last requested is what separates the two; a bare
   * location listener would tear the tour down on its own first step.
   */
  useEffect(() => {
    if (!active) return
    if (expectedPath.current === null) return
    if (location.pathname === expectedPath.current) return
    stop()
  }, [active, location.pathname, stop])

  const value = useMemo(
    () => ({
      active,
      currentStep,
      steps: TOUR_STEPS,
      preparing,
      mode,
      fallbackReason,
      ephemeral,
      updateEphemeral: setEphemeral,
      start,
      next,
      back,
      stop,
      goTo,
    }),
    // `setEphemeral` is a useState setter and stable by React contract, so it is
    // deliberately absent here.
    [
      active,
      currentStep,
      preparing,
      mode,
      fallbackReason,
      ephemeral,
      start,
      next,
      back,
      stop,
      goTo,
    ],
  )

  return <DemoTourContext.Provider value={value}>{children}</DemoTourContext.Provider>
}

export function useDemoTour(): DemoTourValue {
  const context = useContext(DemoTourContext)
  if (context === null) throw new Error('useDemoTour must be used inside DemoTourProvider')
  return context
}
