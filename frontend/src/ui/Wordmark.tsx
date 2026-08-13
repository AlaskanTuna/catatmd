import { cn } from '../lib/cn.js'

/**
 * The wordmark. The only place Mafins is used anywhere in the product.
 *
 * The face is subsetted to exactly the glyphs in "CatatMD", so it costs about
 * 1 KB and physically cannot render any other string. That is a deliberate
 * constraint rather than an optimisation: a display serif drawn for 48px is a
 * legibility risk at the 16px a clinical note is read at, and a font that
 * cannot spell anything else cannot quietly spread into the interface.
 *
 * `catat` is Malay for "to note". The name is the product description, so the
 * wordmark does not need to explain itself.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    // The element carries the text itself, so it needs no accessible name of
    // its own; the subsetted face changes the glyphs available, never the
    // string a screen reader receives.
    <span className={cn('font-[family-name:--font-logo] tracking-tight', className)}>CatatMD</span>
  )
}
