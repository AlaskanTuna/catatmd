import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftLine } from './draft-turns.js'
import { SpeakerAssign } from './SpeakerAssign.js'

// vitest runs without `globals`, so RTL's automatic cleanup is not wired up.
afterEach(cleanup)

const DRAFT: DraftLine[] = [
  { id: 'seg-0', speaker: 'doctor', text: 'Any fever?', offsetSeconds: 0 },
  { id: 'seg-1', speaker: 'patient', text: 'Yesterday quite hot.', offsetSeconds: 2.1 },
]

function setup() {
  const handlers = {
    onToggle: vi.fn(),
    onSwapAll: vi.fn(),
    onApply: vi.fn(),
    onInsertPlain: vi.fn(),
  }
  render(<SpeakerAssign draft={DRAFT} {...handlers} />)
  return handlers
}

describe('SpeakerAssign', () => {
  it('shows every line with its current label and timestamp', () => {
    setup()
    expect(screen.getByText('Any fever?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Doctor, switch to Patient' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Patient, switch to Doctor' })).toBeTruthy()
    expect(screen.getByText('0:02')).toBeTruthy()
  })

  it('reports the toggled line by id, and only that line', () => {
    const { onToggle } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Patient, switch to Doctor' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('seg-1')
  })

  it('wires the bulk actions', () => {
    const { onSwapAll, onApply, onInsertPlain } = setup()
    fireEvent.click(screen.getByRole('button', { name: /swap all/i }))
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    fireEvent.click(screen.getByRole('button', { name: /insert as plain/i }))
    expect(onSwapAll).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onInsertPlain).toHaveBeenCalledTimes(1)
  })
})
