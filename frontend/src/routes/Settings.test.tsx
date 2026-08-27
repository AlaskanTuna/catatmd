import { RETENTION_DEFAULT_YEARS } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings.js'

// The theme control is not what this file is about, and the real provider reads
// `window.matchMedia`, which jsdom does not implement.
vi.mock('../lib/theme.js', () => ({
  useTheme: () => ({ resolved: 'light', setPreference: vi.fn() }),
}))

vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js')
  return {
    ApiError: actual.ApiError,
    api: {
      session: vi.fn(async () => ({
        user: { id: 'u1', email: 'doctor@example.test', name: 'Doctor' },
      })),
      listConsultations: vi.fn(async () => []),
      fixtures: vi.fn(async () => []),
    },
  }
})

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

let stored: number | null = null
let fetchMock: ReturnType<typeof vi.fn>

afterEach(cleanup)

beforeEach(() => {
  stored = null
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      stored = (JSON.parse(String(init.body)) as { adoptedYears: number | null }).adoptedYears
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ retention: { adoptedYears: stored } }),
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
})

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const periodField = () => screen.getByLabelText(/retention period, in years/i) as HTMLInputElement

/**
 * The point of the control is that "not yet adopted" and "adopted at N years"
 * are visibly different states. A screen that showed the default as though it
 * were the policy would report a decision the data controller has not made,
 * which is the one failure this feature exists to prevent.
 */
describe('the retention period', () => {
  it('marks an unreviewed account as not yet adopted, and seeds the field with the default', async () => {
    setup()

    expect(await screen.findByText(/not yet adopted/i)).toBeTruthy()
    expect(screen.getByText(/awaiting review, not the current policy/i)).toBeTruthy()
    expect(periodField().value).toBe(String(RETENTION_DEFAULT_YEARS))
    // The default is a starting value in the field, never a reported decision.
    expect(screen.queryByText(/records are kept for/i)).toBeNull()
  })

  it('reports an adopted period as adopted', async () => {
    stored = 10
    setup()

    expect(await screen.findByText(/records are kept for/i)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('10 years')
    expect(screen.queryByText(/not yet adopted\./i)).toBeNull()
  })

  it('states that nothing enforces the period yet', async () => {
    setup()

    expect(
      await screen.findByText(/no retention job, no automatic expiry, and no deletion sweep/i),
    ).toBeTruthy()
  })

  it('adopts the entered period', async () => {
    setup()
    await screen.findByText(/not yet adopted/i)

    fireEvent.change(periodField(), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /adopt period/i }))

    await waitFor(() => expect(stored).toBe(12))
    expect(await screen.findByText(/records are kept for/i)).toBeTruthy()
  })

  it('returns an adopted period to unadopted rather than to a number', async () => {
    stored = 7
    setup()
    await screen.findByText(/records are kept for/i)

    fireEvent.click(screen.getByRole('button', { name: /mark as not adopted/i }))

    await waitFor(() => expect(stored).toBeNull())
    expect(await screen.findByText(/not yet adopted/i)).toBeTruthy()
  })

  it('offers no way to unadopt an account that never adopted', async () => {
    setup()
    await screen.findByText(/not yet adopted/i)

    expect(screen.queryByRole('button', { name: /mark as not adopted/i })).toBeNull()
  })

  it('refuses a fractional or out-of-range period at the control', async () => {
    setup()
    await screen.findByText(/not yet adopted/i)

    for (const value of ['0', '7.5', '51', '']) {
      fireEvent.change(periodField(), { target: { value } })

      expect(screen.getByRole('button', { name: /adopt period/i }).hasAttribute('disabled')).toBe(
        true,
      )
      expect(screen.getByText(/whole number of years between 1 and 50/i)).toBeTruthy()
    }
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'PATCH')).toBe(true)
  })
})
