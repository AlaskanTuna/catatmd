import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteTemplateSelector } from './NoteTemplateSelector.js'

afterEach(cleanup)

describe('NoteTemplateSelector', () => {
  it('exposes the selected template as an accessible two-option control', () => {
    render(<NoteTemplateSelector value="soap" saving={false} onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup', { name: 'Clinical note template' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'SOAP' }).getAttribute('aria-checked')).toBe('true')
    expect(
      screen.getByRole('radio', { name: 'Malaysian Medical Record' }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('requests persistence when the other template is selected', () => {
    const onChange = vi.fn()
    render(<NoteTemplateSelector value="soap" saving={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Malaysian Medical Record' }))

    expect(onChange).toHaveBeenCalledWith('malaysian')
  })

  it('disables both choices while persistence is in flight', () => {
    render(<NoteTemplateSelector value="soap" saving onChange={vi.fn()} />)

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'SOAP' }).disabled).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Malaysian Medical Record' }).disabled,
    ).toBe(true)
  })
})
