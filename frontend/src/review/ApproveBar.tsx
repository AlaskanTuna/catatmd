import type { ConsultationDetail } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api.js'
import { Button } from '../ui/Button.js'

/**
 * The approval gate (#10, CAP-5).
 *
 * Two steps, not one. WCAG 2.2 error prevention asks for confirmation on legal
 * or medical commitments, and this is both: the doctor is taking responsibility
 * for a clinical record. Nothing auto-approves, nothing approves on a timer,
 * and the button is the only large filled accent element on the screen.
 *
 * Unacknowledged red flags do not *block* approval, and that is deliberate.
 * A doctor may legitimately approve a note while judging a flag not applicable,
 * and blocking would train them to clear flags reflexively to get past the
 * gate. The count is stated instead, so the choice is informed rather than
 * prevented.
 */
export function ApproveBar({
  approve: performApproval,
  approved,
  approvedAt,
  approvedBy,
  unacknowledgedCount,
  onApproved,
}: {
  /**
   * The approval transition itself, supplied by the caller.
   *
   * This component owns the *gate*: the two steps, the unacknowledged count,
   * the wording. It deliberately does not own where the approval lands. Demo
   * Mode's consultation is never stored (issue #80), so it approves in memory
   * while a real one approves over the API, and both must pass through this
   * same gate rather than one of them growing a second path around it.
   */
  approve: () => Promise<ConsultationDetail>
  approved: boolean
  approvedAt: Date | null
  approvedBy: string | null
  unacknowledgedCount: number
  onApproved: (next: ConsultationDetail) => void
}) {
  const [confirming, setConfirming] = useState(false)

  /*
   * Publishes this bar's footprint so floating chrome can sit above it.
   *
   * It is set here rather than inferred from the route, because the route
   * cannot tell the difference: an approved consultation renders the summary
   * below instead of this bar, and a FAB lifted by route match then floats
   * clear of nothing. Tying the offset to the bar's own lifetime makes it
   * correct in both states without either component importing the other.
   */
  const bar = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (approved) return
    const root = document.documentElement
    // Below `md` the button still sits above this bar, because the bar spans
    // the full width there and there is no corner to share.
    root.style.setProperty('--approve-bar-inset', '4rem')

    /*
     * From `md` up the button sits level with this bar instead, centred against
     * its height. Measured rather than assumed: the copy wraps to two lines at
     * narrow widths and while confirming, and a constant tuned against one line
     * leaves the two visibly out of line at two.
     */
    const element = bar.current
    const observer = element
      ? new ResizeObserver(([entry]) => {
          const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height
          if (height) root.style.setProperty('--approve-bar-height', `${height}px`)
        })
      : null
    if (element && observer) observer.observe(element)

    return () => {
      observer?.disconnect()
      root.style.removeProperty('--approve-bar-inset')
      root.style.removeProperty('--approve-bar-height')
    }
  }, [approved])

  const approve = useMutation({
    mutationFn: performApproval,
    onSuccess: (next) => {
      setConfirming(false)
      onApproved(next)
    },
  })

  if (approved) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-card border border-accent/30 bg-accent-soft px-4 py-3">
        <CheckCircle2 aria-hidden className="size-5 shrink-0 text-accent" />
        {/* The attribution is the point of the approval, not decoration on it,
            so it prints. Issue #26: an exported clinical document that cannot
            say whose it is undercuts the record it exists to produce. */}
        <p className="text-sm">
          <span className="font-medium text-accent">Approved</span>
          {approvedBy && <span className="text-ink"> by {approvedBy}</span>}
          {approvedAt && (
            <span className="text-ink-muted">
              {' '}
              on{' '}
              {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(
                approvedAt,
              )}
            </span>
          )}
          <span className="text-ink-muted">
            . This record is final and can no longer be edited.
          </span>
        </p>
      </div>
    )
  }

  return (
    <div
      ref={bar}
      /*
       * `md:mr-16` reserves the bottom-right corner for the floating button,
       * which is `right-6` and 3rem wide, so 4rem clears it with a gap. Without
       * it the two overlap on any viewport under roughly 86rem, where the
       * content column reaches `<main>`'s own `md:pr-6`.
       *
       * The island yields rather than the button moving, because the button is
       * chrome that belongs in the corner on every screen and this bar is the
       * only thing that ever contests it.
       */
      className="glass sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-float p-3 md:mr-16"
      style={{ zIndex: 'var(--z-sticky)' }}
      data-print="hide"
      data-tour="approve"
    >
      <div className="min-w-0">
        {confirming ? (
          <p className="text-sm font-medium">
            You are taking responsibility for this note. It cannot be edited afterwards.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            {unacknowledgedCount > 0
              ? `${unacknowledgedCount} red flag${unacknowledgedCount === 1 ? '' : 's'} not yet acknowledged.`
              : 'Reviewed and ready to sign off.'}
          </p>
        )}
        {approve.error && (
          <p role="alert" className="mt-1 text-sm text-emergency">
            {approve.error instanceof ApiError ? approve.error.message : 'Approval failed.'}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {confirming && (
          <Button onClick={() => setConfirming(false)} disabled={approve.isPending}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          loading={approve.isPending}
          onClick={() => (confirming ? approve.mutate() : setConfirming(true))}
        >
          {confirming ? 'Confirm Approval' : 'Approve Note'}
        </Button>
      </div>
    </div>
  )
}
