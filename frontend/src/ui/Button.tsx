import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

type Variant = 'primary' | 'secondary' | 'neutral' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

/**
 * One button vocabulary for the whole app. `primary` is the accent-filled
 * variant and is deliberately scarce: docs/DESIGN.md reserves the only large
 * filled accent element on the review screen for Approve, so a second primary
 * button on that screen is a design bug, not a preference.
 *
 * **Every variant carries a background and an edge, and `ghost` is gone.** It
 * was the most-used variant in the app, twelve call sites against seven
 * primaries, and it had no background at all until hover. That put real
 * decisions behind a control that rendered as body text, including three
 * clinical ones: Dismiss and Not Applicable on a red flag, and Discard on a
 * CatatAI proposal. Its replacement is `neutral`, which is the same position in
 * the hierarchy with a surface you can see.
 *
 * `secondary` had the same defect more quietly. It was `bg-surface`, and
 * `Card` is also `bg-surface`, so the default button was white on white with
 * `shadow-raised` carrying the entire affordance. It is now the soft accent
 * tint, which is what makes an ordinary action look like an action.
 *
 * **The tints are opaque colour-mixes, not alpha.** They read as coloured glass
 * and are not glass: `--color-accent-soft` is the accent mixed into the surface
 * at a fixed percentage, so its contrast is one value that can be verified
 * once, rather than depending on whatever happens to scroll behind it. Content
 * surfaces carry clinical text and #168 already removed translucency from this
 * layer for exactly that reason (docs/DESIGN.md, and `Card`'s own docstring).
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-raised hover:bg-accent-hover disabled:bg-line disabled:text-ink-muted disabled:shadow-none',
  secondary:
    'bg-accent-soft text-accent border border-accent/20 shadow-raised hover:bg-accent-soft-hover disabled:border-line disabled:bg-sunken-soft disabled:text-ink-muted disabled:shadow-none',
  neutral:
    'bg-sunken-soft text-ink border border-line shadow-raised hover:bg-sunken disabled:bg-sunken-soft disabled:text-ink-muted disabled:shadow-none',
  danger:
    'bg-emergency-soft text-emergency border border-emergency/30 shadow-raised hover:bg-emergency-soft-hover disabled:border-line disabled:bg-sunken-soft disabled:text-ink-muted disabled:shadow-none',
}

const SIZES: Record<Size, string> = {
  // 24px is the WCAG 2.2 target-size floor; nothing here goes under it.
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        // Rounded rectangle, not a pill. Actions now echo the radius of the
        // cards and inputs they sit among instead of standing apart from them,
        // which is the one shape rule applied everywhere: `rounded-pill` is
        // reserved for chips and status markers, which are labels rather than
        // things you press.
        'inline-flex items-center justify-center rounded-control font-medium',
        'transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out-quart',
        // A press should feel like a press. Small enough that it reads as
        // tactile rather than as the button jumping.
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}
