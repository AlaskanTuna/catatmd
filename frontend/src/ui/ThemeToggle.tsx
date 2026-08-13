import { Moon, Sun } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useTheme } from '../lib/theme.js'

/**
 * Icon-only, with the label carried by `aria-label` and a title rather than
 * visible text.
 *
 * The visible word was doing no work: the icon already says which theme you
 * would get, and a text CTA next to the sign-in link competed with it for the
 * same attention. Icon-only keeps the 24px target-size floor (WCAG 2.5.8)
 * because the button is 40px square.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'}
      title={next === 'dark' ? 'Dark theme' : 'Light theme'}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-control',
        'text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {resolved === 'dark' ? (
        <Sun aria-hidden className="size-[18px]" />
      ) : (
        <Moon aria-hidden className="size-[18px]" />
      )}
    </button>
  )
}
