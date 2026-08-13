import { cn } from '../lib/cn.js'

/**
 * The wordmark: "Catat" set in Mafins, with "MD" enclosed in a rounded badge.
 *
 * The split is the point. `catat` is Malay for "to note", so the first half is
 * the product and the second half is the credential, and boxing "MD" says that
 * out loud rather than leaving it as four letters that happen to be adjacent.
 * It also gives the lockup a fixed silhouette at small sizes, where an
 * unbroken run of display serif turns to mush.
 *
 * Mafins is used here and nowhere else. The face is subsetted to exactly the
 * glyphs of "CatatMD", so it costs about 1 KB and physically cannot spell
 * anything different: a display serif drawn for 48px is a legibility risk at
 * the 16px a clinical note is read at, and a font that cannot render other
 * strings cannot quietly spread into the interface.
 *
 * Everything is sized in `em`, so the lockup holds its proportions wherever it
 * is placed and the badge never drifts relative to the letters.
 */
export function Wordmark({
  className,
  tone = 'default',
}: {
  className?: string
  /** `inverse` is for the accent-filled panel, where the whole lockup is light. */
  tone?: 'default' | 'inverse'
}) {
  return (
    // The element carries the text itself, so it needs no accessible name of
    // its own; the subsetted face changes the glyphs available, never the
    // string a screen reader receives.
    <span
      className={cn('inline-flex items-baseline font-logo leading-none tracking-tight', className)}
    >
      Catat
      <span
        className={cn(
          'ml-[0.1em] inline-block rounded-[0.22em] px-[0.18em] pt-[0.12em] pb-[0.06em]',
          tone === 'inverse' ? 'bg-accent-ink text-accent' : 'bg-accent text-accent-ink',
        )}
      >
        MD
      </span>
    </span>
  )
}
