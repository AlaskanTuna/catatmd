import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
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
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:bg-accent-hover active:brightness-95 disabled:bg-line disabled:text-ink-muted',
  secondary:
    'bg-surface text-ink border border-line hover:border-ink-muted active:bg-sunken disabled:text-ink-muted',
  ghost: 'text-ink-muted hover:text-ink hover:bg-sunken active:bg-line disabled:text-line',
  danger:
    'bg-surface text-emergency border border-emergency/40 hover:bg-emergency/8 active:bg-emergency/12',
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
        'inline-flex items-center justify-center rounded-[--radius-control] font-medium',
        'transition-[background-color,border-color,color,opacity] duration-150 ease-[--ease-out-quart]',
        'disabled:cursor-not-allowed',
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
