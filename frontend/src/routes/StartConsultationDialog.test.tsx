import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { StartConsultationDialog } from './StartConsultationDialog.js'

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    listPatients: vi.fn(),
    createConsultation: vi.fn(),
  },
}))

// jsdom ships `<dialog>` without its methods. Defined rather than spied, so the
// open state is real and Testing Library's default `hidden` filter behaves the
// way it does in a browser.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true
}
HTMLDialogElement.prototype.close = function close() {
  this.open = false
  this.dispatchEvent(new Event('close'))
}

const patient = (
  id: string,
  name: string,
  extra: Partial<{ lastSeenAt: string | null; consultationCount: number }> = {},
) => ({
  id,
  name,
  age: 34,
  gender: 'female' as const,
  erasedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  consultationCount: 2,
  lastSeenAt: '2026-08-20T00:00:00.000Z',
  ...extra,
})

const PATIENTS = [
  patient('older', 'Aisha Rahman', { lastSeenAt: '2026-08-10T00:00:00.000Z' }),
  patient('newest', 'Bala Krishnan', { lastSeenAt: '2026-08-26T00:00:00.000Z' }),
  patient('never', 'Chen Wei', { lastSeenAt: null, consultationCount: 0 }),
]

function Harness() {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>
        New Consultation
      </button>
      <StartConsultationDialog ref={ref} />
    </>
  )
}

function Where() {
  return <p>at {useLocation().pathname}</p>
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/consultations']}>
        <Routes>
          <Route path="/consultations" element={<Harness />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'New Consultation' }))
}

describe('starting a consultation from the consultation list', () => {
  beforeEach(() => {
    vi.mocked(api.listPatients).mockReset()
    vi.mocked(api.listPatients).mockResolvedValue(PATIENTS)
    vi.mocked(api.createConsultation).mockReset()
    vi.mocked(api.createConsultation).mockResolvedValue({
      id: 'consultation-9',
    } as Awaited<ReturnType<typeof api.createConsultation>>)
  })

  it('offers the two ways a visit can begin', () => {
    setup()

    expect(screen.getByRole('button', { name: /new patient/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /existing patient/i })).toBeTruthy()
  })

  it('sends registration to the patient form', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: /new patient/i }))

    expect(await screen.findByText('at /patients/new')).toBeTruthy()
  })

  /*
   * The point of the whole dialog. Picking a patient here has to *be* the
   * action; routing to their profile so the doctor can press Start again would
   * make this a slower version of the link it replaced.
   */
  it('files the consultation to the chosen patient and opens it', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: /existing patient/i }))
    fireEvent.click(await screen.findByRole('button', { name: /aisha rahman/i }))

    await waitFor(() => expect(api.createConsultation).toHaveBeenCalledWith(undefined, 'older'))
    expect(await screen.findByText('at /consultations/consultation-9')).toBeTruthy()
  })

  it('fetches no patients until the doctor says there is an existing one', async () => {
    setup()

    expect(api.listPatients).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /existing patient/i }))

    await waitFor(() => expect(api.listPatients).toHaveBeenCalled())
  })

  it('lists the most recently relevant patient first, never seen included', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /existing patient/i }))

    await screen.findByRole('button', { name: /bala krishnan/i })
    const names = screen
      .getAllByRole('button')
      .map((node) => node.textContent ?? '')
      .filter((text) => /rahman|krishnan|chen wei/i.test(text))

    // Bala was seen on the 26th, Aisha on the 10th. Chen has never been seen,
    // so registration on the 1st stands in and puts them last.
    expect(names[0]).toContain('Bala Krishnan')
    expect(names[1]).toContain('Aisha Rahman')
    expect(names[2]).toContain('Chen Wei')
  })

  it('narrows the list by name', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /existing patient/i }))
    await screen.findByRole('button', { name: /aisha rahman/i })

    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'chen' } })

    expect(screen.queryByRole('button', { name: /aisha rahman/i })).toBeNull()
    expect(screen.getByRole('button', { name: /chen wei/i })).toBeTruthy()
  })

  it('says so when nothing matches, rather than showing an empty box', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /existing patient/i }))
    await screen.findByRole('button', { name: /aisha rahman/i })

    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'zzz' } })

    expect(screen.getByText('No patient matches that search.')).toBeTruthy()
  })
})
