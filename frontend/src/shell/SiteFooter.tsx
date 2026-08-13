import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { Mark } from '../ui/Mark.js'
import { Wordmark } from '../ui/Wordmark.js'

/**
 * The layer the page is lying on top of, shared by both shells.
 *
 * It is fixed to the bottom of the viewport for the whole session while the
 * page above it is opaque, so scrolling to the end uncovers something that was
 * always there rather than scrolling a panel into view. Nothing animates; the
 * occluder simply moves. See `.reveal-page` / `.site-footer`.
 *
 * Signed-in pages get it too: a product whose every screen just ends is the
 * "skeleton" feeling this redesign is answering.
 */

/*
 * Reachable signed out, which is the constraint that decides this list rather
 * than a judgement about what is interesting. The footer renders on the public
 * landing page, and `/guidelines` is auth-gated, so a visitor clicking it was
 * bounced to `/login` with the intent discarded.
 */
const LINKS = [{ to: '/privacy', label: 'Privacy and Data Protection' }]

export function SiteFooter({ className }: { className?: string }) {
  const footer = useRef<HTMLElement>(null)

  /*
   * A fixed element's rect is always inside the viewport, so the browser sees
   * no reason to scroll when focus reaches a footer link, and a keyboard user
   * lands on a focus ring the page is currently covering. Scrolling to the end
   * puts the focused link where it can be seen.
   *
   * Guarded on `fixed`: below md the footer is in normal flow and the browser's
   * own scroll-into-view is already right.
   */
  useEffect(() => {
    const node = footer.current
    if (!node) return
    const reveal = () => {
      if (getComputedStyle(node).position !== 'fixed') return
      window.scrollTo({ top: document.documentElement.scrollHeight })
    }
    node.addEventListener('focusin', reveal)
    return () => node.removeEventListener('focusin', reveal)
  }, [])

  return (
    <footer ref={footer} className={cn('site-footer', className)} data-print="hide">
      {/* max-w-6xl px-6 is the header's column, repeated here so the footer's
          right edge lands on the same vertical as the Sign In button rather
          than near it. Right-aligned to that column, not to the viewport: past
          about 1400px a viewport-flush footer drifts away from everything else
          on the page and stops reading as part of the same grid. */}
      <div className="mx-auto flex h-full max-w-6xl flex-col items-end justify-center gap-3 px-6 py-10 text-right">
        <span className="flex items-center gap-2">
          <Mark className="size-6" />
          <Wordmark tone="inverse" className="text-xl" />
        </span>

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm font-medium text-accent-ink"
        >
          {LINKS.map(({ to, label }) => (
            <Link key={to} to={to} className="underline underline-offset-2 hover:no-underline">
              {label}
            </Link>
          ))}
        </nav>

        <p className="max-w-md text-xs text-accent-ink/80">
          This is a prototype built for evaluation, not a registered medical device, and it uses
          simulated data only.
        </p>
      </div>
    </footer>
  )
}
