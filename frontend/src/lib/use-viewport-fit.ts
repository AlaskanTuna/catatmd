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

export function useViewportFit<G extends HTMLElement, B extends HTMLElement>(
  gridRef: React.RefObject<G | null>,
  bottomBarRef?: React.RefObject<B | null>,
) {
  const resizeObserver = useRef<ResizeObserver | null>(null)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const header = grid.previousElementSibling
    const parent = grid.parentElement

    const update = () => {
      if (!grid.isConnected) return

      const rect = grid.getBoundingClientRect()
      const top = rect.top + (window.scrollY ?? 0)

      if (top === 0 && rect.height === 0) {
        grid.style.setProperty('--review-columns-height', FALLBACK)
        return
      }

      const paddingBottom = parent ? toPixels(window.getComputedStyle(parent).paddingBottom) : 0
      const bottomBar = bottomBarRef?.current
      const bottom = bottomBar
        ? paddingBottom + bottomBar.getBoundingClientRect().height + verticalMargin(bottomBar)
        : paddingBottom

      grid.style.setProperty('--review-columns-height', `calc(100vh - ${top}px - ${bottom}px)`)
    }

    update()

    if (typeof window.ResizeObserver !== 'undefined') {
      if (!resizeObserver.current) resizeObserver.current = new ResizeObserver(update)
      if (header) resizeObserver.current.observe(header)
      const bottomBar = bottomBarRef?.current
      if (bottomBar) resizeObserver.current.observe(bottomBar)
    }

    const handleResize = () => update()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  })
}
