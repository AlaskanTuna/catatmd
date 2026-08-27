import type { Disposition, RedFlag } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RedFlagCard } from './SafetyCards.js'

/**
 * The disposition control shows two buttons at rest rather than three.
 *
 * What matters is that reducing the resting state did not reduce what the
 * doctor can do. All three decisions must stay reachable, the alternatives must
 * expand in place rather than hide behind a menu that could fail to open, and
 * dismissing must still demand a reason — that last one is a clinical-safety
 * property, not a form nicety.
 */

const FLAG: RedFlag = {
  id: 'rf-1',
  ruleId: 'exertional-dyspnoea',
  severity: 'urgent',
  label: 'Exertional Breathlessness',
  evidence: 'rasa sesak bila naik tangga',
  source: 'rule',
}

afterEach(cleanup)

function renderCard(disposition?: Disposition) {
  const onDecide = vi.fn()
  render(<RedFlagCard flag={FLAG} disposition={disposition} onDecide={onDecide} />)
  return onDecide
}

describe('RedFlagCard disposition control', () => {
  it('shows one primary action and one disclosure at rest', () => {
    renderCard()

    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /more options/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^dismiss$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /not applicable/i })).toBeNull()
  })

  it('acknowledges without needing the disclosure', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))

    expect(onDecide).toHaveBeenCalledWith({ id: 'rf-1', state: 'acknowledged' })
  })

  it('keeps both alternatives one press away', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))

    expect(screen.getByRole('button', { name: /^dismiss$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /not applicable/i })).toBeTruthy()
  })

  it('marks the disclosure as expanded for assistive technology', () => {
    renderCard()
    const toggle = screen.getByRole('button', { name: /more options/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(
      screen.getByRole('button', { name: /fewer options/i }).getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('records not-applicable through the disclosure', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /not applicable/i }))

    expect(onDecide).toHaveBeenCalledWith({ id: 'rf-1', state: 'not_applicable' })
  })

  it('still demands a reason before a dismissal is recorded', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }))

    // The reason field appears and nothing has been decided yet.
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('never offers a decision control once one has been recorded', () => {
    renderCard({
      id: 'rf-1',
      state: 'acknowledged',
      decidedAt: new Date('2026-08-27T06:00:00.000Z'),
    })

    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
  })
})
