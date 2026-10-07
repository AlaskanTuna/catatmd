import { type Ref, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { POPOVER, useAnchoredPopover } from '../ui/use-anchored-popover.js'

const MAX_SUGGESTIONS = 8

/**
 * A drug name, typed freely, with the lexicon's generics offered as shortcuts.
 *
 * **Whatever is typed is the value.** The lexicon is ours and it will lag the
 * formulary, so a drug it has never heard of is still a drug the doctor may
 * prescribe. The native `<datalist>` this replaces opened as an OS dropdown
 * listing the whole lexicon, which read as a picklist the name had to come
 * from. Here a suggestion only appears once something is typed that it
 * matches, and the list says in its own footer that any name is accepted.
 *
 * A combobox in the ARIA sense: focus stays in the input, the arrows move the
 * active option through `aria-activedescendant`, Enter takes it, and Escape
 * closes the list without closing the theatre around it. The list is in the
 * top layer for the reason `useAnchoredPopover` gives.
 */
export function DrugField({
  value,
  onChange,
  suggestions,
  label,
  invalid,
  describedBy,
  inputRef,
  className,
}: {
  value: string
  onChange: (next: string) => void
  suggestions: readonly string[]
  label: string
  invalid?: boolean
  describedBy?: string
  inputRef?: Ref<HTMLInputElement>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const anchor = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()

  const typed = value.trim().toLowerCase()
  const matches =
    typed === ''
      ? []
      : suggestions
          .filter((name) => name.toLowerCase().includes(typed) && name.toLowerCase() !== typed)
          // Names starting with what was typed first, then the rest in lexicon order.
          .sort(
            (a, b) =>
              Number(!a.toLowerCase().startsWith(typed)) -
              Number(!b.toLowerCase().startsWith(typed)),
          )
          .slice(0, MAX_SUGGESTIONS)
  const showing = open && matches.length > 0
  const placement = useAnchoredPopover(anchor, list, showing)

  // The active option is announced through `aria-activedescendant`, so it must
  // also be on screen: past the list's height the arrows walk off its end.
  useEffect(() => {
    if (!showing || active < 0) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [showing, active, listId])

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  const take = (name: string) => {
    onChange(name)
    close()
  }

  return (
    <>
      <input
        ref={(node) => {
          anchor.current = node
          if (typeof inputRef === 'function') inputRef(node)
          else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = node
        }}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        className={className}
        value={value}
        placeholder="Type any drug name"
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (matches.length === 0) return
            event.preventDefault()
            if (!showing) {
              setOpen(true)
              setActive(event.key === 'ArrowDown' ? 0 : matches.length - 1)
              return
            }
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((current) => (current + step + matches.length) % matches.length)
          } else if (event.key === 'Enter' && showing && active >= 0) {
            event.preventDefault()
            take(matches[active] as string)
          } else if (event.key === 'Escape' && showing) {
            // Cancelling the keydown is what stops the dialog's own close
            // request, so one Escape closes the list and a second the theatre.
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
      />
      {showing && (
        <div
          ref={list}
          popover={POPOVER}
          style={placement}
          className="flex flex-col overflow-hidden rounded-card border border-line bg-surface p-1 text-ink shadow-float"
        >
          {/* The options scroll and the footer does not, so the sentence saying
            any name is accepted is never the part cut off. */}
          <div
            id={listId}
            role="listbox"
            aria-label={`Suggestions for ${label}`}
            className="min-h-0 overflow-y-auto"
          >
            {matches.map((name, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard picks from the input, through aria-activedescendant
              <div
                key={name}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                // Kept from taking focus, so the input does not blur and close
                // the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => take(name)}
                onPointerEnter={() => setActive(index)}
                className={cn(
                  'cursor-pointer truncate rounded-control px-3 py-2 text-sm transition-colors duration-150',
                  index === active ? 'bg-sunken' : 'hover:bg-sunken',
                )}
                title={name}
              >
                {name}
              </div>
            ))}
          </div>
          <p className="border-t border-line px-3 pt-2 pb-1.5 text-2xs text-ink-muted">
            Not listed? Keep typing. Any name is accepted.
          </p>
        </div>
      )}
    </>
  )
}
