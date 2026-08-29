import {
  type ClinicalAssertion,
  type ClinicalFacts,
  type EvidenceLink,
  type OperationalBlock,
  RECORD_SECTION_LABELS,
  RECORD_SECTION_ORDER,
  type RecordSection,
  recordSectionForFieldId,
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
      <dd className="flex shrink-0 items-center gap-2">
        {assertion.value && (
          <span className="max-w-[10rem] truncate text-xs text-ink-muted">{assertion.value}</span>
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
      <div className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0">
        {summary}
      </div>
    )
  }

  return (
    <div className="border-b border-line/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-sunken-soft"
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

const CLINICAL_FACT_GROUPS: { key: keyof ClinicalFacts; prefix: string }[] = [
  { key: 'symptoms', prefix: 'clinicalFacts.symptoms' },
  { key: 'history', prefix: 'clinicalFacts.history' },
  { key: 'observations', prefix: 'clinicalFacts.observations' },
  { key: 'examination', prefix: 'clinicalFacts.examination' },
]

function checklistEntries(clinicalFacts: ClinicalFacts, operational: OperationalBlock) {
  const rows: {
    section: RecordSection
    field: string
    label: string
    assertion: ClinicalAssertion
    fieldId: string
  }[] = []

  for (const { key, prefix } of CLINICAL_FACT_GROUPS) {
    for (const [field, assertion] of Object.entries(
      clinicalFacts[key] as Record<string, ClinicalAssertion>,
    )) {
      const fieldId = `${prefix}.${field}`
      rows.push({
        section: recordSectionForFieldId(fieldId),
        field,
        label: humanise(field),
        assertion,
        fieldId,
      })
    }
  }

  for (const [field, assertion] of Object.entries(operational)) {
    if (field === 'medicationsDispensed') continue
    const fieldId = `operational.${field}`
    rows.push({
      section: recordSectionForFieldId(fieldId),
      field,
      label: humanise(field),
      assertion: assertion as ClinicalAssertion,
      fieldId,
    })
  }

  return rows
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

  const rows = checklistEntries(clinicalFacts, operational)
  const assessed = rows.filter((entry) => entry.assertion.state !== 'NOT_ASSESSED').length

  return (
    <Card className="mt-5">
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
          {assessed} of {rows.length} established
        </span>
      </button>

      {/* Rendered in print regardless of the on-screen toggle: the checklist is
          the evidence that the fields were checked, and a collapsed panel in a
          clinical document is just an omission. */}
      <div className={open ? 'block' : 'hidden'} data-print="block">
        {RECORD_SECTION_ORDER.map((section) => {
          const sectionRows = rows.filter((row) => row.section === section)
          if (sectionRows.length === 0) return null

          return (
            <section key={section} className="border-t border-line px-4 py-4 page-break-avoid">
              <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {RECORD_SECTION_LABELS[section]}
              </h3>
              <dl className="mt-1 grid gap-x-10 sm:grid-cols-2">
                {sectionRows.map(({ label, assertion, fieldId }) => (
                  <ChecklistRow
                    key={fieldId}
                    label={label}
                    assertion={assertion}
                    link={linkFor(fieldId)}
                  />
                ))}
              </dl>
            </section>
          )
        })}

        {operational.medicationsDispensed.length > 0 && (
          <section className="border-t border-line px-4 py-4 page-break-avoid">
            <p className="text-sm text-ink">
              <span className="text-ink-muted">Dispensed: </span>
              {operational.medicationsDispensed
                .map((m) => m.value)
                .filter(Boolean)
                .join(', ')}
            </p>
          </section>
        )}
      </div>
    </Card>
  )
}
