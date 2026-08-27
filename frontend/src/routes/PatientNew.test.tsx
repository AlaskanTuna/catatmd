import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { PatientNew } from './PatientNew.js'

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    createPatient: vi.fn(),
  },
}))

const CREATED_PATIENT = {
  id: 'patient-1',
  name: 'Aisha Rahman',
  nric: '900101-14-5678',
  age: 36,
  gender: 'female' as const,
  erasedAt: null,
  createdAt: '2026-08-27T06:00:00.000Z',
  updatedAt: '2026-08-27T06:00:00.000Z',
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/patients/new']}>
        <Routes>
          <Route path="/patients/new" element={<PatientNew />} />
          <Route path="/patients/:id" element={<p>Patient profile opened</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PatientNew', () => {
  beforeEach(() => {
    vi.mocked(api.createPatient).mockReset()
    vi.mocked(api.createPatient).mockResolvedValue(CREATED_PATIENT)
  })

  it('autofocuses the required name field for reception', () => {
    setup()

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(document.activeElement).toBe(name)
    expect(name.required).toBe(true)
  })

  it('registers all supplied fields and opens the patient profile', async () => {
    setup()

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Aisha Rahman' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'NRIC' }), {
      target: { value: '900101-14-5678' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Age' }), {
      target: { value: '36' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gender' }))
    fireEvent.click(screen.getByRole('option', { name: 'Female' }))
    fireEvent.click(screen.getByRole('button', { name: 'Register Patient' }))

    await waitFor(() =>
      expect(api.createPatient).toHaveBeenCalledWith({
        name: 'Aisha Rahman',
        nric: '900101-14-5678',
        age: 36,
        gender: 'female',
      }),
    )
    expect(await screen.findByText('Patient profile opened')).toBeTruthy()
  })

  it('submits from Enter without requiring a wizard step', async () => {
    setup()

    const name = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'Kumar Nair' } })
    fireEvent.keyDown(name, { key: 'Enter' })

    await waitFor(() => expect(api.createPatient).toHaveBeenCalledWith({ name: 'Kumar Nair' }))
  })

  it('does not submit the patient twice while registration is pending', async () => {
    vi.mocked(api.createPatient).mockImplementation(() => new Promise(() => {}))
    setup()

    const name = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'Kumar Nair' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.keyDown(name, { key: 'Enter', repeat: true })

    await waitFor(() => expect(api.createPatient).toHaveBeenCalledTimes(1))
  })

  it('keeps reception on the form when the name is blank', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Register Patient' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Enter the patient name.')
    expect(api.createPatient).not.toHaveBeenCalled()
  })
})
