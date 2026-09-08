import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampPage, Pagination, paginate } from './Pagination.js'

afterEach(cleanup)

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('disables the edge control and reports the position', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />)
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    const previous = screen.getByRole('button', { name: 'Previous page' })
    expect((previous as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('clamps and slices', () => {
    expect(clampPage(5, 2)).toBe(2)
    expect(clampPage(0, 2)).toBe(1)
    expect(clampPage(1, 0)).toBe(1)
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4])
  })
})
