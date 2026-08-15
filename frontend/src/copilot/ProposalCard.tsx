import type { CopilotProposal } from '@shared/types'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/Button.js'

/**
 * The permission gate, as the doctor experiences it (GitHub issue #169).
 *
 * **This card is the control, not a confirmation of one.** Nothing the copilot
 * proposes touches the record until a button here is pressed; the model has no
 * write tool and no way to reach the database. That is what lets a copilot read
 * an untrusted transcript safely: the worst a prompt injection can achieve is a
 * card the doctor declines.
 *
 * Two consequences for how it renders:
 *
 * **The full change is shown, never summarised.** A doctor approving "a small
 * wording fix" they cannot see is not consenting to anything. The replacement
 * text is displayed in full, which is also why the proposal carries whole
 * sections rather than diffs.
 *
 * **A dismissal cannot be approved until the doctor has typed a reason**, and
 * the reason is theirs. The copilot may open this dialog; it may not write the
 * justification for setting a safety signal aside.
 */
export function ProposalCard({
  proposal,
  onApply,
  onResolve,
}: {
  proposal: CopilotProposal
  onApply: (proposal: CopilotProposal, reason?: string) => Promise<void>
  onResolve: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const dismissing = proposal.tool !== 'edit_note_section' && proposal.state === 'dismissed'
  const blocked = dismissing && reason.trim().length === 0

  const apply = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onApply(proposal, dismissing ? reason.trim() : undefined)
      onResolve()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-card border border-accent/30 bg-surface p-3">
      <p className="font-medium text-ink text-xs">{headline(proposal)}</p>

      {proposal.tool === 'edit_note_section' ? (
        <p className="whitespace-pre-wrap rounded-control bg-sunken px-2.5 py-2 text-ink text-sm">
          {proposal.text}
        </p>
      ) : (
        <p className="rounded-control bg-sunken px-2.5 py-2 text-ink text-sm">
          Record as <strong>{proposal.state.replace(/_/g, ' ')}</strong>.
          {/* Stated on the card rather than assumed. "Dismissed" reads like
              "removed" to anyone who has not read the schema. */}
          <span className="mt-1 block text-ink-muted text-xs">
            The item stays on the record either way. This notes your decision about it.
          </span>
        </p>
      )}

      <p className="text-ink-muted text-xs">{proposal.rationale}</p>

      {dismissing && (
        <div className="space-y-1">
          <label
            htmlFor="catatai-dismiss-reason"
            className="flex items-center gap-1.5 text-ink text-xs"
          >
            <AlertTriangle aria-hidden className="size-3.5 text-urgent" />
            Your reason for dismissing, in your own words
          </label>
          <textarea
            id="catatai-dismiss-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-control border border-line bg-surface px-2.5 py-2 text-ink text-sm placeholder:text-ink-muted focus:border-accent focus:outline-none"
            placeholder="Required. This is recorded against the consultation."
          />
        </div>
      )}

      {failed && (
        <p role="alert" className="text-emergency text-xs">
          That change could not be saved. Nothing was applied.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={apply} loading={busy} disabled={blocked}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={onResolve} disabled={busy}>
          Discard
        </Button>
        {blocked && <span className="text-ink-muted text-xs">A reason is required.</span>}
      </div>
    </div>
  )
}

function headline(proposal: CopilotProposal): string {
  switch (proposal.tool) {
    case 'edit_note_section':
      return `Proposed change to ${proposal.section}`
    case 'set_red_flag_disposition':
      return `Proposed decision on red flag ${proposal.redFlagId}`
    case 'set_gap_disposition':
      return `Proposed decision on ${proposal.gapId}`
  }
}
