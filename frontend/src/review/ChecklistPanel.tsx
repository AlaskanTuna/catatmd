import type {
  ClinicalAssertion,
  ClinicalFacts,
  EvidenceLink,
  OperationalBlock,
} from '@shared/types'
import { Quote } from 'lucide-react'
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
      <dt className="text-sm text-ink">{label}</dt>
      <dd className="flex items-center gap-1.5">
        {assertion.value && <span className="text-xs text-ink-muted">{assertion.value}</span>}
        <AssertionStateBadge state={assertion.state} />
      </dd>
    </>
  )

  if (!link) {
    return <div className="flex items-baseline justify-between gap-2">{summary}</div>
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 rounded-control text-left transition-colors hover:bg-sunken"
      >
        {summary}
        <Quote
          aria-hidden
          className={cn('size-3 shrink-0 self-center text-accent', open && 'opacity-60')}
        />
        <span className="sr-only">Show the transcript source for {label}</span>
      </button>

      {open && (
        <div className="mt-1 mb-1.5 rounded-control border-l-2 border-accent/40 bg-sunken px-2.5 py-2">
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
}: {
  clinicalFacts?: ClinicalFacts
  operational?: OperationalBlock
  evidenceLinks?: EvidenceLink[]
}) {
  const [open, setOpen] = useState(false)
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
    <Card className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
        data-tour="checklist"
      >
        <span className="text-sm font-semibold">Completeness Checklist</span>
        <span className="text-xs text-ink-muted">
          {assessed} of {entries.length} established
        </span>
      </button>

      {/* Rendered in print regardless of the on-screen toggle: the checklist is
          the evidence that the fields were checked, and a collapsed panel in a
          clinical document is just an omission. */}
      <div className={open ? 'block' : 'hidden'} data-print="block">
        {GROUPS.map(({ key, label }) => (
          <section key={key} className="border-t border-line px-4 py-3 page-break-avoid">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {label}
            </h3>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
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

        <section className="border-t border-line px-4 py-3 page-break-avoid">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Operational
          </h3>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
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
