import { Link, Outlet } from 'react-router-dom'
import { CursorGlow } from '../ui/CursorGlow.js'
import { Mark } from '../ui/Mark.js'
import { ThemeToggle } from '../ui/ThemeToggle.js'
import { Wordmark } from '../ui/Wordmark.js'
import { SiteFooter } from './SiteFooter.js'

/**
 * The public shell: everything an evaluator sees before signing in.
 *
 * Its one structural idea is the footer, and that now belongs to both shells,
 * so it lives in `SiteFooter`. What is left here is the top bar and the layer
 * that occludes the footer until the page is scrolled off it.
 */
export function MarketingShell() {
  return (
    <div className="reveal-shell">
      <div className="reveal-page dot-grid">
        <CursorGlow />

        <header className="sticky top-0 z-10 glass rounded-none border-x-0 border-t-0">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <Link to="/" className="flex items-center gap-2" aria-label="CatatMD home">
              <Mark className="size-6 text-accent" />
              <Wordmark className="text-xl" />
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link
                to="/login"
                className="inline-flex h-10 items-center rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
              >
                Sign In
              </Link>
            </div>
          </div>
        </header>

        <Outlet />
      </div>

      <SiteFooter />
    </div>
  )
}
