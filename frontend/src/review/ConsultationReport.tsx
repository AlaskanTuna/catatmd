import type { ConsultationDetail } from '@shared/types'
import { Wordmark } from '../ui/Wordmark.js'
import { flagEntries, prescriptionRows, reportSections } from './report-data.js'

const dateFormat = new Intl.DateTimeFormat('en-MY', { dateStyle: 'long' })
const timestampFormat = new Intl.DateTimeFormat('en-MY', {
  dateStyle: 'long',
  timeStyle: 'short',
})

const PROVENANCE =
  'This note was drafted with AI assistance using consultation information and approved by the named clinician, who remains responsible for all clinical decisions.'

/**
 * The printed artefact for an approved consultation: a document, not a
 * filtered screen (issue #376). Print correctness used to depend on twenty
 * `data-print="hide"` attributes staying in sync with the review layout, and
 * what survived still read as a DOM dump. This component is the entire DOM of
 * its own route, so `window.print()` can only ever emit the report.
 *
 * It renders structure only — every visual property lives on the pinned
 * `report-*` classes in `index.css`.
 */
export function ConsultationReport({ detail }: { detail: ConsultationDetail }) {
  const sections = reportSections(detail)
  const rows = prescriptionRows(detail.prescriptions ?? [])
  const flags = flagEntries(detail)

  /*
   * No app colour tokens may appear here: text-ink, bg-surface and friends
   * invert under [data-theme='dark'], and a doctor printing from a dark-mode
   * session would export a dark page. The pinned report-* classes carry the
   * sheet's own palette instead.
   */
  return (
    <article>
      <header className="report-letterhead">
        <Wordmark />
        <h1 className="report-kind">Consultation Report</h1>
      </header>

      <section className="report-meta mb-12">
        <div>
          <p className="report-meta-label">Patient</p>
          <p className="report-meta-value">{detail.patient?.name ?? 'Not recorded'}</p>
        </div>
        <div>
          <p className="report-meta-label">Consultation Date</p>
          <p className="report-meta-value">{dateFormat.format(detail.createdAt)}</p>
        </div>
        <div>
          <p className="report-meta-label">Record Reference</p>
          <p className="report-meta-value">{detail.id}</p>
        </div>
      </section>

      <section>
        <dl>
          {sections.map((section) => (
            <div className="report-field" key={section.key}>
              <dt className="report-field-label">{section.label}</dt>
              <dd className="report-prose whitespace-pre-line">{section.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {rows.length > 0 && (
        <section className="mt-8">
          <h2 className="report-block-heading">Prescriptions</h2>
          {/* A real <table>: its thead must resolve to display:
              table-header-group so the column headings repeat when the table
              crosses a page break — divs cannot do that. */}
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Drug</th>
                <th scope="col">Dose</th>
                <th scope="col">Directions</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.position}>
                  <td>{row.position}</td>
                  <td>{row.drug}</td>
                  <td>{row.dose}</td>
                  <td>{row.directions}</td>
                  <td>{row.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {flags.length > 0 && (
        <section className="mt-8">
          <h2 className="report-block-heading">Clinical Safety Review</h2>
          {/* Every flag renders in flagEntries' severity order, undisposed ones
              included — silently dropping an unreviewed safety finding is the
              failure this section exists to prevent. */}
          {flags.map((entry) => (
            <div
              className="report-flag mt-6 grid grid-cols-[40mm_1fr] gap-x-[6mm]"
              key={entry.flag.id}
            >
              <span className="report-flag-severity">{entry.flag.severity}</span>
              <div>
                <p className="report-flag-label">{entry.flag.label}</p>
                <blockquote className="report-evidence mt-1">{entry.flag.evidence}</blockquote>
                <p className="report-disposition mt-1">{entry.disposition}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="report-approval mt-8">
        <p className="report-meta-label">Approved By</p>
        <p>{detail.approvedBy ?? '—'}</p>
        <p className="report-disposition mt-1">
          {detail.approvedAt === null ? '—' : timestampFormat.format(detail.approvedAt)}
        </p>
        <div className="report-signature-rule mt-10">Signature</div>
      </section>

      <footer className="report-footer mt-8">
        <p>{PROVENANCE}</p>
        <p>
          CatatMD · Generated {timestampFormat.format(new Date())} · Record {detail.id}
        </p>
      </footer>
    </article>
  )
}
