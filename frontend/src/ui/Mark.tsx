import { cn } from '../lib/cn.js'

/**
 * The mark. A closed geometric C with the chestpiece resting in its aperture,
 * drawn as one idea rather than a letter with an icon beside it.
 *
 * Two earlier directions were rejected on legibility rather than taste: a C
 * whose tail became a stethoscope tube read as a question mark, which is a bad
 * thing for a clinical tool to imply, and a checked-note mark read as a
 * generic task-list icon. Alternatives are kept in docs/brand/.
 *
 * Vector, and specifically not the 1024px PNG this replaced. That file baked
 * in asymmetric padding, so every box it was dropped into rendered it small
 * and off-centre, and a second colour was only reachable through a
 * `brightness-0 invert` filter chain that can produce white and nothing else.
 * Here the geometry is tuned for the sizes it actually renders at: the stroke
 * holds 2.3px at 16px, and the aperture is wide enough (2.6px at 24px) that
 * the chestpiece stays a separate object instead of welding to the C.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn('shrink-0', className)}>
      <path
        d="M22.73 7.94A11.2 11.2 0 1 0 22.73 24.06"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <circle cx="27.15" cy="16" r="3.4" fill="currentColor" />
    </svg>
  )
}
