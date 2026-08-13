import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'

/**
 * The guided walkthrough's state machine (#28).
 *
 * **It narrates the real pipeline; it never mocks it.** Every note, gap, red
 * flag and citation the tour points at was produced by the actual
 * de-identification gate, model call, rules engine and evidence check. There
 * are no hardcoded analysis payloads here and no stubbed responses.
 *
 * It also **creates nothing**. The original ask was for a self-contained mode
 * that makes its own consultations and deletes them afterwards, and that is not
 * buildable today: issue #64 moved `AuditEvent` to `onDelete: Restrict` so a
 * deletion can no longer silently break the tamper-evident hash chain, and the
 * tombstone erasure that replaced it has no HTTP endpoint on purpose, pending an
 * open retention decision. A tour that created rows it could not remove would be
 * worse than one that creates none, so this walks the seeded demo spread
 * instead. Those consultations came out of the real pipeline, which is what
 * keeps the no-mocking constraint satisfied.
 *
 * The consequence worth knowing: the tour is **read-only**. It navigates and
 * explains. It never analyses, edits or approves on the user's behalf, which
 * also means it can never trip the approval gate the product exists to enforce.
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

const TOUR_STEPS: TourStep[] = [
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

interface DemoTourValue {
  active: boolean
  /** 0-indexed; -1 when inactive. */
  currentStep: number
  steps: TourStep[]
  /** True while the opening consultation is being resolved. */
  preparing: boolean
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

  const flagged =
    details.find((entry) => entry.analysis?.redFlags?.length && !approvedIds.has(entry.id))?.id ??
    details.find((entry) => !approvedIds.has(entry.id))?.id ??
    fallback

  const cited = details.find((entry) => entry.analysis?.suggestions?.length)?.id ?? flagged

  return { flagged, cited }
}

export function DemoTourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [active, setActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [preparing, setPreparing] = useState(false)
  const [subjects, setSubjects] = useState<Subjects>({ flagged: null, cited: null })

  const routeFor = useCallback((step: TourStep, resolved: Subjects) => {
    if (!step.route.includes(':id')) return step.route
    const id = resolved[step.subject ?? 'flagged'] ?? resolved.flagged
    // Without an id there is nothing to review; the list is the honest
    // destination rather than a route with a literal ":id" in it.
    return id ? step.route.replace(':id', id) : '/consultations'
  }, [])

  const start = useCallback(async () => {
    setPreparing(true)
    const resolved = await pickConsultations((consultation) =>
      queryClient.fetchQuery({
        queryKey: ['consultation', consultation],
        queryFn: () => api.getConsultation(consultation),
      }),
    ).catch(() => ({ flagged: null, cited: null }) as Subjects)

    setSubjects(resolved)
    setPreparing(false)
    setActive(true)
    setCurrentStep(0)
    navigate(routeFor(TOUR_STEPS[0] as TourStep, resolved))
  }, [navigate, queryClient, routeFor])

  const goTo = useCallback(
    (index: number) => {
      const step = TOUR_STEPS[index]
      if (!step) return
      setCurrentStep(index)
      navigate(routeFor(step, subjects))
    },
    [subjects, navigate, routeFor],
  )

  const next = useCallback(() => {
    // The last step closes the tour rather than dead-ending on a disabled
    // button, so there is always exactly one obvious way forward.
    if (currentStep >= TOUR_STEPS.length - 1) {
      setActive(false)
      setCurrentStep(-1)
      return
    }
    goTo(currentStep + 1)
  }, [currentStep, goTo])

  const back = useCallback(() => {
    if (currentStep > 0) goTo(currentStep - 1)
  }, [currentStep, goTo])

  const stop = useCallback(() => {
    setActive(false)
    setCurrentStep(-1)
  }, [])

  const value = useMemo(
    () => ({
      active,
      currentStep,
      steps: TOUR_STEPS,
      preparing,
      start: () => void start(),
      next,
      back,
      stop,
    }),
    [active, currentStep, preparing, start, next, back, stop],
  )

  return <DemoTourContext.Provider value={value}>{children}</DemoTourContext.Provider>
}

export function useDemoTour(): DemoTourValue {
  const context = useContext(DemoTourContext)
  if (context === null) throw new Error('useDemoTour must be used inside DemoTourProvider')
  return context
}
