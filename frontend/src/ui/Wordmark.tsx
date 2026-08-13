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
 * These are the real Mafins outlines, converted to paths rather than set as
 * live text. Composing the lockup in CSS meant its proportions were re-derived
 * from `em` arithmetic at every render, against a display face whose metrics
 * were drawn for 48px and up, and it kept landing wrong: the badge sat low
 * against the caps and the letters read cramped. In vector the relationships
 * are settled once. It also takes the font off the logo's critical path, so
 * the wordmark cannot flash unstyled while a woff2 loads.
 *
 * Coordinates are font units at 1000 upem with the baseline at y=0. The lockup
 * is sized by height rather than font-size, in `em` so it still tracks the
 * call site's `text-*`; 0.9em is the value that balances it against the 24px
 * mark it is always set beside. Matching the old cap height instead looked
 * shrunken, because the badge it replaced overflowed well past the caps.
 */

/** "Catat", tracked 0.03em. Ink spans x 0..2238, cap height 700. */
const CATAT =
  'M267.0 9.0C372.0 9.0 457.0 -25.0 501.0 -133.0L381.0 -217.0C367.0 -38.0 321.0 -14.0 267.0 -14.0C203.0 -14.0 150.0 -56.0 150.0 -351.0C150.0 -645.0 203.0 -688.0 267.0 -688.0C321.0 -688.0 367.0 -663.0 381.0 -483.0L501.0 -567.0C457.0 -675.0 372.0 -709.0 267.0 -709.0C112.0 -709.0 0.0 -633.0 0.0 -350.0C0.0 -67.0 112.0 9.0 267.0 9.0Z M1020.0 0.0 992.0 -103.0V-362.0C992.0 -446.0 933.0 -496.0 817.0 -496.0C709.0 -496.0 659.0 -440.0 626.0 -376.0L642.0 -364.0C674.0 -405.0 704.0 -453.0 772.0 -453.0C835.0 -453.0 841.0 -408.0 841.0 -363.0V-308.0C759.0 -326.0 554.0 -303.0 555.0 -138.0C556.0 -28.0 647.0 6.0 767.0 5.0C793.0 4.0 819.0 0.0 842.0 -11.0V0.0ZM786.0 -18.0C736.0 -18.0 705.0 -51.0 705.0 -140.0C705.0 -259.0 766.0 -300.0 841.0 -290.0V-98.0C839.0 -41.0 819.0 -18.0 786.0 -18.0Z M1370.0 -471.0V-487.0H1277.0V-608.0H1260.0L1127.0 -487.0H1079.0V-471.0H1127.0V-86.0C1127.0 9.0 1196.0 9.0 1238.0 9.0C1315.0 9.0 1357.0 -32.0 1370.0 -54.0L1357.0 -69.0C1317.0 -29.0 1277.0 -24.0 1277.0 -109.0V-471.0Z M1888.0 0.0 1860.0 -103.0V-362.0C1860.0 -446.0 1801.0 -496.0 1685.0 -496.0C1577.0 -496.0 1527.0 -440.0 1494.0 -376.0L1510.0 -364.0C1542.0 -405.0 1572.0 -453.0 1640.0 -453.0C1703.0 -453.0 1709.0 -408.0 1709.0 -363.0V-308.0C1627.0 -326.0 1422.0 -303.0 1423.0 -138.0C1424.0 -28.0 1515.0 6.0 1635.0 5.0C1661.0 4.0 1687.0 0.0 1710.0 -11.0V0.0ZM1654.0 -18.0C1604.0 -18.0 1573.0 -51.0 1573.0 -140.0C1573.0 -259.0 1634.0 -300.0 1709.0 -290.0V-98.0C1707.0 -41.0 1687.0 -18.0 1654.0 -18.0Z M2238.0 -471.0V-487.0H2145.0V-608.0H2128.0L1995.0 -487.0H1947.0V-471.0H1995.0V-86.0C1995.0 9.0 2064.0 9.0 2106.0 9.0C2183.0 9.0 2225.0 -32.0 2238.0 -54.0L2225.0 -69.0C2185.0 -29.0 2145.0 -24.0 2145.0 -109.0V-471.0Z'

/** "MD" at 0.80 scale, centred on the cap band inside the badge. */
const MD =
  'M2578.0 -70.4H2647.6L2625.2 -152.8V-546.4L2783.6 -69.6H2842.8L3004.4 -546.4V-152.0L2981.2 -69.6H3146.8L3124.4 -152.0V-547.2L3146.8 -629.6H2986.8L2981.2 -547.2L2862.0 -195.2L2744.4 -547.2L2739.6 -629.6L2578.0 -630.4L2601.2 -548.0V-152.8Z M3207.6 -69.6H3387.6C3545.2 -69.6 3610.0 -192.0 3610.0 -349.6C3610.0 -507.2 3549.2 -629.6 3378.0 -629.6H3207.6L3230.0 -547.2V-152.0ZM3350.0 -611.2H3374.0C3486.8 -611.2 3489.2 -462.4 3489.2 -349.6C3489.2 -238.4 3478.8 -88.8 3379.6 -88.8H3350.0Z'

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
    <svg
      viewBox="0 -731 3780 762"
      role="img"
      aria-label="CatatMD"
      className={cn('h-[0.9em] w-auto', className)}
    >
      <path d={CATAT} fill="currentColor" />
      <rect
        x="2408"
        y="-731"
        width="1372"
        height="762"
        rx="140"
        className={inverse ? 'fill-current' : 'fill-accent'}
      />
      <path d={MD} className={inverse ? 'fill-accent' : 'fill-accent-ink'} />
    </svg>
  )
}
