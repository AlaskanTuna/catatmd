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
type Subject = 'flagged' | 'cited'

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
    label: 'Consultations',
    route: '/consultations',
    target: '[data-tour="consultation-list"]',
    hint: 'Five simulated consultations, each left at a different stage: draft, awaiting review, and approved.',
  },
  {
    label: 'Intake',
    route: '/consultations/new',
    target: '[data-tour="intake"]',
    hint: 'A consultation starts as a transcript. Load a bundled case, paste one, or upload a file. All three feed one parser.',
  },
  {
    label: 'Transcript',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="transcript"]',
    hint: 'The source, kept beside the output for the whole review. Nothing on this screen is unattributable to it.',
  },
  {
    label: 'Red Flags',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour^="flag-"]',
    hint: 'Escalation triggers. "Rule" means a deterministic rules engine fired; the model may add candidates but can never suppress or downgrade one.',
  },
  {
    label: 'Gaps',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="gap"]',
    hint: 'What the consultation never established. A sparse transcript yields twenty-five of these; a thorough one yields six. That gap is the product.',
  },
  {
    label: 'Checklist',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="checklist"]',
    hint: 'A fixed 29-field checklist. A field nobody asked about reads "Not Assessed" rather than vanishing, so a fabricated denial is visible.',
  },
  {
    // Deliberately before Approval: the claim that lands hardest here is the
    // one about what the copilot cannot do, and the next stop is the control
    // it cannot press.
    label: 'CatatAI',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="catatai"]',
    hint: 'The review copilot. It reads the consultation as it stands, including your own edits, and proposes changes you choose to apply. It can never approve a note or retract a red flag. It is inactive here, because the consultation this tour analyses is never saved, and nothing on this screen is a scripted conversation.',
  },
  {
    label: 'Approval',
    route: '/consultations/:id',
    subject: 'flagged',
    target: '[data-tour="approve"]',
    hint: 'Nothing is final until the doctor approves it, in two deliberate steps. The tour will not press this for you.',
  },
  {
    // A different consultation on purpose: the one with red flags has no cited
    // suggestions, and this stop needs a real citation to point at.
    label: 'Citations',
    route: '/consultations/:id',
    subject: 'cited',
    target: '[data-tour="suggestion"]',
    hint: 'Suggestions cite guideline IDs from a closed corpus. Free text fails schema validation, so a hallucinated reference cannot reach this card.',
  },
  {
    label: 'Corpus',
    route: '/guidelines',
    target: '[data-tour="corpus"]',
    hint: 'The whole closed set the model may cite, browsable. That is what makes the citation claim checkable rather than merely stated.',
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
 * is newest.** Six of the nine steps point at something inside one
 * consultation, and any of those anchors can be legitimately absent: a
 * consultation with no red flags renders no flag card, one whose findings sit
 * outside the guideline corpus renders no suggestion. Pointing a coachmark at
 * an element that does not exist is the failure this scoring prevents, and it
 * is not hypothetical: the seeded spread contains a consultation with flags but
 * no citations.
 *
 * Red flags are weighted highest because the rule-versus-model distinction is
 * the single thing this product most needs to demonstrate.
 *
 * The list endpoint carries only id, status and timestamps, so details have to
 * be fetched to score at all. That is one read per analysed consultation
 * against an account holding five, paid once at start, and it warms the cache
 * the review screen is about to use anyway.
 */
interface ScoredAnalysis {
  redFlags?: unknown[]
  suggestions?: unknown[]
}

export type Subjects = Record<Subject, string | null>

async function pickConsultations(
  fetchDetail: (id: string) => Promise<{ analysis: unknown }>,
): Promise<Subjects> {
  const list = await api.listConsultations()
  // A draft has no analysis at all, so none of the six anchors exist on it.
  const analysed = list.filter((item) => item.status !== 'draft')
  const fallback = analysed[0]?.id ?? list[0]?.id ?? null
  if (analysed.length === 0) return { flagged: fallback, cited: fallback }

  const details = (
    await Promise.all(
      analysed.map((item) =>
        fetchDetail(item.id)
          .then((detail) => ({ id: item.id, analysis: detail.analysis as ScoredAnalysis | null }))
          .catch(() => null),
      ),
    )
  ).filter((entry) => entry !== null)

  // The approval stop needs the *unapproved* bar, which only renders while the
  // consultation is still awaiting review, so an approved one cannot be the
  // flagged subject even if it has the most flags.
  const approvedIds = new Set(
    list.filter((item) => item.status === 'approved').map((item) => item.id),
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
    details.find((entry) => entry.analysis?.redFlags?.length && !approvedIds.has(entry.id))?.id ??
    details.find((entry) => entry.analysis?.redFlags?.length)?.id ??
    details.find((entry) => !approvedIds.has(entry.id))?.id ??
    fallback

  const cited = details.find((entry) => entry.analysis?.suggestions?.length)?.id ?? flagged

  return { flagged, cited }
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
 * gap-heavy case, which yields twenty-four gaps and **no red flags at all**.
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
    // Unnamed, so the tour's consultation renders through the same timestamp
    // fallback a real un-analysed one does. Deriving a title here would mean
    // running the composer on ephemeral analysis the tour never persists.
    title: null,
    createdAt: now,
    updatedAt: now,
    transcript: fixture.transcript,
    analysis,
    editedNote: null,
    approvedAt: null,
    approvedBy: null,
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
     * Live mode has one consultation, so every consultation step points at the
     * same in-memory record, with one measured exception.
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
     * So that one step falls back to a stored consultation that does have a
     * citation. Reading a seeded row persists nothing, so this costs the
     * ephemeral guarantee nothing; the tour simply stops narrating its own
     * analysis for the one stop its own analysis cannot illustrate.
     */
    const wantsCitation = step.subject === 'cited'
    const hasCitation = (ephemeral.analysis?.suggestions?.length ?? 0) > 0
    if (wantsCitation && !hasCitation && resolved.cited) {
      return step.route.replace(':id', resolved.cited)
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
  const [subjects, setSubjects] = useState<Subjects>({ flagged: null, cited: null })
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
        queryClient.fetchQuery({
          queryKey: ['consultation', consultation],
          queryFn: () => api.getConsultation(consultation),
        }),
      ).catch(() => ({ flagged: null, cited: null }) as Subjects)

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

      let target = ephemeral
      let subject = subjects

      // Only the steps that need a consultation wait for one. Awaiting an
      // already-settled promise costs a microtask, so this is free once the
      // analysis has landed.
      if (step.route.includes(':id') && data.current) {
        setPreparing(true)
        const settled = await data.current
        setPreparing(false)
        target = settled.own
        subject = settled.resolved
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
    setSubjects({ flagged: null, cited: null })
    expectedPath.current = null
    // Dropped so the next tour analyses afresh. Keeping it would hand a second
    // run the first run's consultation, which is a persisted demo by another
    // name and undoes the guarantee this whole design exists for.
    data.current = null
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
      navigate('/consultations/new')
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
    }),
    // `setEphemeral` is a useState setter and stable by React contract, so it is
    // deliberately absent here.
    [active, currentStep, preparing, mode, fallbackReason, ephemeral, start, next, back, stop],
  )

  return <DemoTourContext.Provider value={value}>{children}</DemoTourContext.Provider>
}

export function useDemoTour(): DemoTourValue {
  const context = useContext(DemoTourContext)
  if (context === null) throw new Error('useDemoTour must be used inside DemoTourProvider')
  return context
}
