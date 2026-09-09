import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { RefObject } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from './Button.js'

interface PaginationProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  className?: string
  scrollTo?: 'top' | RefObject<HTMLElement | null>
}

/**
 * Renders nothing for a single page, so a list only grows controls once it
 * needs them. Sits bottom-right by convention (docs/DESIGN.md): the eye ends a
 * list at its last row, and the control to continue belongs where the eye is.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
  scrollTo = 'top',
}: PaginationProps) {
  if (pageCount <= 1) return null

  const maybeScroll = () => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const behavior = reduced ? 'auto' : 'smooth'
    if (scrollTo === 'top') {
      window.scrollTo?.({ top: 0, behavior })
    } else if (scrollTo?.current) {
      scrollTo.current.scrollIntoView?.({ block: 'start', behavior })
    }
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn('mt-6 flex items-center justify-end gap-3', className)}
    >
      <span className="text-sm text-ink-muted" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="neutral"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1)
            maybeScroll()
          }}
          icon={<ChevronLeft aria-hidden className="size-4" />}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="neutral"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => {
            onPageChange(page + 1)
            maybeScroll()
          }}
          icon={<ChevronRight aria-hidden className="size-4" />}
        >
          Next
        </Button>
      </div>
    </nav>
  )
}

/** Clamps a page into range after a filter shrinks the list under it. */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount))
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}
