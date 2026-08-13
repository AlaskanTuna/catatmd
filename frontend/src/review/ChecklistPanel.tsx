import type { ClinicalAssertion, ClinicalFacts, OperationalBlock } from '@shared/types'
import { useState } from 'react'
import { AssertionStateBadge } from '../ui/AssertionState.js'
import { Card } from '../ui/Card.js'

/** Field keys are camelCase in the contract; doctors do not read camelCase. */
const humanise = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

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
}: {
  clinicalFacts?: ClinicalFacts
  operational?: OperationalBlock
}) {
  const [open, setOpen] = useState(false)

  // Absence is not the same as "nothing was assessed", and conflating the two
  // would state the precise falsehood §10 exists to prevent.
  if (!clinicalFacts || !operational) {
    return (
      <Card className="mt-5 p-4">
        <h2 className="text-sm font-semibold">Completeness checklist</h2>
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
        <span className="text-sm font-semibold">Completeness checklist</span>
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
                  <div key={field} className="flex items-baseline justify-between gap-2">
                    <dt className="text-sm text-ink">{humanise(field)}</dt>
                    <dd className="flex items-center gap-1.5">
                      {assertion.value && (
                        <span className="text-xs text-ink-muted">{assertion.value}</span>
                      )}
                      <AssertionStateBadge state={assertion.state} />
                    </dd>
                  </div>
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
            {(
              [
                ['diagnosis', operational.diagnosis],
                ['mcDays', operational.mcDays],
                ['referral', operational.referral],
                ['followUp', operational.followUp],
              ] as const
            ).map(([field, assertion]) => (
              <div key={field} className="flex items-baseline justify-between gap-2">
                <dt className="text-sm text-ink">{humanise(field)}</dt>
                <dd className="flex items-center gap-1.5">
                  {assertion.value && (
                    <span className="text-xs text-ink-muted">{assertion.value}</span>
                  )}
                  <AssertionStateBadge state={assertion.state} />
                </dd>
              </div>
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
