import { Trash2, X } from 'lucide-react'
import { type RefObject, useEffect, useRef } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from './Button.js'

/**
 * The bulk actions for a list, floating at the foot of the screen while
 * anything in it is ticked.
 *
 * **Out of the list's header, because it is not always there.** A "Select all"
 * row above every list sat there unused on most visits and pushed the first
 * row down; the actions only mean anything once a row is ticked, so they
 * appear then and go when the selection empties.
 *
 * **Glass, because it is chrome** (`docs/DESIGN.md`, "Glass is chrome only").
 * It floats over the list rather than sitting in it, and it carries controls,
 * never clinical text. Its blur is 12px rather than the chrome's 20px: it sits
 * over white rows, where 20px erased everything beneath and the glass read as a
 * solid white pill. Always mounted and faded rather than mounted on demand,
 * so it can leave as smoothly as it arrives; `inert` keeps the hidden copy out
 * of the tab order and the accessibility tree.
 *
 * "Erase", not "Delete", for the reason `EraseDialog` gives: the rows are
 * tombstoned, not removed, and the audit chain keeps a record that they were.
 */
export function SelectionIsland({
  count,
  total,
  noun,
  onSelectAll,
  onClear,
  onErase,
  list,
}: {
  count: number
  /** Everything the current view could select, across every page. */
  total: number
  /** Singular and plural, for the screen-reader label. */
  noun: { one: string; many: string }
  onSelectAll: () => void
  onClear: () => void
  onErase: () => void
  /**
   * Where focus goes when the island empties with focus inside it. Clear and a
   * finished erase both hide it from under the keyboard, and focus on an inert
   * control falls to the body: back to the top of the page, mid-list.
   */
  list: RefObject<HTMLElement | null>
}) {
  const visible = count > 0
  const self = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible || !self.current?.contains(document.activeElement)) return
    const target =
      list.current?.querySelector<HTMLElement>('input[type="checkbox"]') ?? list.current
    target?.focus()
  }, [visible, list])

  return (
    <div
      ref={self}
      data-print="hide"
      inert={!visible}
      style={{ zIndex: 'var(--z-sidebar)' }}
      className={cn(
        // Below `md` the mobile dock and the help button (`.fab-anchor`, up
        // to 8.5rem) own the foot of the screen, so it clears both.
        'glass fixed bottom-38 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full p-1.5 pl-4 shadow-float backdrop-blur-md backdrop-saturate-150 md:bottom-6',
        'transition-[opacity,translate] duration-200 ease-out-quart',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <span
        role="status"
        className="mr-1.5 whitespace-nowrap text-sm font-medium tabular-nums text-ink"
      >
        {count} selected
      </span>
      <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
      <Button
        size="sm"
        variant="neutral"
        // Not disabled at the full count: a disabled control drops the focus
        // it holds, and pressing it again changes nothing.
        onClick={onSelectAll}
        aria-label={`Select all ${total} ${total === 1 ? noun.one : noun.many}`}
      >
        <span className="hidden sm:inline">Select&nbsp;</span>All {total}
      </Button>
      <Button
        size="sm"
        variant="neutral"
        icon={<X aria-hidden className="size-3.5" />}
        onClick={onClear}
        aria-label="Clear selection"
      >
        Clear
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={<Trash2 aria-hidden className="size-3.5" />}
        onClick={onErase}
      >
        Erase {count}
      </Button>
    </div>
  )
}
