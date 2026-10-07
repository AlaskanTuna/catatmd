import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react'

const GAP_PX = 6
const EDGE_GUTTER_PX = 12
/** `max-h-72`, the height the lists had while they were absolutely positioned. */
const MAX_HEIGHT_PX = 288

/**
 * The `popover` attribute to render, only where the API behind it exists.
 *
 * jsdom ships the UA rule that hides an unopened `[popover]` but not
 * `showPopover()`, so rendering the attribute there hides the list from every
 * test with no way to open it. An engine without the API gets a fixed list in
 * the page instead of one in the top layer.
 */
export const POPOVER: 'manual' | undefined =
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
    ? 'manual'
    : undefined

/**
 * Lifts a list into the browser's top layer and pins it to its trigger.
 *
 * **The top layer, because nothing else reaches above a modal.** A list inside a
 * `<dialog>` is clipped by the dialog's own overflow however high its z-index,
 * and a portal to `document.body` renders behind the dialog, because
 * `showModal()` already put the dialog in the top layer. The prescription
 * theatre's Frequency list was the case that showed it: it opened under the
 * footer and was cut off at the dialog's edge. A `popover="manual"` element
 * shown after the dialog is stacked above it, and it stays where it is in the
 * DOM, so focus, `contains()` and the dialog's inertness all still work.
 *
 * Positioned in viewport coordinates and re-read on any scroll or resize, so it
 * follows a trigger inside a scrolling body. Flipped above when there is not
 * room for the full list below and there is more room above.
 *
 * jsdom implements no Popover API, so the calls are guarded the way the
 * dialogs guard `showModal`; a test sees the list in the tree as before.
 */
export function useAnchoredPopover(
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>()

  useLayoutEffect(() => {
    if (!open) return
    const node = popover.current
    const supported = node !== null && typeof node.showPopover === 'function'
    if (supported && !node.matches(':popover-open')) node.showPopover()

    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - GAP_PX - EDGE_GUTTER_PX
      const above = rect.top - GAP_PX - EDGE_GUTTER_PX
      const up = below < MAX_HEIGHT_PX && above > below
      // Every inset set explicitly: one left unset falls back to the UA's
      // `[popover] { inset: 0 }` and stretches the list across the viewport.
      setStyle({
        position: 'fixed',
        margin: 0,
        left: rect.left,
        right: 'auto',
        top: up ? 'auto' : rect.bottom + GAP_PX,
        bottom: up ? window.innerHeight - rect.top + GAP_PX : 'auto',
        // The trigger's width exactly, so a long label truncates rather than
        // running the list off the viewport's edge.
        width: rect.width,
        maxHeight: Math.min(MAX_HEIGHT_PX, up ? above : below),
      })
    }
    place()
    document.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      if (supported && node.matches(':popover-open')) node.hidePopover()
    }
  }, [open, anchor, popover])

  return style
}
