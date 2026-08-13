import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.js'
import { useDemoTour } from './DemoTour.js'

/**
 * Progress while the tour runs, docked top-centre.
 *
 * It collapses rather than closes. During a live demo the presenter needs to
 * know where they are, but the bar sits over the app and the one thing worse
 * than losing your place is covering the screen you are talking about.
 *
 * Below `sm` only the current step is named: nine labels in a row on a phone
 * is a scrollbar, not a progress indicator.
 */
export function DemoStepBar() {
  const { active, currentStep, steps, stop } = useDemoTour()
  const [collapsed, setCollapsed] = useState(false)

  if (!active) return null

  const current = steps[currentStep]

  return (
    <nav
      aria-label="Walkthrough progress"
      data-print="hide"
      style={{ zIndex: 'var(--z-toast)' }}
      className="glass fixed top-4 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-float px-3 py-2"
    >
      <span className="text-xs font-medium whitespace-nowrap text-ink sm:hidden">
        {currentStep + 1}/{steps.length} · {current?.label}
      </span>

      {!collapsed && (
        <ol className="hidden items-center gap-1 sm:flex">
          {steps.map((step, index) => {
            const isCurrent = index === currentStep
            const isDone = index < currentStep
            return (
              <li
                key={step.label}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-control px-2 py-1 text-xs whitespace-nowrap transition-colors duration-150',
                  isCurrent && 'bg-accent/16 font-medium text-accent',
                  isDone && 'text-ink-muted',
                  !isCurrent && !isDone && 'text-ink-muted/60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full text-[0.625rem]',
                    isCurrent && 'bg-accent text-accent-ink',
                    isDone && 'text-accent',
                    !isCurrent && !isDone && 'border border-current',
                  )}
                >
                  {isDone ? <Check className="size-3" /> : index + 1}
                </span>
                {step.label}
              </li>
            )
          })}
        </ol>
      )}

      {collapsed && (
        <span className="hidden text-xs font-medium whitespace-nowrap text-ink sm:inline">
          Step {currentStep + 1} of {steps.length} · {current?.label}
        </span>
      )}

      <div className="flex items-center gap-1 border-l border-line/60 pl-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the step list' : 'Collapse the step list'}
          className="hidden size-7 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink sm:flex"
        >
          {collapsed ? (
            <ChevronDown aria-hidden className="size-4" />
          ) : (
            <ChevronUp aria-hidden className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={stop}
          className="rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          End
        </button>
      </div>
    </nav>
  )
}
