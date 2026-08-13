import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select.js'

/*
 * The keyboard contract, not the styling.
 *
 * This control is hand-rolled rather than taken from a headless library, which
 * means every behaviour a native `<select>` would have given for free is now
 * ours to keep working. Issue #30 requires a complete keyboard path through the
 * app, so these are the cases that would strand a keyboard user if they broke:
 * opening without a mouse, moving between options, committing a choice, and
 * getting focus back afterwards.
 */

const OPTIONS = [
  { value: 'all', label: 'All Publishers' },
  { value: 'moh', label: 'Ministry of Health Malaysia' },
  { value: 'mfp', label: 'Malaysian Family Physician' },
]

// vitest runs without `globals`, so RTL's automatic cleanup is not wired up.
afterEach(cleanup)

function setup(value = 'all') {
  const onChange = vi.fn()
  render(<Select label="Filter by publisher" value={value} options={OPTIONS} onChange={onChange} />)
  return { onChange, trigger: screen.getByRole('button') }
}

describe('Select', () => {
  it('names itself and its current value without a visible label', () => {
    const { trigger } = setup()
    const labelId = trigger.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId as string)?.textContent).toBe('Filter by publisher')
    expect(trigger.textContent).toContain('All Publishers')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on Enter and lands focus on the option already selected', () => {
    const { trigger } = setup('moh')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // Not the top of the list: the first arrow press should move from where the
    // user already is.
    expect(document.activeElement?.textContent).toContain('Ministry of Health Malaysia')
  })

  it('opens on ArrowDown, so the list is reachable without committing to Enter', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('marks exactly one option as selected', () => {
    setup('mfp')
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toContain('Malaysian Family Physician')
  })

  it('moves focus with the arrow keys and wraps at both ends', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const list = screen.getByRole('listbox')

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toContain('Ministry of Health Malaysia')

    // Wrapping matters: a list that silently stops moving reads as broken.
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toContain('Malaysian Family Physician')
  })

  it('jumps to the ends with Home and End', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const list = screen.getByRole('listbox')

    fireEvent.keyDown(list, { key: 'End' })
    expect(document.activeElement?.textContent).toContain('Malaysian Family Physician')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(document.activeElement?.textContent).toContain('All Publishers')
  })

  it('commits a choice on Enter, closes, and hands focus back to the trigger', () => {
    const { trigger, onChange } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('moh')
    expect(screen.queryByRole('listbox')).toBeNull()
    // Leaving focus on the body is the failure that strands a keyboard user.
    expect(document.activeElement).toBe(trigger)
  })

  it('abandons on Escape without changing the value', () => {
    const { trigger, onChange } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on an outside pointer press', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
