import type { ReactNode } from 'react'
import { cn } from '../lib/cn.js'

/**
 * The band at the top of every signed-in page.
 *
 * It replaces a bare `h1` with a surface, which is what stops each screen from
 * opening on unstructured text and gives the art somewhere to live. The art is
 * decorative and says so: `alt=""` plus `aria-hidden`, so it is one image a
 * screen reader never has to hear described.
 *
 * The art is cropped by the card rather than fitted inside it. An illustration
 * that sits neatly within its container reads as a picture that was placed;
 * one that runs off the edge reads as a surface the illustration belongs to.
 * It is also hidden below `sm`, where there is no horizontal room to spare and
 * it would only push the title into a narrower column.
 *
 * Everything the page owns stacks on the left and the right half is the art's
 * alone. Actions were in the top-right first, which put an opaque button on
 * top of the illustration and left it peeking out above and below like
 * something that had been covered up by accident. A column of text and buttons
 * beside an image is the composition; a button parked on an image is not.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  art,
  actions,
  className,
  ...props
}: {
  title: string
  subtitle?: ReactNode
  /** Rendered above the title. Only earns its place on a page you can be deep in. */
  breadcrumb?: ReactNode
  art?: string
  actions?: ReactNode
  className?: string
} & Pick<React.HTMLAttributes<HTMLElement>, 'aria-label'> & { 'data-print'?: string }) {
  return (
    <header
      className={cn(
        // A floor, so a header with no actions is not a third the height of one
        // with them and the art keeps a consistent presence across pages.
        'relative min-h-38 overflow-hidden rounded-card p-6 shadow-card sm:p-7',
        // Not a flat surface. A faint accent wash rising to the right seats the
        // motif in the card instead of leaving it pasted onto white, and it is
        // the one place a gradient earns its keep: it is a background under
        // decoration, never behind clinical text, which stays on the flat left
        // side where its contrast is the surface's own.
        'bg-surface bg-gradient-to-br from-accent/6 via-surface to-accent/10',
        className,
      )}
      {...props}
    >
      {art && (
        <img
          src={art}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 top-1/2 hidden h-[132%] max-h-60 w-auto -translate-y-1/2 object-contain opacity-95 sm:block dark:opacity-85"
        />
      )}

      {/*
        Capped against the art's zone rather than at a fixed width. A fixed
        `max-w-sm` is correct at one card width and wrong at every other: at
        640px it ran the subtitle 38px into the illustration. 15rem is the
        widest the art gets (`max-h-60` on a roughly square render) plus a
        gutter, so the column clears it at every width the art is shown at, and
        below `sm` the art is hidden and the cap is only about line length.
      */}
      <div className="relative max-w-md sm:max-w-[calc(100%-15rem)]">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="mb-2 text-sm text-ink-muted">
            {breadcrumb}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-muted">{subtitle}</div>}
        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}
