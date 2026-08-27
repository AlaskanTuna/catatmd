import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import toast from 'react-hot-toast'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../lib/api.js'
import { PatientList } from './PatientList.js'

vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js')
  return {
    ApiError: actual.ApiError,
    api: {
      listPatients: vi.fn(),
      erasePatient: vi.fn(),
    },
  }
})

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const PATIENTS = [
  {
    id: 'patient-1',
    name: 'Aisha Rahman',
    age: 36,
    gender: 'female' as const,
    erasedAt: null,
    createdAt: '2026-08-20T06:00:00.000Z',
    updatedAt: '2026-08-27T06:00:00.000Z',
    consultationCount: 2,
    lastSeenAt: '2026-08-26T06:00:00.000Z',
  },
  {
    id: 'patient-2',
    name: 'Kumar Nair',
    age: null,
    gender: null,
    erasedAt: null,
    createdAt: '2026-08-21T06:00:00.000Z',
    updatedAt: '2026-08-21T06:00:00.000Z',
    consultationCount: 0,
    lastSeenAt: null,
  },
]

afterEach(cleanup)

/*
 * jsdom 27 still ships `<dialog>` without `showModal` or `close`. The stand-ins
 * only need to move the `open` attribute, which is what makes the contents
 * visible to queries, and to fire `close`, which is what the acknowledgement
 * reset listens for.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

// File level rather than inside one describe, so the erase block below gets the
// same clean mocks. Nested in a single block, its call counts carried over from
// the block above and every count assertion read the previous test's total.
beforeEach(() => {
  vi.mocked(api.listPatients).mockReset()
  vi.mocked(api.listPatients).mockResolvedValue(PATIENTS)
  vi.mocked(api.erasePatient).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.success).mockReset()
})

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <PatientList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PatientList', () => {
  it('shows the patient directory columns without exposing NRIC', async () => {
    setup()

    expect(await screen.findByText('Aisha Rahman')).toBeTruthy()
    for (const heading of ['Name', 'Age', 'Gender', 'Visits', 'Last Seen']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy()
    }
    expect(screen.queryByRole('columnheader', { name: /nric/i })).toBeNull()
  })

  it('shows the latest visit date and distinguishes patients not yet seen', async () => {
    setup()

    const seen = await screen.findByRole('row', { name: /Aisha Rahman/ })
    const unseen = screen.getByRole('row', { name: /Kumar Nair/ })
    expect(within(seen).getByText('26 Aug 2026')).toBeTruthy()
    expect(within(unseen).getByText('Not seen yet')).toBeTruthy()
  })

  it('searches patients by name', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.change(screen.getByRole('searchbox', { name: /search patients/i }), {
      target: { value: 'kumar' },
    })

    expect(screen.queryByText('Aisha Rahman')).toBeNull()
    expect(screen.getByText('Kumar Nair')).toBeTruthy()
  })

  it('filters by whether a patient has visit history', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.click(screen.getByRole('button', { name: /filter by visit history/i }))
    fireEvent.click(screen.getByRole('option', { name: 'No Visits' }))

    expect(screen.queryByText('Aisha Rahman')).toBeNull()
    expect(screen.getByText('Kumar Nair')).toBeTruthy()
  })

  it('supports selecting several patient rows', async () => {
    setup()
    await screen.findByText('Aisha Rahman')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Aisha Rahman' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Kumar Nair' }))

    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(screen.getByText('Select all')).toBeTruthy())
  })
})

/**
 * Erasing a patient cascades to every consultation filed under them, so the
 * confirmation is the safety control rather than a formality. These pin the two
 * properties that make it one: it states the real blast radius by number, and
 * it cannot be actioned without an explicit acknowledgement.
 */
describe('erasing patients', () => {
  const openDialog = async (names: string[]) => {
    setup()
    await screen.findByText('Aisha Rahman')
    for (const name of names) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }))
    }
    fireEvent.click(screen.getByRole('button', { name: `Erase ${names.length}` }))
    return screen.getByRole('dialog')
  }

  const confirmButton = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /^Erase \d+$/ })

  const acknowledgement = (dialog: HTMLElement) =>
    within(dialog).getByRole('checkbox', { name: /I understand this erases/i })

  it('states the consultation blast radius, not just the patient count', async () => {
    const dialog = await openDialog(['Aisha Rahman', 'Kumar Nair'])

    // Two patients, but two consultations come with them. The second number is
    // the one a doctor would otherwise only discover afterwards.
    expect(within(dialog).getByText(/2 patient records\?/i)).toBeTruthy()
    expect(within(dialog).getByText(/2 consultations filed to those patients/i)).toBeTruthy()
  })

  it('says erased rather than deleted, and says the audit record survives', async () => {
    const dialog = await openDialog(['Aisha Rahman'])

    expect(within(dialog).getByText(/tamper-evident audit record/i)).toBeTruthy()
    expect(within(dialog).getByText(/cannot be removed/i)).toBeTruthy()
    expect(within(dialog).getByText(/This cannot be undone\./)).toBeTruthy()
    expect(within(dialog).queryByText(/delete/i)).toBeNull()
  })

  it('keeps the erase button inert until the acknowledgement is ticked', async () => {
    const dialog = await openDialog(['Aisha Rahman'])

    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(true)

    fireEvent.click(confirmButton(dialog))
    expect(api.erasePatient).not.toHaveBeenCalled()

    fireEvent.click(acknowledgement(dialog))
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(false)
  })

  it('clears the acknowledgement when the dialog is closed and reopened', async () => {
    // Otherwise a doctor who ticked, cancelled, then reopened for a different
    // selection would find a live destructive button already armed.
    const dialog = await openDialog(['Aisha Rahman'])
    fireEvent.click(acknowledgement(dialog))
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Erase 1' }))

    expect((acknowledgement(dialog) as HTMLInputElement).checked).toBe(false)
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(true)
  })

  it('erases the selection one request at a time', async () => {
    vi.mocked(api.erasePatient).mockImplementation(async (id: string) => ({
      patientId: id,
      erasedConsultationIds: id === 'patient-1' ? ['c1', 'c2'] : [],
    }))

    const dialog = await openDialog(['Aisha Rahman', 'Kumar Nair'])
    fireEvent.click(acknowledgement(dialog))
    fireEvent.click(confirmButton(dialog))

    await waitFor(() => expect(api.erasePatient).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.erasePatient).mock.calls.map(([id]) => id)).toEqual([
      'patient-1',
      'patient-2',
    ])
  })

  it('continues the run when one record fails, and reports the shortfall', async () => {
    vi.mocked(api.erasePatient).mockImplementation(async (id: string) => {
      if (id === 'patient-1') throw new ApiError(429, 'rate_limited', 'Too many erase requests.')
      return { patientId: id, erasedConsultationIds: [] }
    })

    const dialog = await openDialog(['Aisha Rahman', 'Kumar Nair'])
    fireEvent.click(acknowledgement(dialog))
    fireEvent.click(confirmButton(dialog))

    // The second record is still attempted: the first failing is no reason to
    // abandon it, and a partial outcome is reported as an error rather than a
    // success of one.
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(api.erasePatient).toHaveBeenCalledTimes(2)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/1 other could not be/i)
  })

  it('surfaces an error and stays open when nothing was erased', async () => {
    vi.mocked(api.erasePatient).mockRejectedValue(
      new ApiError(500, 'internal_error', 'Something went wrong.'),
    )

    const dialog = await openDialog(['Aisha Rahman'])
    fireEvent.click(acknowledgement(dialog))
    fireEvent.click(confirmButton(dialog))

    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(dialog.hasAttribute('open')).toBe(true)
  })
})
