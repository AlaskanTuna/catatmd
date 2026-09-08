import type { ConsultationDetail } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApproveBar } from './ApproveBar.js'

afterEach(cleanup)

const NEXT = {} as ConsultationDetail

const renderApproveBar = (unacknowledgedCount = 0) => {
  const approve = vi.fn().mockResolvedValue(NEXT)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApproveBar
        approve={approve}
        approved={false}
        approvedAt={null}
        approvedBy={null}
        unacknowledgedCount={unacknowledgedCount}
        onApproved={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return approve
}

describe('ApproveBar contextual guidance', () => {
  it('keeps the unacknowledged-red-flag tip inside the approval action boundary', () => {
    renderApproveBar(2)

    const approve = screen.getByRole('button', { name: 'Approve Note' })
    const tip = screen.getByRole('button', {
      name: '2 red flags not yet acknowledged',
    })
    const wrapper = approve.parentElement

    expect(tip.parentElement?.parentElement).toBe(wrapper)
    expect(wrapper?.className).toContain('relative')
    expect(wrapper?.className).toContain('inline-flex')
    expect(approve.contains(tip)).toBe(false)
  })

  it('keeps approval confirmation as a two-step action with sibling guidance', async () => {
    const approve = renderApproveBar()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Note' }))

    const confirm = screen.getByRole('button', { name: 'Confirm Approval' })
    const tip = screen.getByRole('button', { name: 'What approving does' })
    expect(tip.parentElement?.parentElement).toBe(confirm.parentElement)
    expect(confirm.contains(tip)).toBe(false)

    fireEvent.click(confirm)
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1))
  })

  it('states that approval is final, in the tip the doctor opens', async () => {
    renderApproveBar()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Note' }))
    fireEvent.click(screen.getByRole('button', { name: 'What approving does' }))

    expect(
      await screen.findByText('Approval finalises this note. It cannot be edited later.'),
    ).toBeTruthy()
  })

  it('states the outstanding count and that approval is still allowed', async () => {
    renderApproveBar(2)

    fireEvent.click(screen.getByRole('button', { name: '2 red flags not yet acknowledged' }))

    expect(
      await screen.findByText('2 red flags still need review. You can still approve.'),
    ).toBeTruthy()
  })

  it('does not show contextual guidance when approval has nothing to explain', () => {
    renderApproveBar()

    expect(screen.queryByRole('button', { name: 'What approving does' })).toBeNull()
    expect(screen.queryByRole('button', { name: /not yet acknowledged/ })).toBeNull()
  })
})
