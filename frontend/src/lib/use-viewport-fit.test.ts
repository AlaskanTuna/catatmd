import { cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportFit } from './use-viewport-fit.js'

function TestHarness() {
  const gridRef = useRef<HTMLDivElement | null>(null)
  useViewportFit(gridRef)
  return createElement(
    'div',
    { className: 'pb-20' },
    createElement('div', { ref: gridRef, 'data-testid': 'grid' }),
  )
}

function rect(top: number): DOMRect {
  return {
    top,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => undefined,
  } as DOMRect
}

describe('useViewportFit', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('measures the grid top and writes the column height custom property', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(292))

    const { getByTestId } = render(createElement(TestHarness))

    expect(getByTestId('grid').style.getPropertyValue('--review-columns-height')).toContain(
      '100vh - 292px',
    )
  })

  it('falls back to the 13rem calc when the grid rect is zero', () => {
    const { getByTestId } = render(createElement(TestHarness))

    expect(getByTestId('grid').style.getPropertyValue('--review-columns-height')).toBe(
      'calc(100vh - 13rem)',
    )
  })
})
