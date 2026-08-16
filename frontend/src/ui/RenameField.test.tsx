import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenameField } from './RenameField.js'

afterEach(cleanup)

function setup(value: string | null = null, defaultEditing = false) {
  const onSave = vi.fn()
  const onDone = vi.fn()
  render(
    <RenameField
      value={value}
      fallback="16 Aug, 09:30"
      label="Rename this consultation"
      onSave={onSave}
      onDone={onDone}
      defaultEditing={defaultEditing}
    />,
  )
  return { onSave, onDone }
}

const field = () => screen.getByLabelText('Rename this consultation') as HTMLInputElement

describe('renaming a record', () => {
  it('shows the fallback until the record has a name', () => {
    setup(null)
    expect(screen.getByText('16 Aug, 09:30')).toBeTruthy()
  })

  it('shows the name once it has one, and never the fallback beside it', () => {
    setup('Cough, sore throat')
    expect(screen.getByText('Cough, sore throat')).toBeTruthy()
    expect(screen.queryByText('16 Aug, 09:30')).toBeNull()
  })

  it('commits on Enter', () => {
    const { onSave } = setup('Old name')
    fireEvent.click(screen.getByRole('button', { name: 'Rename this consultation' }))
    fireEvent.change(field(), { target: { value: 'New name' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('New name')
  })

  it('discards on Escape, and saves nothing', () => {
    const { onSave, onDone } = setup('Old name')
    fireEvent.click(screen.getByRole('button', { name: 'Rename this consultation' }))
    fireEvent.change(field(), { target: { value: 'Typed then abandoned' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })

  /*
   * Blur cancels rather than commits. A mis-click landing outside the field
   * would otherwise save a half-typed name silently, and the tick is there to
   * be the deliberate act.
   */
  it('discards on blur rather than saving what was half typed', () => {
    const { onSave } = setup('Old name')
    fireEvent.click(screen.getByRole('button', { name: 'Rename this consultation' }))
    fireEvent.change(field(), { target: { value: 'Half typed' } })
    fireEvent.blur(field())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('clears the name when the field is emptied, matching what the API stores', () => {
    const { onSave } = setup('Old name')
    fireEvent.click(screen.getByRole('button', { name: 'Rename this consultation' }))
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('saves nothing when the name comes back unchanged', () => {
    const { onSave, onDone } = setup('Same name')
    fireEvent.click(screen.getByRole('button', { name: 'Rename this consultation' }))
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    // Still closes, or the row would be stuck in an editor that does nothing.
    expect(onDone).toHaveBeenCalled()
  })

  /*
   * The consultation list opens the field directly, because its rows are links
   * and the pencil has to live outside the anchor to be its own target.
   */
  it('opens straight into the input when the caller owns the pencil', () => {
    setup(null, true)
    expect(field()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rename this consultation' })).toBeNull()
  })

  it('bounds the input at the length the API accepts', () => {
    setup(null, true)
    expect(field().maxLength).toBe(120)
  })
})
