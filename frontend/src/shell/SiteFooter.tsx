import { ArrowRight } from 'lucide-react'
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
 * Signed-in pages get it too. The safeguards and the residency claims are not
 * marketing copy that stops being true after login, and a product whose every
 * screen just ends is the "skeleton" feeling this redesign is answering.
 */

const SAFEGUARDS = [
  'Identifiers are tokenised before any model call',
  'Red-flag rules run as code, never as a prompt',
  'The treating doctor approves every note',
]

const RESIDENCY = [
  ['Application', 'Vercel · Singapore'],
  ['API', 'Render · Singapore'],
  ['Database', 'Supabase · Singapore'],
]

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
      <div className="mx-auto flex h-full max-w-6xl flex-col justify-center px-6 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr] md:gap-10">
          <div className="sm:col-span-2 md:col-span-1">
            <span className="flex items-center gap-2">
              <Mark className="size-6" />
              <Wordmark tone="inverse" className="text-xl" />
            </span>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-accent-ink">
              A GP consultation transcript becomes a structured note you review, edit and approve.
              It does not diagnose.
            </p>
            <Link
              to="/login"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-pill border border-accent-ink/35 px-5 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-ink/12 active:scale-[0.97]"
            >
              Try the Demo
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-accent-ink">Safeguards</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-snug text-accent-ink">
              {SAFEGUARDS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-accent-ink">Hosted in Singapore</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm leading-snug text-accent-ink">
              {RESIDENCY.map(([tier, where]) => (
                <div key={tier} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium">{tier}</dt>
                  <dd>{where}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-accent-ink/20 pt-5 text-xs text-accent-ink">
          <span>
            Prototype for evaluation. Not a registered medical device. Simulated data only.
          </span>
          <Link to="/privacy" className="underline underline-offset-2">
            Privacy and Data Protection
          </Link>
        </div>
      </div>
    </footer>
  )
}
