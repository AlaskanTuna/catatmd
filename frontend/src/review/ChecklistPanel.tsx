import type {
  ClinicalAssertion,
  ClinicalFacts,
  EvidenceLink,
  OperationalBlock,
} from '@shared/types'
import { ChevronRight, Quote } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.js'
import { AssertionStateBadge } from '../ui/AssertionState.js'
import { Card } from '../ui/Card.js'

/** Field keys are camelCase in the contract; doctors do not read camelCase. */
const humanise = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

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
      <dt className="min-w-0 truncate text-sm text-ink">{label}</dt>
      {/* `dd` used to be `shrink-0`, and the value span capped at a flat
          `max-w-[10rem]` (160px) regardless of how wide the row actually was.
          At the two-column checklist width a row can be as narrow as ~162px
          total, so a 160px value cap plus the badge next to it could not
          possibly fit, whatever else truncated correctly: the row overflowed
          by design, not by a missing `min-w-0` anywhere.
          `min-w-0` on `dd` is conditional on there being a value to truncate,
          not a constant, because the two shapes need opposite defaults.
          With a value: the span (`min-w-0 truncate`) has to be the one that
          absorbs the squeeze, and `dd` needs `min-w-0` too or its own
          intrinsic-size floor stays "badge plus the value's full width",
          overflowing exactly as before. Without a value, `dd` holds only the
          badge, which is `shrink-0` and must never truncate a clinical state
          word; there `dd`'s default (unset) minimum already floors correctly
          at the badge's own width, and adding `min-w-0` breaks that floor,
          letting the badge itself overflow instead. Both failure modes were
          measured directly against the built CSS before this was written:
          a badge-only row overflowed by 21px with `min-w-0` present, and a
          valued row overflowed by 169px with it absent. */}
      <dd className={cn('flex items-center gap-2', assertion.value && 'min-w-0')}>
        {assertion.value && (
          <span className="min-w-0 truncate text-xs text-ink-muted">{assertion.value}</span>
        )}
        <AssertionStateBadge state={assertion.state} />
      </dd>
    </>
  )

  // A row with no evidence is inert rather than a button that does nothing, so
  // the affordance itself says which fields are traceable. The padding matches
  // the interactive row exactly, or the two would sit at different heights and
  // the list would look ragged for a reason the reader cannot see.
  if (!link) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line/60 px-2 py-2 last:border-0">
        {summary}
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
        className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-sunken-soft"
      >
        {summary}
        <Quote
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-accent transition-opacity',
            open ? 'opacity-100' : 'opacity-45 group-hover:opacity-100',
          )}
        />
        <span className="sr-only">Show the transcript source for {label}</span>
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

const GROUPS: { key: keyof ClinicalFacts; label: string }[] = [
  { key: 'symptoms', label: 'Symptoms' },
  { key: 'history', label: 'History' },
  { key: 'observations', label: 'Observations' },
  { key: 'examination', label: 'Examination' },
]

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
  defaultOpen = false,
}: {
  clinicalFacts?: ClinicalFacts
  operational?: OperationalBlock
  evidenceLinks?: EvidenceLink[]
  /**
   * Open while the consultation is still being captured (#219). Collapsed is
   * right after the fact, when the note is the thing being read; during capture
   * this panel is the patient card, and a card nobody has expanded shows the
   * doctor nothing as it fills.
   */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const linkFor = (fieldId: string) => evidenceLinks?.find((entry) => entry.fieldId === fieldId)

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

  const entries = GROUPS.flatMap(({ key, label }) =>
    Object.entries(clinicalFacts[key] as Record<string, ClinicalAssertion>).map(
      ([field, assertion]) => ({ group: label, field, assertion }),
    ),
  )
  const assessed = entries.filter((entry) => entry.assertion.state !== 'NOT_ASSESSED').length

  return (
    /*
     * `@container`, so the two-column split below reads the panel's own
     * rendered width rather than the viewport's. `sm:grid-cols-2` is a media
     * query: on an ordinary 1280px laptop viewport it is always true, whatever
     * width the three-column review page has actually left this card, and this
     * card sits in the narrowest of the three. Measured against the real
     * rendered checklist: a two-column row can be squeezed to ~162-175px wide,
     * and a state badge alone needs roughly 90-98px non-negotiable width (it
     * must never truncate a clinical state word), so two columns simply cannot
     * fit in that space, no matter how aggressively the label and value
     * truncate. The container query switches to two columns only once the
     * card itself has genuinely earned the room.
     */
    <Card className="@container mt-5">
      {/*
       * The disclosure had no visual affordance at all. `aria-expanded` told a
       * screen reader it was expandable and nothing told anyone else, so the
       * panel read as a static header with a count beside it and the content
       * behind it was effectively undiscoverable.
       *
       * The chevron is the whole fix and it is deliberately the only addition:
       * it is the one control users already read as "this opens", it rotates
       * rather than swapping glyph so the state change is continuous, and it
       * needs no label because the heading beside it already names the thing.
       */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-card p-4 text-left transition-colors hover:bg-sunken-soft"
        data-tour="checklist"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ink-muted transition-transform duration-150 ease-out-quart',
            open && 'rotate-90',
          )}
        />
        <span className="flex-1 text-sm font-semibold">Completeness Checklist</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {assessed} of {entries.length} established
        </span>
      </button>

      {/* Rendered in print regardless of the on-screen toggle: the checklist is
          the evidence that the fields were checked, and a collapsed panel in a
          clinical document is just an omission. */}
      <div className={open ? 'block' : 'hidden'} data-print="block">
        {GROUPS.map(({ key, label }) => (
          <section key={key} className="border-t border-line px-4 py-4 page-break-avoid">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {label}
            </h3>
            <dl className="mt-1 grid gap-x-10 @[320px]:grid-cols-2">
              {Object.entries(clinicalFacts[key] as Record<string, ClinicalAssertion>).map(
                ([field, assertion]) => (
                  <ChecklistRow
                    key={field}
                    label={humanise(field)}
                    assertion={assertion}
                    link={linkFor(`clinicalFacts.${key}.${field}`)}
                  />
                ),
              )}
            </dl>
          </section>
        ))}

        <section className="border-t border-line px-4 py-4 page-break-avoid">
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Operational
          </h3>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 @[320px]:grid-cols-2">
            {/* Derived from the block itself rather than listed here.
                A hard-coded field id in a component is a clinical constant
                that no version stamp describes (issue #16's guard), and
                deriving it means a new field appears without a UI change. */}
            {Object.entries(operational)
              .filter(([field]) => field !== 'medicationsDispensed')
              .map(([field, assertion]) => (
                <ChecklistRow
                  key={field}
                  label={humanise(field)}
                  assertion={assertion as ClinicalAssertion}
                  link={linkFor(`operational.${field}`)}
                />
              ))}
          </dl>
          {operational.medicationsDispensed.length > 0 && (
            <p className="mt-2 text-sm text-ink">
              <span className="text-ink-muted">Dispensed: </span>
              {operational.medicationsDispensed
                .map((m) => m.value)
                .filter(Boolean)
                .join(', ')}
            </p>
          )}
        </section>
      </div>
    </Card>
  )
}
