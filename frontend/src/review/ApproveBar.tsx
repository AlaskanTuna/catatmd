import type { ConsultationDetail } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { InfoTip } from '../ui/InfoTip.js'

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

  /*
   * The action group, rendered in the page header rather than in a floating
   * island at the foot of the screen.
   *
   * The island was pinned there so it could not be missed, which it achieved by
   * covering the bottom of all three columns and needing its own inset variable
   * so the floating chrome could dodge it. Under the consultation title it is
   * seen without contesting anything, and it sits with the record it approves.
   *
   * The status line the island carried becomes a tooltip, and only when it has
   * something to say. "Reviewed and ready to sign off." restated the enabled
   * button beside it; an unacknowledged count does not, so that is what
   * survives. It stays an advisory rather than a block for the reason above:
   * blocking trains a doctor to clear flags reflexively to get past the gate.
   */
  return (
    <div className="flex flex-wrap items-center gap-2" data-print="hide" data-tour="approve">
      {confirming && (
        <Button onClick={() => setConfirming(false)} disabled={approve.isPending}>
          Cancel
        </Button>
      )}
      <div className="relative inline-flex">
        <Button
          variant="primary"
          size="lg"
          className={cn((confirming || unacknowledgedCount > 0) && 'pr-12')}
          loading={approve.isPending}
          onClick={() => (confirming ? approve.mutate() : setConfirming(true))}
        >
          {confirming ? 'Confirm Approval' : 'Approve Note'}
        </Button>

        {confirming ? (
          <InfoTip
            className="absolute top-1/2 right-2 -translate-y-1/2"
            label="What approving does"
            layered
          >
            Approval finalises this note. It cannot be edited later.
          </InfoTip>
        ) : (
          unacknowledgedCount > 0 && (
            <InfoTip
              className="absolute top-1/2 right-2 -translate-y-1/2"
              label={`${unacknowledgedCount} red flag${unacknowledgedCount === 1 ? '' : 's'} not yet acknowledged`}
              tone="warning"
              layered
            >
              {`${unacknowledgedCount} red flag${unacknowledgedCount === 1 ? ' still needs' : 's still need'} review. You can still approve.`}
            </InfoTip>
          )
        )}
      </div>

      {approve.error && (
        <p role="alert" className="w-full text-sm text-emergency">
          {approve.error instanceof ApiError ? approve.error.message : 'Approval failed.'}
        </p>
      )}
    </div>
  )
}
