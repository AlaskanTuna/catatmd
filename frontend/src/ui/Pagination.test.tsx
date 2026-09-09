import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampPage, Pagination, paginate } from './Pagination.js'

afterEach(cleanup)

describe('Pagination', () => {
  let originalScrollIntoView: PropertyDescriptor | undefined
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn())
    originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    scrollIntoViewSpy = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoViewSpy,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView
    }
  })

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

  it('scrolls to top on page change by default', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('scrolls a ref target into view on page change', () => {
    const target = document.createElement('div')
    target.textContent = 'Section heading'
    function Wrapper() {
      const ref = useRef<HTMLElement | null>(target)
      return <Pagination page={1} pageCount={3} onPageChange={vi.fn()} scrollTo={ref} />
    }
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(scrollIntoViewSpy.mock.instances[0]).toBe(target)
  })

  it('uses auto scroll behavior when reduced motion is preferred', () => {
    const onPageChange = vi.fn()
    const matchMediaStub = vi.fn(
      (query: string) =>
        ({ matches: query === '(prefers-reduced-motion: reduce)', media: query }) as MediaQueryList,
    )
    vi.stubGlobal('matchMedia', matchMediaStub)
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
