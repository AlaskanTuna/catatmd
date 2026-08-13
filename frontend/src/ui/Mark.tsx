import { cn } from '../lib/cn.js'

/**
 * The mark. A closed geometric C with the chestpiece resting in its aperture,
 * drawn as one idea rather than a letter with an icon beside it.
 *
 * Two earlier directions were rejected on legibility rather than taste: a C
 * whose tail became a stethoscope tube read as a question mark, which is a bad
 * thing for a clinical tool to imply, and a checked-note mark read as a
 * generic task-list icon. Alternatives are kept in docs/brand/.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <img src="/mark.png" alt="" aria-hidden className={cn('shrink-0 object-contain', className)} />
  )
}
