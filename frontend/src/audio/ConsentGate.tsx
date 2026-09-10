import { useId } from 'react'
import { cn } from '../lib/cn.js'
import { Checkbox } from '../ui/Checkbox.js'

/**
 * The per-consultation agreement that opens the hosted relay (issue #254).
 *
 * **Two controls, two questions.** The engine preference in the Audio dialog
 * names where audio goes and is remembered for this device. This names whether
 * this patient's audio may be sent, and is remembered by nothing. Only the pair
 * reaches ILMU, and the caller holds this half in plain `useState` so it dies
 * with the component: consent is given for one consultation and is not
 * transferable to the next patient.
 *
 * It renders only where audio actually leaves: the hosted engine on the Record
 * tab, and ambient capture. On the on-device path nothing leaves the browser,
 * so there is nothing to agree to, and a tick offered there would be an
 * invitation to the cloud on a screen that currently mentions none. The
 * governing rule is that hosted stays findable but never funnelled.
 *
 * On the relay the disclosure above the tick is the load-bearing text: it
 * states the whole tradeoff in the same breath as the choice, never behind a
 * tooltip. It is a prop rather than shared copy because the paths send audio to
 * different places by different routes, and a single sentence covering both
 * would be true of neither.
 *
 * **Ambient passes `null` and carries no disclosure at all, from 10/09/26 on
 * the owner's instruction** (`docs/decisions.md` D-004), which is why the prop
 * is nullable rather than merely optional: omitting it would silently fall
 * through to the relay's sentence and tell the doctor the audio goes to
 * Malaysia. That surface names neither the processor nor the region anywhere
 * now, so nothing else in the app may point at a sentence it no longer shows.
 *
 * The tick's own wording is shared, because the promise it makes is identical.
 */
export function ConsentGate({
  agreed,
  onAgreedChange,
  disabled = false,
  disclosure = 'This recording leaves this device: sent via our server to ILMU, processed in Malaysia.',
}: {
  agreed: boolean
  onAgreedChange: (next: boolean) => void
  /** True once a run is under way, so the agreement cannot fork mid-recording. */
  disabled?: boolean
  /** Where this path's audio goes, stated before the tick rather than after. */
  disclosure?: string | null
}) {
  const id = useId()

  return (
    <div className="grid gap-2">
      {disclosure && <p className="text-xs leading-relaxed text-ink-muted">{disclosure}</p>}
      <label
        htmlFor={id}
        className={cn(
          'flex items-start gap-2.5 text-xs leading-relaxed text-ink-muted',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <Checkbox
          id={id}
          checked={agreed}
          disabled={disabled}
          onChange={(event) => onAgreedChange(event.target.checked)}
        />
        <span>
          This patient has agreed to be recorded and transcribed, for this consultation only. This
          is not remembered.
        </span>
      </label>
    </div>
  )
}
