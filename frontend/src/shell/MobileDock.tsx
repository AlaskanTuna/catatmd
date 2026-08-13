import { FileText, Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { ThemeToggle } from '../ui/ThemeToggle.js'

/**
 * The small-screen replacement for the sidebar island, not a squeezed version
 * of it.
 *
 * Touch has no hover, so the island's whole expand-on-intent interaction has
 * no meaning here and the labels are simply always visible. It docks to the
 * bottom because that is where a thumb is, and it never dims the content
 * behind it: on a phone the content column is the entire screen, and dimming
 * it to show four navigation targets would be theatre.
 */
const ITEMS = [
  { to: '/consultations', label: 'Consultations', icon: FileText, end: true },
  { to: '/consultations/new', label: 'New', icon: Plus, end: false },
]

export function MobileDock() {
  return (
    <nav
      aria-label="Main"
      data-print="hide"
      style={{ zIndex: 'var(--z-sidebar)' }}
      className="glass fixed inset-x-3 bottom-3 flex items-center justify-around rounded-[--radius-float] p-1.5 md:hidden"
    >
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[--radius-control] px-2 py-1.5',
              'text-2xs font-medium transition-colors duration-150',
              isActive ? 'bg-accent/12 text-accent' : 'text-ink-muted',
            )
          }
        >
          <Icon aria-hidden className="size-5" />
          {label}
        </NavLink>
      ))}
      <ThemeToggle className="flex-1" />
    </nav>
  )
}
