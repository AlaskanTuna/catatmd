import { Check, Minus } from 'lucide-react'
import type { InputHTMLAttributes, Ref } from 'react'
import { cn } from '../lib/cn.js'

/**
 * A checkbox that belongs to this design system rather than to the operating
 * system (PR #124).
 *
 * The native control cannot be restyled past its accent colour in any engine
 * that matters, so a browser checkbox sitting beside `Button` and `Select` reads
 * as an OS widget dropped into a designed interface. Same reasoning as
 * `ui/Select.tsx`, and the same construction: a rounded square with the app's
 * radius, not a pill and not the platform's shape.
 *
 * **The real input is still there**, visually hidden but present and focusable.
 * That is what keeps the label association, the tab order, the `indeterminate`
 * property, form participation and every assistive-technology behaviour that a
 * `div` with `role="checkbox"` has to reimplement and usually gets wrong. The
 * square is decoration painted next to it, marked `aria-hidden`, and it reacts
 * through `peer-*` so no state has to be mirrored in JavaScript.
 */
export function Checkbox({
  className,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /**
   * Forwarded to the real input, which is the only thing that can carry
   * `indeterminate`: it exists as a DOM property and has no HTML attribute, so
   * a caller showing a partial selection has to reach the element itself.
   */
  ref?: Ref<HTMLInputElement>
}) {
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        // `appearance-none` rather than `sr-only`: the input keeps its own box
        // and sits exactly under the square, so the hit target is the control a
        // pointer aims at rather than a 1px point elsewhere.
        className="peer size-4.5 cursor-pointer appearance-none rounded-[6px] border border-line bg-surface transition-colors duration-150 checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        {...props}
      />
      {/* Both marks are painted; which one shows is decided by the input's own
          state, so the tick and the dash can never disagree with it. */}
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-accent-ink opacity-0 transition-opacity duration-150 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-accent-ink opacity-0 transition-opacity duration-150 peer-indeterminate:opacity-100"
      />
    </span>
  )
}
