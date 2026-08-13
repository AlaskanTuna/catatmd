import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

/**
 * Opaque, always. Content surfaces carry clinical text, and a translucent
 * surface has a contrast ratio that depends on whatever scrolls behind it, so
 * it cannot be verified once and held (docs/DESIGN.md, and the NHS
 * solid-panels rule it comes from). Glass is for chrome.
 */
export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[--radius-card] border border-line bg-surface',
        'page-break-avoid',
        className,
      )}
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
    <div className="flex flex-col items-center gap-3 rounded-[--radius-card] border border-dashed border-line px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-ink-muted">{body}</p>
      {action}
    </div>
  )
}

/** Content-shaped loading, never a spinner floating over an empty panel. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[--radius-control] bg-sunken', className)} />
}
