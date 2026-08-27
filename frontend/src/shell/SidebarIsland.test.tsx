import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarIsland } from './SidebarIsland.js'

afterEach(cleanup)

describe('SidebarIsland patient navigation', () => {
  it('leads with registration and offers no unfiled consultation shortcut', () => {
    render(
      <MemoryRouter>
        <SidebarIsland onExpandedChange={vi.fn()} />
      </MemoryRouter>,
    )

    const patients = screen.getByRole('link', { name: 'Patients' })
    const consultations = screen.getByRole('link', { name: 'Consultations' })
    expect(patients.compareDocumentPosition(consultations) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    /*
     * A consultation started from the navigation belongs to nobody: it cannot
     * be filed and cannot be found again by patient. The shortcut existed
     * because there was no other way to create one; keeping it after patient
     * records shipped would offer the orphan path beside the correct one.
     */
    expect(screen.queryByRole('link', { name: 'New Consultation' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Register Patient' })).toBeTruthy()
  })
})

/**
 * The sidebar reported the doctor as being in two places at once: `/patients/new`
 * is a child of `/patients`, so a prefix match lit Register Patient and Patients
 * together. Exact-only would have fixed that and broken the detail pages, which
 * should keep their section lit. Most specific wins does both.
 */
describe('which sidebar item a path lights up', () => {
  const current = (at: string) => {
    cleanup()
    render(
      <MemoryRouter initialEntries={[at]}>
        <SidebarIsland onExpandedChange={vi.fn()} />
      </MemoryRouter>,
    )
    return screen
      .getAllByRole('link')
      .filter((node) => node.getAttribute('aria-current') === 'page')
      .map((node) => node.textContent?.trim())
  }

  it('lights only the more specific item on a child route', () => {
    expect(current('/patients/new')).toEqual(['Register Patient'])
  })

  it.each([
    ['/patients', 'Patients'],
    ['/consultations', 'Consultations'],
    ['/guidelines', 'Guidelines'],
  ])('lights %s as %s', (at, label) => {
    expect(current(at)).toEqual([label])
  })

  it.each([
    ['/patients/abc123', 'Patients'],
    ['/consultations/abc123', 'Consultations'],
  ])('keeps the section lit on %s', (at, label) => {
    expect(current(at)).toEqual([label])
  })
})
