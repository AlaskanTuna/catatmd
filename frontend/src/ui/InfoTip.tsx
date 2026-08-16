import { Info } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
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
 */
export function InfoTip({
  label,
  children,
  className,
  align = 'left',
}: {
  label: string
  children: ReactNode
  className?: string
  /** Flip to `right` when the tip sits near the right edge of its container. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const panelId = useId()
  const wrap = useRef<HTMLSpanElement | null>(null)

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
      if (wrap.current?.contains(event.target as Node)) return
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
      {open && (
        <span
          id={panelId}
          role="tooltip"
          // The z-index tokens live in `@layer base`, not in `@theme`, so they
          // are CSS variables rather than Tailwind utilities. Every layered
          // element in `shell/` and `demo/` sets them this way.
          style={{ zIndex: 'var(--z-tooltip)' }}
          // Anchored above so a panel this wide cannot push a narrow screen into
          // a horizontal scroll, and edge-aligned so it stays inside its column.
          className={cn(
            'absolute bottom-full mb-1.5 w-72 max-w-[80vw] rounded-card border border-line bg-surface p-3 text-xs leading-relaxed font-normal text-ink-muted shadow-lg',
            align === 'left' ? 'left-0' : 'right-0',
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}
