import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
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
  anchor,
  children,
}: {
  label: string
  icon: ReactNode
  /** Rendered as a count on the trigger. Omitted entirely when zero. */
  badge?: number
  align?: 'left' | 'right'
  /**
   * The surface to align and offset against, when the trigger sits inside one.
   * Defaults to the trigger itself, which is right for a button standing alone.
   */
  anchor?: RefObject<HTMLElement | null>
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()

  /**
   * Where the portalled panel sits, in viewport coordinates.
   *
   * Needed only because the panel is portalled out of this component's DOM
   * position (see the render), so it can no longer be placed by `absolute`
   * against the wrapper. Measured from the trigger rather than tracked as
   * state the caller supplies, so alignment stays a property of where the
   * button actually is.
   */
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number }>()

  const place = useCallback(() => {
    /*
     * Measured from the surface the trigger sits in, not from the trigger.
     *
     * The button is one of three inside a padded floating cluster, so its own
     * box is the wrong thing to hang a panel off. Measured on the deployed
     * build at 1280px: the panel's right edge landed 47px inside the cluster's,
     * because the bell is the middle button, and its top landed 1px below the
     * cluster's bottom, because the 8px offset was taken from a trigger sitting
     * 7px above that edge. Two panels opening at two different x positions read
     * as drift, and 1px reads as the panel welded to the bar.
     *
     * Against the cluster both fall out for free: edges line up whichever
     * button was pressed, and the gap is a real gap.
     */
    const rect = (anchor?.current ?? trigger.current)?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      top: rect.bottom + 8,
      ...(align === 'right'
        ? { right: Math.max(16, window.innerWidth - rect.right) }
        : { left: Math.max(16, rect.left) }),
    })
  }, [align, anchor])

  // Layout effect so the panel never paints at a stale position for a frame.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    // `true` so this fires for scrolls in any nested scroller, not just the
    // document, and `resize` covers the viewport changing under a pinned panel.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      // The panel is portalled, so it is no longer inside `wrap` and has to be
      // tested separately. Without this every click inside the panel dismisses
      // it, including the ones on its own buttons.
      if (wrap.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
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
          open
            ? 'bg-accent-soft text-accent'
            : 'text-ink-muted hover:bg-sunken-soft hover:text-ink',
        )}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span
            // The count is on the trigger's accessible name rather than only in
            // this dot, so it is not a purely visual signal.
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-pill bg-notify px-1 text-[0.625rem] leading-4 font-semibold text-notify-ink"
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {/*
       * Portalled to `body`, and that is a rendering-correctness requirement
       * rather than a layering preference.
       *
       * `ChromeCluster`, this component's parent, is itself `.glass`. An
       * element with `backdrop-filter` establishes a **backdrop root**, and a
       * descendant's own `backdrop-filter` may only sample inside it. Rendered
       * in place, this panel therefore blurred the cluster's flat fill instead
       * of the page, and shipped as plain translucency with no frost: exactly
       * the "nothing behind it to operate on" failure docs/DESIGN.md warns
       * about, arriving structurally rather than through a missing dot grid.
       *
       * Portalling puts it back on the page's own backdrop root, where the dot
       * grid and the content behind it are what the blur samples.
       */}
      {open &&
        position &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            // No role and no name, deliberately. This is a disclosure: the named
            // button sits immediately before the content it reveals and carries
            // `aria-expanded`, so the panel is just content. Giving it `role=
            // "menu"` would promise arrow-key semantics that are not implemented,
            // and `role="group"` would be a name repeated from the trigger.
            data-print="hide"
            style={{ zIndex: 'var(--z-modal)', ...position }}
            className={cn(
              // Glass, matching every other floating surface in the app. These
              // panels carry chrome (a status feed, an account menu) rather than
              // clinical content, so docs/DESIGN.md's solid-panels-for-content
              // rule does not bind here. The blur is what stops the page behind
              // showing through as noise under the text.
              'glass-panel fixed w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-float',
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  )
}
