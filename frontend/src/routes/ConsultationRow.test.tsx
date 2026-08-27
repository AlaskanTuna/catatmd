import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsultationRow } from './ConsultationRow.js'

afterEach(cleanup)

describe('ConsultationRow', () => {
  it('uses the opaque accent token for selection', () => {
    const { container } = render(
      <MemoryRouter>
        <ConsultationRow
          selected
          consultation={{
            id: 'consultation-1',
            status: 'draft',
            title: 'Draft visit',
            createdAt: new Date('2026-08-27T06:00:00.000Z'),
            updatedAt: new Date('2026-08-27T06:00:00.000Z'),
          }}
        />
      </MemoryRouter>,
    )

    const row = container.firstElementChild
    expect(row?.className).toContain('bg-accent-soft')
    expect(row?.className).not.toContain('from-accent/')
  })
})
