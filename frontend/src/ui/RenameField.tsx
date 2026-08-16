import { Check, Pencil, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * Renames a record in place, in the list and on the detail page alike.
 *
 * **The pencil reveals on hover and is always there on touch.** Hover is the
 * conventional affordance and it is the right one on a list, where a control
 * per row would be noise. It is also unreachable on a touchscreen, so the
 * reveal is gated on the pointer being a fine one, exactly as `CursorGlow`
 * gates the trail. Focus reveals it too, so the keyboard path does not depend
 * on an interaction the keyboard does not have.
 *
 * **Blank saves as cleared, not as an empty name.** The server collapses a
 * whitespace-only title to `null`, and this matches it, so a doctor who empties
 * the field gets the fallback back rather than a blank row.
 *
 * Escape cancels and Enter commits, which is the contract `ui/Select.tsx`
 * establishes for anything in this codebase that opens.
 */
export function RenameField({
  value,
  fallback,
  onSave,
  label,
  className,
  textClassName,
  defaultEditing = false,
  onDone,
}: {
  value: string | null
  /** Shown when the record has never been named. Never saved as a value. */
  fallback: string
  onSave: (next: string | null) => void
  /** Names the control for a screen reader, since the pencil carries no text. */
  label: string
  className?: string
  textClassName?: string
  /**
   * Opens straight into the input. The consultation list needs this: its rows
   * are links, so the pencil has to live outside the anchor and swap the row
   * into this component already editing, rather than rendering a second pencil
   * the doctor would have to press twice.
   */
  defaultEditing?: boolean
  /** Fires on commit or cancel, so a caller owning the open state can clear it. */
  onDone?: () => void
}) {
  const [editing, setEditing] = useState(defaultEditing)
  const [draft, setDraft] = useState(value ?? '')
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const open = () => {
    setDraft(value ?? '')
    setEditing(true)
  }

  const close = () => {
    setEditing(false)
    onDone?.()
  }

  const commit = () => {
    const trimmed = draft.trim()
    close()
    if (trimmed === (value ?? '')) return
    onSave(trimmed.length === 0 ? null : trimmed)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  if (editing) {
    return (
      <span className={cn('flex items-center gap-1', className)}>
        <input
          ref={input}
          value={draft}
          maxLength={120}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          // Committing on blur would make the tick redundant and make a
          // mis-click a silent save. Cancel is the safer blur.
          onBlur={close}
          className="min-w-0 flex-1 rounded-control border border-accent bg-surface px-2 py-1 text-sm text-ink"
        />
        {/*
          `onMouseDown` rather than `onClick`: the input's `onBlur` fires first
          on a click and would close the field before the button ever ran.
        */}
        <button
          type="button"
          aria-label="Save name"
          onMouseDown={(event) => {
            event.preventDefault()
            commit()
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-control text-accent hover:bg-accent-soft"
        >
          <Check aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Cancel rename"
          onMouseDown={(event) => {
            event.preventDefault()
            close()
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-sunken"
        >
          <X aria-hidden className="size-4" />
        </button>
      </span>
    )
  }

  return (
    <span className={cn('group/rename flex min-w-0 items-center gap-1.5', className)}>
      <span className={cn('truncate', textClassName)}>{value ?? fallback}</span>
      <button
        type="button"
        aria-label={label}
        onClick={open}
        className="flex size-6 shrink-0 items-center justify-center rounded-control text-ink-muted opacity-0 transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover/rename:opacity-100 pointer-coarse:opacity-100"
      >
        <Pencil aria-hidden className="size-3.5" />
      </button>
    </span>
  )
}
