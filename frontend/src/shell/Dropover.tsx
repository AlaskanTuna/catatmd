import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * A button in the chrome cluster and the panel it opens (issue #116).
 *
 * Hand-rolled for the same reason `ui/Select.tsx` is: nothing in this codebase
 * uses a headless UI library, and two controls are a poor reason to introduce
 * one. The dismissal behaviour is deliberately identical to that file's, so the
 * two feel like one system rather than two hand-rolls.
 *
 * No `role="menu"`. One of these holds a list of notifications and the other
 * holds a heading and a button, and neither is a menu of commands; claiming the
 * role would promise arrow-key semantics that are not implemented. The trigger
 * carries `aria-expanded` and the panel is labelled, which is what is actually
 * true.
 */
export function Dropover({
  label,
  icon,
  badge,
  align = 'right',
  children,
}: {
  label: string
  icon: ReactNode
  /** Rendered as a count on the trigger. Omitted entirely when zero. */
  badge?: number
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Focus goes back to the button that opened it, never to the top of the
      // document. Escape is a keyboard gesture and it should leave a keyboard
      // user where they were.
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex size-9 items-center justify-center rounded-control transition-colors duration-150',
          open ? 'bg-accent/12 text-accent' : 'text-ink-muted hover:bg-sunken/60 hover:text-ink',
        )}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span
            // The count is on the trigger's accessible name rather than only in
            // this dot, so it is not a purely visual signal.
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-pill bg-urgent px-1 text-[0.625rem] leading-4 font-semibold text-ink"
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          // No role and no name, deliberately. This is a disclosure: the named
          // button sits immediately before the content it reveals and carries
          // `aria-expanded`, so the panel is just content. Giving it `role=
          // "menu"` would promise arrow-key semantics that are not implemented,
          // and `role="group"` would be a name repeated from the trigger.
          style={{ zIndex: 'var(--z-modal)' }}
          className={cn(
            // Opaque, not glass. docs/DESIGN.md reserves translucency for
            // chrome, and the moment a panel carries a list a doctor reads, it
            // is content sitting in chrome rather than chrome.
            'absolute top-11 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface shadow-raised',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
