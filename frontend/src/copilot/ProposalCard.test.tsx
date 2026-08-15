import type { CopilotProposal } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProposalCard } from './ProposalCard.js'

/**
 * The permission gate as the doctor meets it (issue #169).
 *
 * The copilot has no write tool, so this card is the only thing standing
 * between a model-authored suggestion and the clinical record. These tests are
 * therefore about consent rather than about rendering: that the doctor can see
 * exactly what they are agreeing to, and that a dismissal cannot be waved
 * through without them saying why.
 */

afterEach(cleanup)

const EDIT: CopilotProposal = {
  tool: 'edit_note_section',
  section: 'plan',
  text: 'Review in 3 days if not improving.',
  rationale: 'The doctor asked for safety-netting.',
}

const DISMISS: CopilotProposal = {
  tool: 'set_red_flag_disposition',
  redFlagId: 'rf-1',
  state: 'dismissed',
  rationale: 'The doctor said this was addressed verbally.',
}

const ACKNOWLEDGE: CopilotProposal = {
  tool: 'set_red_flag_disposition',
  redFlagId: 'rf-1',
  state: 'acknowledged',
  rationale: 'Recording that you considered this.',
}

function setup(proposal: CopilotProposal) {
  const onApply = vi.fn(async () => {})
  const onResolve = vi.fn()
  render(<ProposalCard proposal={proposal} onApply={onApply} onResolve={onResolve} />)
  return { onApply, onResolve }
}

const applyButton = () => screen.getByRole('button', { name: /apply/i }) as HTMLButtonElement

describe('approving a note edit', () => {
  it('shows the replacement text in full rather than describing it', () => {
    // A doctor approving "a small wording fix" they cannot read has consented
    // to nothing. This is why proposals carry whole sections, not diffs.
    setup(EDIT)

    expect(screen.getByText('Review in 3 days if not improving.')).toBeTruthy()
  })

  it('applies only when the doctor presses Apply', async () => {
    const { onApply } = setup(EDIT)
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(applyButton())

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(EDIT, undefined))
  })

  it('discards without applying anything', () => {
    const { onApply, onResolve } = setup(EDIT)

    fireEvent.click(screen.getByRole('button', { name: /discard/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(onResolve).toHaveBeenCalled()
  })
})

describe('dismissing a red flag', () => {
  it('blocks Apply until the doctor has written a reason', () => {
    // The one disposition that discards a safety signal. The justification is
    // the doctor's, and the model structurally cannot supply it.
    setup(DISMISS)

    expect(applyButton().disabled).toBe(true)
    expect(screen.getByText(/a reason is required/i)).toBeTruthy()
  })

  it('sends the doctor typed reason, not anything from the model', () => {
    const { onApply } = setup(DISMISS)

    fireEvent.change(screen.getByLabelText(/your reason for dismissing/i), {
      target: { value: 'Symptom resolved before the consultation ended.' },
    })
    fireEvent.click(applyButton())

    expect(onApply).toHaveBeenCalledWith(DISMISS, 'Symptom resolved before the consultation ended.')
  })

  it('does not ask for a reason on an acknowledgement', () => {
    // A mandatory box on every decision trains people to type "n/a" until the
    // field means nothing, which is why the schema only requires one here.
    setup(ACKNOWLEDGE)

    expect(screen.queryByLabelText(/your reason for dismissing/i)).toBeNull()
    expect(applyButton().disabled).toBe(false)
  })

  it('tells the doctor the flag stays on the record either way', () => {
    // "Dismissed" reads like "removed" to anyone who has not read the schema.
    // Saying so on the card is the difference between recording a decision and
    // appearing to delete a safety signal.
    setup(DISMISS)

    expect(screen.getByText(/stays on the record either way/i)).toBeTruthy()
  })
})

describe('when applying fails', () => {
  it('says nothing was applied and leaves the card in place', async () => {
    const onApply = vi.fn(async () => {
      throw new Error('network')
    })
    const onResolve = vi.fn()
    render(<ProposalCard proposal={EDIT} onApply={onApply} onResolve={onResolve} />)

    fireEvent.click(applyButton())

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/nothing was applied/i),
    )
    // Not resolved: a card that vanished on failure would read as success.
    expect(onResolve).not.toHaveBeenCalled()
  })
})
