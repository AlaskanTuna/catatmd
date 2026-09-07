import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsultationSettingsDialog } from './ConsultationSettingsDialog.js'

afterEach(cleanup)

function openDialog(
  overrides: Partial<React.ComponentProps<typeof ConsultationSettingsDialog>> = {},
) {
  const ref = createRef<HTMLDialogElement>()
  const onSave = vi.fn()
  render(
    <ConsultationSettingsDialog
      ref={ref}
      noteTemplate="soap"
      captureMode="manual"
      captureModeLocked={false}
      saving={false}
      error={null}
      onSave={onSave}
      {...overrides}
    />,
  )
  act(() => ref.current?.setAttribute('open', ''))
  return { ref, onSave }
}

describe('ConsultationSettingsDialog', () => {
  it('saves only the consultation settings that changed', () => {
    const { onSave } = openDialog()

    expect(screen.getByRole('radio', { name: 'SOAP' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Malaysian Medical Record' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Ambient' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Press To Record' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Malaysian Medical Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ambient' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledWith({ noteTemplate: 'malaysian', captureMode: 'ambient' })
  })

  it('locks Capture Mode after transcript capture while leaving layout available', () => {
    openDialog({ captureModeLocked: true })

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Ambient' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Press To Record' }).disabled).toBe(
      true,
    )
    expect(screen.getByText(/locked once a transcript exists/i)).toBeTruthy()
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Malaysian Medical Record' }).disabled,
    ).toBe(false)
  })

  it('keeps a failed save open and presents the error inline', () => {
    const { ref } = openDialog({ error: 'That change could not be saved.' })

    expect(screen.getByRole('alert').textContent).toContain('That change could not be saved.')
    expect(ref.current?.hasAttribute('open')).toBe(true)
  })
})
