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
