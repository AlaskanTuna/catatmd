import type {
  ClinicalAssertion,
  ClinicalFacts,
  EvidenceLink,
  OperationalBlock,
} from '@shared/types'
import { Maximize2, Quote } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { timestamp } from '../lib/clock.js'
import { cn } from '../lib/cn.js'
import { AssertionStateBadge } from '../ui/AssertionState.js'
import { Card } from '../ui/Card.js'

/** Field keys are camelCase in the contract; doctors do not read camelCase. */
const humanise = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

/*
 * One fixed four-track grid for every row: label, value, badge, evidence.
 * `auto` on the badge track sizes it to the badge and can never squeeze it,
 * which is the failure the old flex row kept hitting (a badge-only row once
 * overflowed by 21px, a valued one by 169px). `minmax(0, …)` on the two text
 * tracks lets labels and values wrap instead of truncating, and the fixed
 * evidence track holds its width whether the row has a link or not, so
 * badges keep the same right edge.
 */
const ROW_GRID =
  'grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_1.5rem] items-center gap-x-3'

/**
 * One checklist row, and its evidence when the field has any (issue #10, AC7).
 *
 * **The trace is on checklist fields rather than on note sentences, and that is
 * a property of the pipeline rather than a shortcut.** The note and the facts
 * are two independent model calls over the same transcript; the note is
 * generated prose and is not composed from the facts, so no sentence in it
 * carries a link back to a span and none can be recovered afterwards. Matching
 * sentences to the transcript by similarity would manufacture provenance, and a
 * wrong evidence link is worse than an absent one because it lends borrowed
 * authority to a line nobody verified.
 *
 * What a field does carry is real: the span the evidence check already matched
 * against the de-identified transcript.
 *
 * A row with no link is inert rather than a button that does nothing, so the
 * affordance itself tells you which fields are traceable. `NOT_ASSESSED` fields
 * have none by construction, which is the correct and expected case.
 */
function ChecklistRow({
  label,
  assertion,
  link,
}: {
  label: string
  assertion: ClinicalAssertion
  link?: EvidenceLink
}) {
  const [open, setOpen] = useState(false)

  const summary = (
    <>
      <dt className="min-w-0 break-words text-sm text-ink">{label}</dt>
      {/* `dd` is `display: contents` so its value and badge can occupy their
          own row tracks while staying a single definition element; the tests
          count exactly one `dd` per row. The conditional `min-w-0` is the
          contract the overflow-regression tests pin, not working CSS: a
          contents box has no width to floor. */}
      <dd className={cn('contents', assertion.value && 'min-w-0')}>
        <span className="min-w-0 break-words text-xs text-ink-muted">{assertion.value}</span>
        <AssertionStateBadge state={assertion.state} className="justify-self-end" />
      </dd>
    </>
  )

  // A row with no evidence is inert rather than a button that does nothing, so
  // the affordance itself says which fields are traceable. The padding matches
  // the interactive row exactly, or the two would sit at different heights and
  // the list would look ragged for a reason the reader cannot see.
  if (!link) {
    return (
      <div className={cn(ROW_GRID, 'border-b border-line/60 px-2 py-2 last:border-0')}>
        {summary}
        {/* The evidence track renders even when empty, so the badge column
            keeps the same right edge on rows that have no link. */}
        <span className="h-6" />
      </div>
    )
  }

  return (
    <div className="min-w-0 border-b border-line/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        /* `w-full`, not the old `-mx-2 w-[calc(100%+1rem)]` hover bleed. That
           made every interactive row 1rem wider than its grid cell, so the
           checklist's own content set the panel's scroll width and the review
           column grew a horizontal scrollbar. The inert row above carries the
           same `px-2` instead, so the two still align. */
        className={cn(
          ROW_GRID,
          'group w-full rounded-control px-2 py-2 text-left transition-colors hover:bg-sunken-soft',
        )}
      >
        {summary}
        <span className="flex h-6 items-center justify-center">
          <Quote
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-accent transition-opacity',
              open ? 'opacity-100' : 'opacity-45 group-hover:opacity-100',
            )}
          />
          <span className="sr-only">Show the transcript source for {label}</span>
        </span>
      </button>

      {/*
        A tinted block rather than a left rule. `border-l-2` on a quotation is
        the side-tab pattern `impeccable detect` flags, and the accent tint
        separates the evidence from the row above it without adding an edge that
        competes with the row separators.
      */}
      {open && (
        <div className="mt-1 mb-2 rounded-control bg-accent-soft px-3 py-2.5">
          {/*
           * Speaker and timing are omitted when the span could not be located in
           * exactly one turn, or when the transcript carries no timings at all.
           * Saying so is the point: a missing offset must never render as 0:00,
           * which would assert the finding came from the opening seconds.
           */}
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">
            {link.speaker ? (
              <>
                {link.speaker === 'doctor' ? 'Doctor' : 'Patient'}
                {link.offsetSeconds !== undefined && ` · ${timestamp(link.offsetSeconds)}`}
              </>
            ) : (
              'Source not resolvable to a single turn'
            )}
          </p>
          <p className="mt-1 text-sm text-ink">&ldquo;{link.evidence}&rdquo;</p>
        </div>
      )}
    </div>
  )
}

const CLINICAL_FACT_GROUPS: { key: keyof ClinicalFacts; prefix: string }[] = [
  { key: 'symptoms', prefix: 'clinicalFacts.symptoms' },
  { key: 'history', prefix: 'clinicalFacts.history' },
  { key: 'observations', prefix: 'clinicalFacts.observations' },
  { key: 'examination', prefix: 'clinicalFacts.examination' },
]

const CHECKLIST_SECTION_ORDER = [
  'presentingComplaint',
  'historyOfPresentingComplaint',
  'pastMedicalHistory',
  'socialHistory',
  'familyHistory',
  'objective',
  'assessment',
  'plan',
] as const

type ChecklistSection = (typeof CHECKLIST_SECTION_ORDER)[number]

type ChecklistEntry = {
  section: ChecklistSection
  field: string
  assertion: ClinicalAssertion
  fieldId: string
}

const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
  presentingComplaint: 'Presenting Complaint',
  historyOfPresentingComplaint: 'History of Presenting Complaint',
  pastMedicalHistory: 'Past Medical History',
  socialHistory: 'Social History',
  familyHistory: 'Family History',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
}

/** Project extraction fields into the local canonical record view. */
function sectionForFieldId(fieldId: string): ChecklistSection {
  if (
    fieldId === 'clinicalFacts.symptoms.cough' ||
    fieldId === 'clinicalFacts.symptoms.soreThroat'
  ) {
    return 'presentingComplaint'
  }
  if (fieldId.startsWith('clinicalFacts.symptoms.')) return 'historyOfPresentingComplaint'
  if (fieldId.startsWith('clinicalFacts.history.')) {
    return fieldId.endsWith('.smoking') || fieldId.endsWith('.recentInfectionExposure')
      ? 'socialHistory'
      : 'pastMedicalHistory'
  }
  if (
    fieldId.startsWith('clinicalFacts.observations.') ||
    fieldId.startsWith('clinicalFacts.examination.')
  ) {
    return 'objective'
  }
  if (fieldId === 'operational.diagnosis') return 'assessment'
  return 'plan'
}

/**
 * The 29-field checklist plus the operational block, shown rather than
 * summarised.
 *
 * This panel is the visible half of `docs/prd.md` §10. The fixed key set exists
 * so a field the consultation never touched surfaces as *unestablished* rather
 * than vanishing, and that guarantee is worth nothing if the UI renders only
 * the fields that came back filled. So every key is listed, including and
 * especially the ones that are `NOT_ASSESSED`.
 *
 * §21.1 measured a model fabricating "denies haemoptysis" on a transcript that
 * never mentioned it, in 5 of 5 runs. A doctor who can see `haemoptysis: not
 * assessed` can catch that class of error. A doctor reading four paragraphs of
 * prose cannot.
 */
export function ChecklistPanel({
  clinicalFacts,
  operational,
  evidenceLinks,
}: {
  clinicalFacts?: ClinicalFacts
  operational?: OperationalBlock
  evidenceLinks?: EvidenceLink[]
}) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const linkFor = (fieldId: string) => evidenceLinks?.find((entry) => entry.fieldId === fieldId)

  /*
   * Guarded because jsdom implements neither `showModal` nor `close` (the same
   * pattern as ConsultationReview's conversation dialog). The `open`
   * attribute is what the UA stylesheet keys on, so the fallback still lifts
   * the body out of `display: none` and into the accessibility tree, which is
   * the part of the difference a test can see.
   */
  useEffect(() => {
    if (!open) return
    const node = dialog.current
    if (!node) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    closeButton.current?.focus()
  }, [open])

  // Absence is not the same as "nothing was assessed", and conflating the two
  // would state the precise falsehood §10 exists to prevent.
  if (!clinicalFacts || !operational) {
    return (
      <Card className="mt-5 p-4">
        <h2 className="text-sm font-semibold">Completeness Checklist</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Not recorded for this consultation. It was analysed by an earlier version that did not
          persist the checklist. This does not mean the fields were assessed and found absent.
        </p>
      </Card>
    )
  }

  const entries: ChecklistEntry[] = []
  for (const { key, prefix } of CLINICAL_FACT_GROUPS) {
    for (const [field, assertion] of Object.entries(
      clinicalFacts[key] as Record<string, ClinicalAssertion>,
    )) {
      const fieldId = `${prefix}.${field}`
      entries.push({ section: sectionForFieldId(fieldId), field, assertion, fieldId })
    }
  }
  for (const [field, assertion] of Object.entries(operational)) {
    if (field === 'medicationsDispensed') continue
    const fieldId = `operational.${field}`
    entries.push({
      section: sectionForFieldId(fieldId),
      field,
      assertion: assertion as ClinicalAssertion,
      fieldId,
    })
  }
  const assessed = entries.filter((entry) => entry.assertion.state !== 'NOT_ASSESSED').length

  return (
    <>
      {/*
       * The screen surface is a card-shaped button; the checklist itself lives
       * in the dialog below. `aria-label` pins the accessible name because the
       * visible content also carries the count, which is not part of the name.
       */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Completeness Checklist"
        data-tour="checklist"
        data-print="hide"
        className="mt-5 flex w-full items-center gap-3 rounded-card bg-surface p-4 text-left shadow-card transition-colors hover:bg-sunken-soft"
      >
        <span className="flex-1 text-sm font-semibold">Completeness Checklist</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {assessed} of {entries.length} established
        </span>
        <Maximize2 aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </button>

      {/*
       * The single checklist body stays mounted inside the closed dialog:
       * `[data-print='block']` lifts it out of `display: none` for print,
       * where the checklist is the evidence that the fields were checked, and
       * a collapsed panel in a clinical document is just an omission. The
       * fixed screen height, the absolute positioning a `<dialog>` carries by
       * default, and the scroller's overflow cap would all silently truncate
       * that evidence on paper, so the `print:` utilities flatten all three.
       */}
      {/*
       * `open:flex` rather than `flex`: author display outranks the UA rule
       * `dialog:not([open]) { display: none }`, so a bare `flex` would leave
       * the closed dialog painted on the page. `overflow-hidden` leaves the
       * inner scroller as the only scrollbar; the print utilities still
       * flatten the shell on paper.
       */}
      <dialog
        ref={dialog}
        data-print="block"
        onClose={() => setOpen(false)}
        aria-labelledby={titleId}
        className="glass-panel m-auto h-[min(85vh,48rem)] w-[min(56rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-float p-0 text-ink open:flex open:flex-col backdrop:bg-scrim backdrop:backdrop-blur-sm print:static print:h-auto print:max-h-none print:overflow-visible"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2
            id={titleId}
            className="font-display text-lg font-semibold flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2"
          >
            <span>Completeness Checklist</span>
            <span aria-hidden className="text-sm font-normal tabular-nums text-ink-muted">
              {assessed} of {entries.length} established
            </span>
          </h2>
          {/* `ui/Button` does not forward a ref, and this is the button the
              open effect focuses, so it is a plain element in Button's
              `neutral`/`sm` styling. */}
          <button
            ref={closeButton}
            type="button"
            data-print="hide"
            onClick={() => dialog.current?.close()}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-control border border-line bg-sunken-soft px-3 text-xs font-medium text-ink shadow-raised transition-colors duration-150 ease-out-quart hover:bg-sunken active:scale-[0.97]"
          >
            Close
          </button>
        </div>
        {/*
         * `@container`, so the two-column grid below reads the scroller's own
         * rendered width rather than the viewport's. `sm:grid-cols-2` is a
         * media query: on an ordinary 1280px laptop viewport it is always
         * true, whatever width the review page has actually left this panel.
         * Rows no longer truncate, so each one needs its badge and evidence
         * tracks plus enough left over for wrapped labels and values to stay
         * readable; the container query switches only once the scroller has
         * genuinely earned the room.
         */}
        <div className="@container min-h-0 flex-1 overflow-y-auto bg-sunken p-6 print:overflow-visible">
          <div className="flex flex-col gap-4">
            {CHECKLIST_SECTION_ORDER.map((section) => {
              const sectionEntries = entries.filter((entry) => entry.section === section)
              const medications = section === 'plan' ? operational.medicationsDispensed : []
              if (sectionEntries.length === 0 && medications.length === 0) return null

              return (
                <section
                  key={section}
                  className="rounded-card border border-line bg-surface p-4 page-break-avoid"
                >
                  <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {CHECKLIST_SECTION_LABELS[section]}
                  </h3>
                  <dl className="mt-1 grid gap-x-10 @[640px]:grid-cols-2">
                    {sectionEntries.map(({ field, fieldId, assertion }) => (
                      <ChecklistRow
                        key={fieldId}
                        label={humanise(field)}
                        assertion={assertion}
                        link={linkFor(fieldId)}
                      />
                    ))}
                  </dl>
                  {medications.length > 0 && (
                    <p className="mt-2 text-sm text-ink">
                      <span className="text-ink-muted">Dispensed: </span>
                      {medications
                        .flatMap((medication) => (medication.value ? [medication.value] : []))
                        .join(', ')}
                    </p>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </dialog>
    </>
  )
}
