import { BookMarked, FileText, Moon, PanelLeft, Plus, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { useTheme } from '../lib/theme.js'
import { Mark } from '../ui/Mark.js'
import { Wordmark } from '../ui/Wordmark.js'

const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 200

interface Item {
  to: string
  label: string
  icon: typeof FileText
  tour?: string
}

const ITEMS: Item[] = [
  { to: '/consultations/new', label: 'New Consultation', icon: Plus, tour: 'nav-new' },
  { to: '/consultations', label: 'Consultations', icon: FileText, tour: 'nav-consultations' },
  { to: '/guidelines', label: 'Guidelines', icon: BookMarked, tour: 'nav-guidelines' },
]

/**
 * A floating glass island, detached from all four edges, that expands on
 * intent and dims what sits beneath it.
 *
 * Three triggers, not one. Hover alone would strand keyboard and touch users,
 * and issue #30 requires a complete keyboard path through the app:
 *
 *   1. pointer hover, delayed so a cursor crossing the edge does not dim the app
 *   2. `focus-within`, so tabbing in produces the same state as pointing at it
 *   3. an explicit toggle that pins it, which is the only honest answer for touch
 *
 * The blur and dim live on one fixed scrim rendered by the shell, never as a
 * filter over the content tree: filtering a large subtree on every hover janks,
 * and `backdrop-filter` on a single compositor layer does not.
 */
export function SidebarIsland({
  onExpandedChange,
}: {
  onExpandedChange: (expanded: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { resolved, setPreference } = useTheme()

  const expanded = pinned || hovered || focused

  useEffect(() => {
    onExpandedChange(expanded)
  }, [expanded, onExpandedChange])

  useEffect(() => () => clearTimeout(timer.current), [])

  const schedule = (next: boolean) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHovered(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS)
  }

  return (
    <nav
      aria-label="Main"
      data-tour="sidebar"
      onPointerEnter={() => schedule(true)}
      onPointerLeave={() => schedule(false)}
      // Keyboard focus expands the island; a mouse click does not. Clicking a
      // nav item leaves that item focused, and focus does not leave the island
      // on navigation, so treating every focus as intent held the island open
      // until the user happened to click something else entirely. `:focus-visible`
      // is the browser's own answer to "did this focus come from the keyboard",
      // which is exactly the distinction being drawn here.
      onFocus={(event) => {
        if (event.target instanceof Element && event.target.matches(':focus-visible')) {
          setFocused(true)
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      style={{ zIndex: 'var(--z-sidebar)' }}
      data-print="hide"
      className={cn(
        // Below md the island is the wrong shape for a thumb and hover does
        // not exist, so it is replaced by a bottom dock rather than shrunk.
        'hidden md:flex',
        'glass fixed top-4 bottom-4 left-4 flex-col rounded-float p-2',
        'transition-[width] duration-[220ms] ease-out-expo',
        expanded ? 'w-58' : 'w-16',
      )}
    >
      <Link
        to="/"
        aria-label="CatatMD home"
        className="flex items-center gap-2 rounded-control px-2 py-3 transition-colors duration-150 hover:bg-sunken/60"
      >
        <Mark className="size-6 text-accent" />
        <Wordmark
          className={cn(
            'text-xl whitespace-nowrap transition-opacity duration-150',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
      </Link>

      <ul className="mt-2 flex flex-1 flex-col gap-1">
        {ITEMS.map(({ to, label, icon: Icon, tour }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/consultations'}
              data-tour={tour}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-control px-3',
                  'text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-accent/12 text-accent'
                    : 'text-ink-muted hover:bg-sunken/60 hover:text-ink',
                )
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span
                className={cn(
                  'whitespace-nowrap transition-opacity duration-150',
                  expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                {label}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
        <button
          type="button"
          onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
          className="flex h-11 items-center gap-3 rounded-control px-3 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-ink"
        >
          {resolved === 'dark' ? (
            <Sun aria-hidden className="size-5 shrink-0" />
          ) : (
            <Moon aria-hidden className="size-5 shrink-0" />
          )}
          <span
            className={cn(
              'whitespace-nowrap transition-opacity duration-150',
              expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {resolved === 'dark' ? 'Light Theme' : 'Dark Theme'}
          </span>
        </button>

        {/* Touch has no hover and a keyboard user should not have to hold
            focus to read a label. Pinning is the accessible equivalent. */}
        <button
          type="button"
          onClick={() => setPinned((value) => !value)}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          className="flex h-11 items-center gap-3 rounded-control px-3 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-ink"
        >
          <PanelLeft aria-hidden className={cn('size-5 shrink-0', pinned && 'text-accent')} />
          <span
            className={cn(
              'whitespace-nowrap transition-opacity duration-150',
              expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {pinned ? 'Unpin' : 'Pin Open'}
          </span>
        </button>
      </div>
    </nav>
  )
}
