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
    <span className={cn('inline-flex items-center font-logo leading-none', className)}>
      {/*
        Positive tracking, not negative. Mafins is a display serif with tight
        fitting drawn for 48px and up; at the 18 to 24px this lockup actually
        appears at, the default fit closes the counters and the word reads as
        one dark shape. Opening it up is what makes it legible small.
      */}
      <span className="tracking-[0.03em]">Catat</span>
      {/*
        Set slightly smaller than the word and padded symmetrically, so the
        badge reads as a companion to "Catat" rather than competing with it.
        Centred rather than baseline-aligned: a baseline box inherits the
        font's descender space and sits visibly low against caps.
      */}
      <span
        className={cn(
          'ml-[0.22em] inline-block rounded-[0.2em] px-[0.26em] py-[0.2em]',
          'text-[0.82em] tracking-[0.02em]',
          tone === 'inverse' ? 'bg-accent-ink text-accent' : 'bg-accent text-accent-ink',
        )}
      >
        MD
      </span>
    </span>
  )
}
