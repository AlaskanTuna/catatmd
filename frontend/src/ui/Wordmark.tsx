import { cn } from '../lib/cn.js'

/**
 * The wordmark: "Catat" set in Outfit, with "MD" enclosed in a rounded badge.
 *
 * The split is the point. `catat` is Malay for "to note", so the first half is
 * the product and the second half is the credential, and boxing "MD" says that
 * out loud rather than leaving it as four letters that happen to be adjacent.
 *
 * "Catat" is live text now, not outlines. It is set in the same face as every
 * heading in the interface, so the logotype stops being a special case: no
 * second font to load, nothing to regenerate when the wording changes, and the
 * brand and the interface are visibly the same voice. The display serif it
 * replaced was doing the opposite, carrying a face that appeared exactly once.
 *
 * Only "MD" stays vector, because Mafins is the one thing here that is not a
 * UI font and never should be. Two glyphs of it, sized in `em` so the badge
 * tracks whatever the call site sets.
 */

/** "MD" in Mafins at 0.80 scale, centred in a 1372x762 badge. */
const MD =
  'M170.0 660.6H239.6L217.2 578.2V184.6L375.6 661.4H434.8L596.4 184.6V579.0L573.2 661.4H738.8L716.4 579.0V183.8L738.8 101.4H578.8L573.2 183.8L454.0 535.8L336.4 183.8L331.6 101.4L170.0 100.6L193.2 183.0V578.2Z M799.6 661.4H979.6C1137.2 661.4 1202.0 539.0 1202.0 381.4C1202.0 223.8 1141.2 101.4 970.0 101.4H799.6L822.0 183.8V579.0ZM942.0 119.8H966.0C1081.2 119.8 1081.2 268.6 1081.2 381.4C1081.2 492.6 1070.8 642.2 971.6 642.2H942.0Z'

export function Wordmark({
  className,
  tone = 'default',
}: {
  className?: string
  /** `inverse` is for the accent-filled panel, where the whole lockup is light. */
  tone?: 'default' | 'inverse'
}) {
  const inverse = tone === 'inverse'

  return (
    <span
      className={cn('inline-flex items-center font-display font-semibold leading-none', className)}
      role="img"
      aria-label="CatatMD"
    >
      <span aria-hidden className="tracking-[-0.005em]">
        Catat
      </span>
      {/* Tight to the word. The badge is the second half of a single name, so
          the gap has to read as a join rather than as two adjacent things. */}
      <svg viewBox="0 0 1372 762" aria-hidden="true" className="ml-[0.15em] h-[0.78em] w-auto">
        <rect
          width="1372"
          height="762"
          rx="140"
          className={inverse ? 'fill-current' : 'fill-accent'}
        />
        <path d={MD} className={inverse ? 'fill-accent' : 'fill-accent-ink'} />
      </svg>
    </span>
  )
}
