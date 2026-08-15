import { ArrowLeftRight, Check, Type } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import type { DraftLine } from './draft-turns.js'

/**
 * The review surface for drafted speaker labels (#118). Every label is a
 * guess from timing and punctuation, so each is a visible toggle the doctor
 * can flip, and nothing reaches the transcript until Apply. That explicit act
 * is the safety gate: unreviewed drafted labels must never be submittable,
 * because a mislabelled doctor-question / patient-denial pair can suppress a
 * red flag (issue #70).
 */

const formatOffset = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function SpeakerAssign({
  draft,
  onToggle,
  onSwapAll,
  onApply,
  onInsertPlain,
}: {
  draft: readonly DraftLine[]
  onToggle: (id: string) => void
  onSwapAll: () => void
  onApply: () => void
  onInsertPlain: () => void
}) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Draft Labels
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {draft.length} line{draft.length === 1 ? '' : 's'}
          </span>
        </p>
        <Button
          size="sm"
          icon={<ArrowLeftRight aria-hidden className="size-3.5" />}
          onClick={onSwapAll}
        >
          Swap All
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Labels are guessed from what each sentence says, not from the voices, and can be wrong. Tap
        a label to flip it. A sentence holding both speakers is best fixed in the transcript box
        after applying. Plain text joins the turn above it until you label it.
      </p>

      <ul className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
        {draft.map((line) => (
          <li key={line.id} className="flex items-start gap-2 text-sm">
            <button
              type="button"
              onClick={() => onToggle(line.id)}
              aria-label={`${line.speaker === 'doctor' ? 'Doctor' : 'Patient'}, switch to ${
                line.speaker === 'doctor' ? 'Patient' : 'Doctor'
              }`}
              className={cn(
                'inline-flex h-8 w-18 shrink-0 items-center justify-center rounded-control border text-xs font-semibold transition-colors',
                line.speaker === 'doctor'
                  ? 'border-accent/40 bg-accent/8 text-accent hover:bg-accent/16'
                  : 'border-line bg-sunken text-ink-muted hover:bg-line/60',
              )}
            >
              {line.speaker === 'doctor' ? 'Doctor' : 'Patient'}
            </button>
            <p className="min-w-0 pt-1.5 leading-relaxed">
              {line.offsetSeconds !== undefined && (
                <span className="mr-1.5 font-mono text-xs text-ink-muted">
                  {formatOffset(line.offsetSeconds)}
                </span>
              )}
              <span className="text-ink">{line.text}</span>
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button icon={<Check aria-hidden className="size-4" />} onClick={onApply}>
          Apply Labels to Transcript
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Type aria-hidden className="size-3.5" />}
          onClick={onInsertPlain}
        >
          Insert as Plain Text
        </Button>
      </div>
    </div>
  )
}
