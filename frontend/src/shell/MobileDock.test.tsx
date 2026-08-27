import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { MobileDock } from './MobileDock.js'

afterEach(cleanup)

describe('MobileDock patient navigation', () => {
  it('leads with registration rather than an unfiled consultation', () => {
    render(
      <MemoryRouter>
        <MobileDock />
      </MemoryRouter>,
    )

    const links = screen.getAllByRole('link').map((link) => link.textContent?.trim())
    expect(links).toEqual(['Register', 'Patients', 'Consultations', 'Guidelines'])
  })
})
