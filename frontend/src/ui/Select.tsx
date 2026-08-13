import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * A listbox, not a `<select>`.
 *
 * The native control cannot be styled past its trigger in any engine that
 * matters, so a filter sitting next to a search input would render as an OS
 * widget beside a designed one. That is the whole reason this exists; it is not
 * a general-purpose component and should not grow into one.
 *
 * Hand-rolled rather than pulled from Radix because nothing else in this
 * codebase uses a headless UI library, and a single control is a poor reason to
 * introduce one. The cost of that choice is that the keyboard contract is ours
 * to honour, and issue #30 requires a complete keyboard path through the app:
 *
 *   - Enter, Space, ArrowUp or ArrowDown on the trigger opens the list
 *   - the list takes focus, so arrows move between options directly rather than
 *     through `aria-activedescendant`, which is fewer moving parts and is what
 *     a screen reader reports most consistently
 *   - Home and End jump to the ends, Escape closes and returns focus, Tab closes
 *   - a pointer press anywhere outside closes it
 *
 * Focus returns to the trigger on close because the trigger is where the user
 * was. Leaving focus on the document body is the failure that strands a
 * keyboard user mid-page.
 */

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Visually hidden, but the control must still say what it filters. */
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const labelId = useId()

  const selected = options.findIndex((option) => option.value === value)
  const current = options[selected] ?? options[0]

  /* Focus the selected option as the list appears, so the first arrow press
     moves from where the user already is rather than from the top. */
  useEffect(() => {
    if (!open) return
    const node = list.current?.querySelectorAll<HTMLElement>('[role="option"]')
    node?.[Math.max(selected, 0)]?.focus()
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) trigger.current?.focus()
  }

  const move = (index: number) => {
    const nodes = list.current?.querySelectorAll<HTMLElement>('[role="option"]')
    if (!nodes?.length) return
    // Wrap at both ends: a list that silently stops moving reads as broken.
    nodes[(index + nodes.length) % nodes.length]?.focus()
  }

  return (
    <div ref={wrap} className={cn('relative', className)}>
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-control',
          'border border-line bg-surface px-3.5 text-sm font-medium text-ink',
          'transition-colors duration-150 hover:border-accent',
        )}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ink-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          aria-labelledby={labelId}
          onKeyDown={(event) => {
            const nodes = [
              ...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
            ]
            const index = nodes.indexOf(document.activeElement as HTMLElement)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(index + 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(index - 1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              move(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              move(nodes.length - 1)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              close(true)
            } else if (event.key === 'Tab') {
              close(false)
            }
          }}
          className={cn(
            'absolute right-0 z-20 mt-1.5 max-h-72 min-w-full overflow-y-auto',
            'rounded-card border border-line bg-surface p-1 shadow-float',
          )}
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => {
                  onChange(option.value)
                  close(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onChange(option.value)
                    close(true)
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-control',
                  'px-3 py-2 text-sm whitespace-nowrap transition-colors duration-150',
                  isSelected ? 'bg-accent/16 font-medium text-accent' : 'text-ink hover:bg-sunken',
                )}
              >
                {option.label}
                {isSelected && <Check aria-hidden className="size-4 shrink-0" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
