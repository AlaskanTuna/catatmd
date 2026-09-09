import { useLayoutEffect, useRef } from 'react'

const FALLBACK = 'calc(100vh - 13rem)'

function toPixels(value: string | undefined): number {
  const match = value?.match(/^([\d.]+)px$/)
  return match ? Number.parseFloat(match[1] ?? '0') : 0
}

function verticalMargin(element: Element): number {
  const style = window.getComputedStyle(element)
  return toPixels(style.marginTop) + toPixels(style.marginBottom)
}

// Everything that sits below the grid's bottom edge before the document ends:
// the bottom padding and margin of every ancestor up to the body. Reading one
// parent's padding missed the page shell's own bottom padding, which put the
// document 40px past the viewport at every desktop width.
function spaceBelow(grid: HTMLElement): number {
  let total = 0
  for (let node = grid.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    total += toPixels(style.paddingBottom) + toPixels(style.marginBottom)
  }
  return total + toPixels(window.getComputedStyle(grid).marginBottom)
}

export function useViewportFit<G extends HTMLElement, B extends HTMLElement>(
  gridRef: React.RefObject<G | null>,
  bottomBarRef?: React.RefObject<B | null>,
) {
  const resizeObserver = useRef<ResizeObserver | null>(null)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const header = grid.previousElementSibling

    const update = () => {
      if (!grid.isConnected) return

      const rect = grid.getBoundingClientRect()
      const top = rect.top + (window.scrollY ?? 0)

      if (top === 0 && rect.height === 0) {
        grid.style.setProperty('--review-columns-height', FALLBACK)
        return
      }

      const below = spaceBelow(grid)
      const bottomBar = bottomBarRef?.current
      const bottom = bottomBar
        ? below + bottomBar.getBoundingClientRect().height + verticalMargin(bottomBar)
        : below

      grid.style.setProperty('--review-columns-height', `calc(100vh - ${top}px - ${bottom}px)`)
    }

    update()

    if (typeof window.ResizeObserver !== 'undefined') {
      resizeObserver.current = new ResizeObserver(update)
      if (header) resizeObserver.current.observe(header)
      const bottomBar = bottomBarRef?.current
      if (bottomBar) resizeObserver.current.observe(bottomBar)
    }

    const handleResize = () => update()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.current?.disconnect()
      resizeObserver.current = null
    }
  }, [gridRef, bottomBarRef])
}
