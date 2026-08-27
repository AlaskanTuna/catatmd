import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarIsland } from './SidebarIsland.js'

afterEach(cleanup)

describe('SidebarIsland patient navigation', () => {
  it('places Patients above Consultations without removing New Consultation', () => {
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
    expect(screen.getByRole('link', { name: 'New Consultation' })).toBeTruthy()
  })
})
