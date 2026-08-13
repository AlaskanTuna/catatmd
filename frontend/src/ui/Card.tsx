import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

/**
 * Opaque, always. Content surfaces carry clinical text, and a translucent
 * surface has a contrast ratio that depends on whatever scrolls behind it, so
 * it cannot be verified once and held (docs/DESIGN.md, and the NHS
 * solid-panels rule it comes from). Glass is for chrome.
 *
 * That rule costs nothing visually. The references this was rebuilt against
 * carry their softness in radius, shadow and the step between a recessed ground
 * and a lifted surface, not in blur, and every card in them is solid white.
 * Lifting the card off the ground is also what lets the border go: a border and
 * a shadow doing the same job reads as an outline, which is the flat look the
 * previous version had.
 */
export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card bg-surface shadow-card', 'page-break-avoid', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-ink-muted">{body}</p>
      {action}
    </div>
  )
}

/** Content-shaped loading, never a spinner floating over an empty panel. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-sunken', className)} />
}
