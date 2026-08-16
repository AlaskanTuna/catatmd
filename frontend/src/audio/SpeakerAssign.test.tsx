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

function setup(draft: DraftLine[] = DRAFT, canInsertPlain = true) {
  const handlers = {
    onToggle: vi.fn(),
    onReplace: vi.fn(),
    onSwapAll: vi.fn(),
    onApply: vi.fn(),
    onInsertPlain: vi.fn(),
  }
  render(<SpeakerAssign draft={draft} canInsertPlain={canInsertPlain} {...handlers} />)
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
    fireEvent.click(screen.getByRole('button', { name: /append as plain/i }))
    expect(onSwapAll).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onInsertPlain).toHaveBeenCalledTimes(1)
  })

  it('hints a measured mishear and reports the corrected line on tap, touching nothing else', () => {
    const { onReplace, onToggle } = setup([
      { id: 'seg-0', speaker: 'patient', text: 'Patut sudah empat hari.' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Replace Patut with Batuk' }))
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledWith('seg-0', 'Batuk sudah empat hari.')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders no correction chip on lines without a lexicon hit', () => {
    setup()
    expect(screen.queryByRole('button', { name: /^replace /i })).toBeNull()
  })

  it('renders an independently tappable chip per occurrence of one mishear', () => {
    const { onReplace } = setup([
      { id: 'seg-0', speaker: 'patient', text: 'patut pagi, patut malam' },
    ])
    const chips = screen.getAllByRole('button', { name: 'Replace patut with batuk' })
    expect(chips).toHaveLength(2)
    fireEvent.click(chips[1] as HTMLElement)
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledWith('seg-0', 'patut pagi, batuk malam')
  })
})

/*
 * Appending unlabelled text is only ever a continuation: the parser folds a
 * line with no prefix into the turn above it and drops it when there is none.
 * Offered on an empty transcript it produced zero turns and disabled Start
 * Consultation, so the doctor blocked themselves with the button beside the
 * one that works.
 */
describe('the plain-text control', () => {
  it('is hidden when there is no turn for the text to join', () => {
    setup(DRAFT, false)
    expect(screen.queryByRole('button', { name: /plain text/i })).toBeNull()
  })

  it('is offered once the transcript already has a turn', () => {
    setup(DRAFT, true)
    expect(screen.getByRole('button', { name: /plain text/i })).toBeTruthy()
  })
})

/*
 * A span the server could not label arrives with a placeholder speaker and
 * `undrafted` set. Rendering it as Doctor or Patient would be exactly the
 * fabricated attribution the server refuses to send.
 */
describe('an unlabelled span', () => {
  const MIXED: DraftLine[] = [
    { id: 'a', speaker: 'doctor', text: 'What brings you in?' },
    { id: 'b', speaker: 'doctor', text: 'batuk sudah tiga hari', undrafted: true },
  ]

  it('is not shown as a drafted label', () => {
    setup(MIXED)
    expect(screen.getByRole('button', { name: /needs a label/i })).toBeTruthy()
  })

  it('says how many lines still need a speaker', () => {
    setup(MIXED)
    expect(screen.getByText(/1 line could not be labelled/i)).toBeTruthy()
  })

  it('still shows the text, so no speech is hidden behind the marker', () => {
    setup(MIXED)
    expect(screen.getByText(/batuk sudah tiga hari/)).toBeTruthy()
  })

  it('reports the tap so the caller can resolve it', () => {
    const handlers = setup(MIXED)
    fireEvent.click(screen.getByRole('button', { name: /needs a label/i }))
    expect(handlers.onToggle).toHaveBeenCalledWith('b')
  })

  it('says nothing about unlabelled lines when every line is drafted', () => {
    setup([{ id: 'a', speaker: 'doctor', text: 'What brings you in?' }])
    expect(screen.queryByText(/could not be labelled/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /needs a label/i })).toBeNull()
  })
})
