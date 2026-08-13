import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
import { cn } from '../lib/cn.js'
import { useDemoTour } from './DemoTour.js'

/**
 * The coachmark: a ring around the current step's target, and a tooltip beside it.
 *
 * The ring is drawn as a positioned box rather than by mutating the target, so
 * nothing the tour highlights has its own styles touched and no cleanup can
 * leave a stray class behind on a clinical surface.
 *
 * It borrows the target's own `border-radius`, which is what stops a rounded
 * card from getting a boxy rectangle drawn around it.
 */

const ROUTE_RENDER_DELAY_MS = 90
/** Half the tooltip's max width plus a margin, so it never runs off an edge. */
const TOOLTIP_HALF = 184
const EDGE = 16

export function Spotlight() {
  const { active, currentStep, steps, next, back, stop } = useDemoTour()
  const step = active && currentStep >= 0 ? steps[currentStep] : undefined
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [radius, setRadius] = useState<string | null>(null)

  /*
   * Keyed on the step object, not on its `target` string. Steps come from a
   * module-level constant, so each index is a stable distinct object, and two
   * steps that happened to share a selector would still re-run this effect and
   * re-scroll. Depending on the string alone silently skips that case.
   */
  useEffect(() => {
    const target = step?.target
    if (!active || !target) {
      setRect(null)
      return
    }

    // `update` is hoisted above the guard above, so the narrowing on `target`
    // does not reach inside it. Capturing it here does.
    const selector = target
    let observed: Element | null = null
    const observer = new ResizeObserver(() => update())

    function update() {
      const element = document.querySelector(selector)
      if (!element) {
        setRect(null)
        return
      }
      const box = element.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) {
        setRect(null)
        return
      }
      setRect(box)
      setRadius(window.getComputedStyle(element).borderRadius || null)
      if (observed !== element) {
        if (observed) observer.unobserve(observed)
        observer.observe(element)
        observed = element
      }
    }

    update()

    /*
     * Wait for the target to exist rather than checking once and giving up.
     *
     * A step that navigates lands on a screen still fetching its consultation,
     * so the anchor is not in the DOM yet and a single retry on a timer only
     * works when the network happens to be fast. That is the worst possible
     * failure mode for this feature: it passes locally and drops the ring
     * during the live demo it exists for.
     *
     * Coalesced through rAF because the subtree observer fires per mutation
     * and `update` touches layout.
     */
    let queued = 0
    const watcher = new MutationObserver(() => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        update()
      })
    })
    watcher.observe(document.body, { childList: true, subtree: true })

    // A target inside a scrolling rail may be out of view even once it exists.
    const settle = window.setTimeout(() => {
      document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      update()
    }, ROUTE_RENDER_DELAY_MS)

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      watcher.disconnect()
      if (queued) cancelAnimationFrame(queued)
      window.clearTimeout(settle)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, step])

  // Escape leaves the tour from anywhere. A guided mode with no way out is a trap.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop()
      if (event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, next, back, stop])

  if (!active || !step) return null

  const below = rect ? rect.bottom + 150 < window.innerHeight : false
  const tooltipStyle: CSSProperties = rect
    ? {
        top: below ? rect.bottom + 14 : Math.max(EDGE, rect.top - 14),
        left: Math.min(
          Math.max(rect.left + rect.width / 2, TOOLTIP_HALF + EDGE),
          window.innerWidth - TOOLTIP_HALF - EDGE,
        ),
        transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }
    : { bottom: '6rem', left: '50%', transform: 'translateX(-50%)' }

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed ring-2 ring-accent ring-offset-2 ring-offset-ground transition-[top,left,width,height] duration-200 ease-out-quart"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: radius ?? undefined,
            zIndex: 'var(--z-modal)',
          }}
        />
      )}

      {/* `alert` rather than `status`: the tooltip is the tour's whole voice, and
          a polite live region would be read after whatever else is speaking. */}
      <div
        role="alert"
        style={{ ...tooltipStyle, zIndex: 'var(--z-tooltip)', position: 'fixed' }}
        className={cn(
          'w-[22rem] max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-4 shadow-float',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-2xs font-semibold tracking-wide text-accent uppercase">
            {step.label}
          </span>
          <button
            type="button"
            onClick={stop}
            aria-label="End the walkthrough"
            className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <p className="mt-1.5 text-sm leading-relaxed text-ink">{step.hint}</p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-2xs text-ink-muted">
            {currentStep + 1} of {steps.length}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={back}
              disabled={currentStep === 0}
              className="flex h-8 items-center gap-1.5 rounded-control px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-xs font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
            >
              {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
              {currentStep < steps.length - 1 && <ArrowRight aria-hidden className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
