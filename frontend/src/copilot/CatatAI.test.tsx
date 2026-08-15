import type { ConsultationDetail } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatatAI } from './CatatAI.js'

/**
 * The copilot's demo mode, as the guided tour meets it (issue #179).
 *
 * The tour's consultation is never stored (#80), so the copilot route would
 * 404 on every message. The tour still has to teach that CatatAI exists, and
 * `HelpButton` promises the user that nothing is mocked or replayed. Demo mode
 * is the resolution: the real panel, genuinely inactive, saying so.
 *
 * These tests are therefore about what the panel must NOT do. The route is
 * reached by `fetch`, so a stub that fails the test on any call is the pin
 * that matters most.
 */

afterEach(cleanup)

/** CatatAI reads only `id`; the rest of the detail is irrelevant to it. */
const CONSULTATION = { id: 'demo-ephemeral' } as unknown as ConsultationDetail

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the demo panel must never reach the copilot route')
  })
  vi.stubGlobal('fetch', fetchSpy)
  // jsdom ships HTMLDialogElement without its methods, and the expanded state
  // is a real <dialog>. These define rather than spy.
  HTMLDialogElement.prototype.close = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPanel(demo: boolean) {
  const onApply = vi.fn(async () => {})
  render(<CatatAI consultation={CONSULTATION} onApply={onApply} demo={demo} />)
  return { onApply }
}

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /open catatai/i }))

describe('the tour anchor', () => {
  it('renders in demo mode, so the coachmark has something to point at', () => {
    renderPanel(true)
    // A coachmark aimed at an element that does not exist is the failure the
    // tour's own subject scoring exists to prevent.
    expect(document.querySelector('[data-tour="catatai"]')).not.toBeNull()
  })
})

describe('the demo panel', () => {
  it('offers no composer, so there is nothing that can send a message', () => {
    renderPanel(true)
    openPanel()

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull()
  })

  it('offers no suggestion chips, which would also post to the route', () => {
    renderPanel(true)
    openPanel()

    expect(screen.getByText(/available on a saved consultation/i)).toBeTruthy()
  })

  it('never calls the copilot route while open', () => {
    renderPanel(true)
    openPanel()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('labels itself inactive inside the panel, not only in the coachmark', () => {
    renderPanel(true)
    openPanel()

    // Someone who opens this without the tour text in view still learns why
    // it is not answering.
    expect(screen.getByText(/inactive during the tour/i)).toBeTruthy()
    expect(screen.getByText(/scripted conversation/i)).toBeTruthy()
  })

  it('still teaches the three claims the tour step makes', () => {
    renderPanel(true)
    openPanel()

    expect(screen.getByText(/reads the consultation as it stands/i)).toBeTruthy()
    expect(screen.getByText(/proposes changes/i)).toBeTruthy()
    expect(screen.getByText(/cannot approve a note/i)).toBeTruthy()
  })

  it('cannot be expanded into a modal that hides the tour behind a backdrop', () => {
    renderPanel(true)
    openPanel()

    expect(screen.queryByRole('button', { name: /expand the panel/i })).toBeNull()
  })

  it('still closes, so the tour is never left with a panel it cannot dismiss', () => {
    renderPanel(true)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: /close catatai/i }))

    expect(screen.getByRole('button', { name: /open catatai/i })).toBeTruthy()
  })
})

/*
 * The contrast case. Without it these tests would still pass if `demo` were
 * ignored and the composer had simply been deleted for everyone.
 */
describe('the real panel', () => {
  it('keeps its composer and its expand control', () => {
    renderPanel(false)
    openPanel()

    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: /expand the panel/i })).toBeTruthy()
    expect(screen.queryByText(/inactive during the tour/i)).toBeNull()
  })
})
