import type { ConsultationDetail } from '@shared/types'
import { ConsultationDetailSchema } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { DEMO_CONSULTATION_ID } from '../demo/DemoTour.js'
import { api } from '../lib/api.js'
import { ConsultationReport } from '../review/ConsultationReport.js'
import { Button } from '../ui/Button.js'
import { Skeleton } from '../ui/Card.js'

/**
 * The printed artefact's own route, deliberately outside `AppShell` (#376).
 *
 * Export used to be `window.print()` against the review screen, with fidelity
 * attempted by subtraction: roughly twenty `data-print="hide"` attributes and a
 * `@media print` block hiding chrome. What survived was still the three-column
 * review layout — transcript rail, safety rail and textareas included — which
 * is why the output read as a screenshot of an app rather than a clinical
 * document.
 *
 * Rendering the report on its own route inverts that. The page's entire DOM is
 * the document, so printing it correctly no longer depends on twenty
 * attributes staying in step with the layout.
 */
export function ConsultationReportPage() {
  const { id = '' } = useParams()
  const location = useLocation()

  const isEphemeral = id === DEMO_CONSULTATION_ID

  /*
   * Demo Mode's consultation is never stored (issue #80), so there is no row
   * to fetch and `getConsultation` would 404 on an id no database holds. The
   * review screen holds it in memory via `DemoTourProvider`, which lives inside
   * `AppShell` — a provider this route sits outside of by design. So the review
   * screen hands the record over in history state instead of this route
   * reaching for a context it cannot see.
   *
   * Re-parsed rather than trusted: history state is structured-cloned by the
   * History API and survives a `Date`, but it is still data arriving from
   * outside this component, and every boundary in this codebase is a Zod
   * boundary. `z.coerce.date()` also means a serialising router would not
   * silently hand the report a string where it expects a timestamp.
   */
  const handed = ConsultationDetailSchema.safeParse(
    (location.state as { detail?: unknown } | null)?.detail,
  )

  const consultation = useQuery({
    queryKey: ['consultation', id],
    queryFn: () => api.getConsultation(id),
    enabled: !isEphemeral,
  })

  if (isEphemeral) {
    // Reached by reload or a pasted link, which loses the handover. The record
    // only ever existed in the tab that left, so there is nothing to render.
    if (!handed.success) return <Navigate to={`/consultations/${id}`} replace />
    if (handed.data.status !== 'approved') {
      return <Navigate to={`/consultations/${id}`} replace />
    }
    return <Report detail={handed.data} id={id} />
  }

  if (consultation.isPending) {
    return (
      <div className="report-viewport">
        <div className="mx-auto w-[210mm] max-w-full px-4">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    )
  }

  const detail = consultation.data
  if (!detail) return <Navigate to="/consultations" replace />

  /*
   * Approval is what makes the note final and the document worth issuing, so
   * an unapproved consultation has no report to show and is sent back to the
   * screen where it can be approved. The guard is here rather than in the
   * document component so the component stays a pure render of a record.
   */
  if (detail.status !== 'approved') return <Navigate to={`/consultations/${id}`} replace />

  return <Report detail={detail} id={id} />
}

function Report({ detail, id }: { detail: ConsultationDetail; id: string }) {
  return (
    <div className="report-viewport">
      {/* The only app-like element on the route, and the only one that must not
          reach the paper. */}
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-4 px-4 print:hidden">
        <Link
          to={`/consultations/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-accent"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to Review
        </Link>
        <Button
          variant="primary"
          size="lg"
          icon={<Printer aria-hidden className="size-4" />}
          onClick={() => window.print()}
        >
          Print
        </Button>
      </div>

      <div className="report-sheet">
        <ConsultationReport detail={detail} />
      </div>
    </div>
  )
}
