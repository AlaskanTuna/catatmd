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

  it('subtracts the bottom padding of every ancestor, not only the parent', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(292))
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element: Element) =>
        ({
          paddingBottom: element.classList.contains('pb-20')
            ? '80px'
            : element.tagName === 'MAIN'
              ? '40px'
              : '0px',
          marginBottom: '0px',
          marginTop: '0px',
        }) as CSSStyleDeclaration,
    )

    const { getByTestId } = render(createElement('main', null, createElement(TestHarness)))

    expect(getByTestId('grid').style.getPropertyValue('--review-columns-height')).toBe(
      'calc(100vh - 292px - 120px)',
    )
  })

  it('falls back to the 13rem calc when the grid rect is zero', () => {
    const { getByTestId } = render(createElement(TestHarness))

    expect(getByTestId('grid').style.getPropertyValue('--review-columns-height')).toBe(
      'calc(100vh - 13rem)',
    )
  })
})
