import { useState } from 'react'
import type { LivePanes } from '../audio/live/use-live-panes.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { type Dismissed, PROMPT_LIMIT, selectPrompts } from './live-prompt.js'
import { SEVERITY } from './SafetyCards.js'

/**
 * What the doctor reads while they are talking (#278).
 *
 * **Push, not pull.** The rail this replaces during capture put twenty-eight
 * gaps and a red-flag panel in a 340px column with 264px of it below the fold,
 * beside a page that scrolled and a transcript that scrolled inside it. The
 * doctor asked for a pop-up; a pop-up they have to *open* is not available,
 * because docs/DESIGN.md requires severity visible without scrolling and the
 * panels never become tabs. So this is present for the whole capture, it is
 * never a dialog, and the highest-priority thing is always already showing.
 *
 * **Opaque, and that is not a style choice.** It carries red flags and prompts,
 * which is content a doctor acts on, and docs/DESIGN.md confines glass to
 * chrome: a translucent surface has a contrast ratio that depends on whatever
 * is behind it, so it cannot be verified once.
 *
 * **One card, so the severity rule can sit on its edge.** `RedFlagCard` is
 * itself a `Card` and nesting one here would be a nested card; the flag rows
 * borrow `SEVERITY` instead, which keeps one home for the grammar.
 */
export function LivePrompter({
  live,
  onShowAll,
}: {
  live: LivePanes
  /** Opens the shared overflow dialog with every outstanding prompt. */
  onShowAll: () => void
}) {
  /*
   * Held here and nowhere else. This is clinical content, so it never reaches
   * `localStorage`; it dies with the tab exactly as the running consultation
   * does.
   */
  const [dismissed, setDismissed] = useState<Dismissed>({ asked: [], skipped: [] })
  const model = selectPrompts(live, dismissed)
  const top = model.ask[0]

  const dismiss = (kind: keyof Dismissed) => {
    if (!top) return
    setDismissed((current) => ({ ...current, [kind]: [...current[kind], top.id] }))
  }

  const worst = model.flags.kind === 'flags' ? SEVERITY[model.flags.worst.severity] : null

  return (
    <section
      aria-label="Clinical safety"
      data-tour="live-prompter"
      data-print="hide"
      className="overflow-hidden rounded-card bg-surface shadow-card page-break-avoid"
    >
      {/* The severity rule belongs on the card's own top edge, which is the
          whole reason this is one card rather than two stacked panels. */}
      <div aria-hidden className={cn('h-1 w-full', worst ? worst.rule : 'bg-line')} />

      <div className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            Red Flags
          </h2>
          {model.flags.kind === 'flags' && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-2xs text-ink-muted tabular-nums">
              {model.flags.flags.length}
            </span>
          )}
        </div>
        <div className="mt-2">
          <FlagBody state={model.flags} />
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              Ask Next
            </h2>
            {model.outstanding.length > 0 && (
              <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-2xs text-ink-muted tabular-nums">
                {Math.min(PROMPT_LIMIT, model.ask.length)} of {model.outstanding.length}
              </span>
            )}
          </div>

          {model.ask.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              {model.outstanding.length === 0
                ? 'Nothing outstanding so far.'
                : 'Everything shown has been asked. The rest are in the full list.'}
            </p>
          ) : (
            /* Numbered because the order carries information: it is the
               priority the checklist assigned, not the order they arrived. */
            <ol className="mt-2 flex flex-col gap-2">
              {model.ask.map((prompt, index) => (
                <li key={prompt.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <span className="pt-0.5 text-2xs font-semibold text-ink-muted tabular-nums">
                    {index + 1}
                  </span>
                  <p className={cn('text-sm text-ink', index === 0 && 'font-medium')}>
                    {prompt.question}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => dismiss('asked')} disabled={!top}>
              Asked
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => dismiss('skipped')}
              disabled={!top}
            >
              Skip
            </Button>
            {model.outstanding.length > 0 && (
              <button
                type="button"
                onClick={onShowAll}
                className="ml-auto text-2xs text-ink-muted underline underline-offset-2"
              >
                Show All {model.outstanding.length}
              </button>
            )}
          </div>
        </div>

        {live.answered.length > 0 && (
          /* Answered prompts are moved, never deleted. A gap the doctor has
             just covered disappearing from under their eye reads as the list
             losing track of the conversation (docs/trd.md §20.8.1). */
          <p className="mt-3 text-2xs text-ink-muted">{live.answered.length} covered so far</p>
        )}
      </div>
    </section>
  )
}

/**
 * The four readings of the safety check, kept apart on purpose.
 *
 * "None detected" is a clinical claim and only a check that ran and returned
 * may license it. A stalled check saying nothing looks identical to a clear
 * one, which is the false negative the engine exists to prevent, so it says so
 * in `--color-emergency` and does not wait to be asked.
 */
function FlagBody({ state }: { state: ReturnType<typeof selectPrompts>['flags'] }) {
  if (state.kind === 'stalled') {
    return (
      <p className="text-sm text-emergency">
        Live safety checks have stopped. Press Analyse to run the full check.
      </p>
    )
  }
  if (state.kind === 'unchecked') {
    return <p className="text-sm text-ink-muted">Waiting for the first safety check.</p>
  }
  if (state.kind === 'clear') {
    return <p className="text-sm text-ink-muted">None detected so far.</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {state.flags.map((flag) => {
        const severity = SEVERITY[flag.severity]
        return (
          <li key={flag.id} className="flex items-start gap-2">
            <severity.Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', severity.text)} />
            <div className="min-w-0">
              {/* Icon, word and colour together, never colour alone (WCAG 1.4.1). */}
              <span className={cn('text-2xs font-semibold uppercase', severity.text)}>
                {severity.label}
              </span>
              <p className="text-sm text-ink">{flag.label}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
