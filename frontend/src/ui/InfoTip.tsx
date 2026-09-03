import { Info } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn.js'

/**
 * The supplementary-detail disclosure, one of them for the whole app.
 *
 * Promoted here from `audio/AudioCapture.tsx`, which said in its own docstring
 * that it earned a promotion when there was a second. There are now several:
 * the corpus explainer, the checklist, and the transcription options.
 *
 * **Hover opens it and click pins it, and both halves are load-bearing.** Hover
 * alone strands every touch user, because touch has no hover and a doctor on a
 * tablet would never reach the content. Click alone was the previous behaviour
 * and made a mouse user press a target to read one sentence, which reads as
 * broken rather than as deliberate. So pointer devices get it on hover, and a
 * click latches it open so the panel survives the pointer leaving, which is
 * what makes text inside it selectable.
 *
 * Focus opens it too, so the keyboard path matches the mouse one rather than
 * requiring Enter on a control whose peers respond to hover.
 *
 * Hand-rolled for the reason `ui/Select.tsx` gives at length: nothing in this
 * codebase uses a headless UI library, and a disclosure is a poor reason to add
 * a dependency to a project whose own rules ask for a cooldown and an advisory
 * check before every new one.
 *
 * **Nothing load-bearing goes inside it.** A fact the reader must have in order
 * to make the choice in front of them belongs in the visible copy, in the same
 * breath as the choice. This carries the elaboration, never the disclosure that
 * consent depends on (docs/trd.md section 20).
 *
 * `layered` is for tips inside a `<dialog>`, where the UA stylesheet's
 * `overflow: auto` clips an absolutely positioned child however high its
 * z-index. It portals the panel to the dialog itself and positions it against
 * the dialog's own box.
 *
 * **It must portal INTO the dialog, never to `document.body`.** A dialog opened
 * with `showModal()` is promoted to the browser's top layer, and the top layer
 * is above every z-index in the document: a panel on the body renders behind
 * the very dialog it was lifted out of. That was the previous behaviour here,
 * and it made every tip in the audio dialog invisible. No test caught it,
 * because jsdom implements neither the top layer nor `showModal` (the suites
 * stub the method outright), so this is a browser-only failure by construction.
 *
 * Outside a dialog it portals to the body and positions in viewport
 * coordinates instead. That path is for a tip inside an ordinary scrolling
 * container, whose `overflow` clips an in-flow panel exactly the way a dialog's
 * does: the review columns became such containers when they were given a shared
 * height, which is what clipped the capture card's tip.
 *
 * **The dialog path assumes the `<dialog>` is itself the scrolling box**,
 * because the offset it adds is that element's `scrollTop`. That holds for the
 * audio dialog, which scrolls on the UA's own `overflow: auto`. It does not
 * hold for a dialog that scrolls an inner wrapper instead, and the full-gap-list
 * dialog in `routes/ConsultationReview.tsx` is exactly that shape: putting a
 * `layered` tip inside one would track the wrong offset.
 */
export function InfoTip({
  label,
  children,
  className,
  align = 'left',
  layered = false,
}: {
  label: string
  children: ReactNode
  className?: string
  /** Flip to `right` when the tip sits near the right edge of its container. */
  align?: 'left' | 'right'
  /** Portal the panel out, for a tip inside a dialog or a scrolling column. */
  layered?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const panelId = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLSpanElement>(null)
  const [hosted, setHosted] = useState<{
    host: HTMLElement
    below: boolean
    maxHeight: number
    style: CSSProperties
  } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      setPinned(false)
    }
    // `pointerdown` rather than `click`, so a press that begins outside closes
    // the panel before it can also activate whatever it landed on.
    const onPointer = (event: PointerEvent) => {
      if (
        wrap.current?.contains(event.target as Node) ||
        panelRef.current?.contains(event.target as Node)
      )
        return
      setOpen(false)
      setPinned(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  /*
   * The layered panel is positioned against its host dialog's scroll box, so it
   * has to track the trigger while that box scrolls and while the window
   * resizes. A scroll and a resize listener re-reading the rects covers both
   * causes with one effect.
   */
  useLayoutEffect(() => {
    if (!open || !layered) return
    const dialog = wrap.current?.closest('dialog')
    const place = () => {
      const rect = wrap.current?.getBoundingClientRect()
      if (!rect) return
      /*
       * Above the trigger by default, flipped below when there is more room
       * that way. A tip on the first row of its box has nothing above it, and a
       * panel anchored upward from there is the one whose opening sentence
       * disappears off the top with no scrollbar to recover it.
       */
      const bounds = dialog
        ? dialog.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight)
      const roomAbove = rect.top - bounds.top
      const roomBelow = bounds.bottom - rect.bottom
      const below = roomBelow > roomAbove
      const maxHeight = Math.max(roomAbove, roomBelow) - 12

      if (dialog) {
        setHosted({
          host: dialog,
          below,
          maxHeight,
          style: {
            position: 'absolute',
            // Dialog-relative, plus the dialog's own scroll offset, because the
            // panel is an absolutely positioned child of a box that scrolls.
            top:
              (below ? rect.bottom - bounds.top + 6 : rect.top - bounds.top - 6) + dialog.scrollTop,
            left: 12,
            right: 12,
            width: 'auto',
          },
        })
        return
      }
      /*
       * No dialog: fixed on the body, in viewport coordinates. This is the path
       * for a tip inside an ordinary scrolling container, where the container's
       * own `overflow` clips an in-flow panel exactly the way a dialog's does.
       * There is no top layer involved outside a modal, so the body is a
       * perfectly good host and `--z-tooltip` means what it says.
       */
      setHosted({
        host: document.body,
        below,
        maxHeight,
        style: {
          position: 'fixed',
          top: below ? rect.bottom + 6 : rect.top - 6,
          // Right-aligned to the trigger so a panel near the right edge of a
          // narrow column cannot grow off the side of the viewport.
          left: align === 'left' ? rect.left : undefined,
          right: align === 'left' ? undefined : window.innerWidth - rect.right,
        },
      })
    }
    place()
    document.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, layered, align])

  const panelClass = cn(
    'max-h-[min(60vh,22rem)] w-72 max-w-[80vw] overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-3 text-xs leading-relaxed font-normal text-ink-muted shadow-lg',
  )

  const panel =
    open && layered && hosted ? (
      createPortal(
        <span
          ref={panelRef}
          id={panelId}
          role="tooltip"
          /*
           * Absolute inside the dialog, spanning its width rather than hanging
           * off the trigger's edge. The dialog is 28rem and the panel wants
           * 18rem, so a trigger-anchored panel has 10rem of slack to be clamped
           * within, and clamping it is more moving parts than simply taking the
           * width that is already there. Spanning also means `align` has
           * nothing left to decide, which is why it is not read on this path.
           */
          style={{
            ...hosted.style,
            maxHeight: hosted.maxHeight,
            transform: hosted.below ? undefined : 'translateY(-100%)',
            zIndex: 'var(--z-tooltip)',
          }}
          className={panelClass}
        >
          {children}
        </span>,
        hosted.host,
      )
    ) : open ? (
      <span
        ref={panelRef}
        id={panelId}
        role="tooltip"
        // The z-index tokens live in `@layer base`, not in `@theme`, so they
        // are CSS variables rather than Tailwind utilities. Every layered
        // element in `shell/` and `demo/` sets them this way.
        style={{ zIndex: 'var(--z-tooltip)' }}
        // Anchored above so a panel this wide cannot push a narrow screen into
        // a horizontal scroll, and edge-aligned so it stays inside its column.
        //
        // Bounded in height for the same reason it is bounded in width, and
        // anchoring upward is what makes it necessary: a panel taller than the
        // space above its trigger grows off the top of the viewport, where
        // there is no scrollbar to recover it, so the first line is the one
        // that disappears. The longest tip in the app is the hosted
        // transcription disclosure, which is the last one that should be able
        // to lose its opening sentence.
        className={cn(
          panelClass,
          'absolute bottom-full mb-1.5',
          align === 'left' ? 'left-0' : 'right-0',
        )}
      >
        {children}
      </span>
    ) : null

  return (
    <span
      ref={wrap}
      className={cn('relative inline-flex align-middle', className)}
      onPointerEnter={(event) => {
        // Touch raises pointerenter immediately before the click that follows,
        // so opening here would let the click close it again. Pointer devices
        // only.
        if (event.pointerType === 'touch') return
        setOpen(true)
      }}
      onPointerLeave={() => {
        if (!pinned) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (pinned) {
            setPinned(false)
            setOpen(false)
            return
          }
          setPinned(true)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false)
        }}
        className="inline-flex size-5 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:bg-sunken focus-visible:text-ink"
      >
        <Info aria-hidden className="size-3.5" />
      </button>
      {panel}
    </span>
  )
}
