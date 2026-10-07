import type { ClinicalScore, GuidelineChunk } from '@shared/types'
import { useId, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Card } from '../ui/Card.js'
import { SourcesPanel } from './SafetyCards.js'

/**
 * The guideline scores the doctor completes (#221).
 *
 * **The doctor's scores, not the system's.** Every item starts empty. Where
 * the transcript plainly established one, the card shows the sentence it heard
 * and offers that answer for one tap, but never selects it: a misread then
 * needs the doctor to read it and choose it. Each total is a sum of what is
 * chosen, and nothing here reads it: what a total means is in its own source.
 *
 * **One question, several scores.** Scores that share an item share its
 * answer, so the doctor is not asked twice. Each total sums only its own items
 * and cites only its own source, because the sources disagree and a merged
 * reading would claim an agreement neither makes (docs/trd.md §11).
 *
 * Answers live in this component's state alone. They are not written into the
 * note or saved, and never into web storage, which clinical content may not
 * reach (`.claude/rules/security.md`).
 */
export function ScoreCard({
  scores,
  guidelines,
}: {
  scores: ClinicalScore[]
  guidelines: GuidelineChunk[]
}) {
  // The backend defines a shared item identically in every score that has it,
  // so the first definition stands for all of them.
  const items = [
    ...new Map(scores.flatMap((score) => score.items.map((item) => [item.id, item]))).values(),
  ]
  const [answers, setAnswers] = useState<Record<string, string | null>>({})
  const [openSource, setOpenSource] = useState<string | null>(null)
  // Per card, so two cards on one page never share a radio group or an id.
  const uid = useId()

  return (
    <Card className="p-4">
      <p className="text-xs text-ink-muted">
        Answer each item. Where the transcript said something plain, it is shown with its answer to
        use.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {items.map((item) => {
          const chosen = answers[item.id] ?? null
          const suggestion = item.suggestion
          const suggested = item.options.find(({ id }) => id === suggestion?.optionId)
          const labelId = `${uid}-${item.id}`
          return (
            <div key={item.id}>
              <p id={labelId} className="text-xs font-medium text-ink">
                {item.label}
              </p>
              <div
                role="radiogroup"
                aria-labelledby={labelId}
                className="mt-1 flex gap-1 rounded-control bg-sunken-soft p-1"
              >
                {item.options.map((option) => {
                  const selected = chosen === option.id
                  return (
                    <label key={option.id} className="flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name={labelId}
                        value={option.id}
                        checked={selected}
                        onChange={() => setAnswers((prev) => ({ ...prev, [item.id]: option.id }))}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          'flex min-h-8 items-center justify-center gap-1 rounded-control px-2 text-center text-xs transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2',
                          selected
                            ? 'bg-surface font-semibold text-accent shadow-raised'
                            : 'font-medium text-ink-muted hover:bg-sunken hover:text-ink',
                        )}
                      >
                        {option.label}
                        {/* U+2212, so a screen reader says "minus" rather than "dash". */}
                        <span className="font-mono text-2xs font-normal">
                          {option.points > 0
                            ? `+${option.points}`
                            : option.points < 0
                              ? `\u2212${-option.points}`
                              : option.points}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
              {suggestion !== null && suggested !== undefined && (
                <div className="mt-1 flex items-start justify-between gap-2">
                  <p className="min-w-0 text-xs text-ink-muted">
                    <span className="font-medium text-ink">Heard:</span> &ldquo;
                    {suggestion.evidence}&rdquo;
                  </p>
                  {chosen !== suggested.id && (
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: suggested.id }))}
                      className="shrink-0 rounded-control px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      Use &ldquo;{suggested.label}&rdquo;{' '}
                      <span className="sr-only">for {item.label}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
        {scores.map((score) => {
          let total = 0
          let answered = 0
          for (const item of score.items) {
            const option = item.options.find(({ id }) => id === answers[item.id])
            if (!option) continue
            total += option.points
            answered += 1
          }
          const open = openSource === score.id
          return (
            <div key={score.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-ink">{score.name}</p>
                <span
                  data-testid={`score-total-${score.id}`}
                  className="font-mono text-base font-semibold text-ink"
                >
                  {total}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpenSource(open ? null : score.id)}
                  aria-expanded={open}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {open ? 'Hide source' : 'Source'}{' '}
                  <span className="sr-only">for {score.name}</span>
                </button>
                <p className="text-xs text-ink-muted">
                  {answered} of {score.items.length} answered
                </p>
              </div>
              {open && (
                <div className="mt-2">
                  <SourcesPanel guidelineIds={score.guidelineIds} guidelines={guidelines} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-2xs text-ink-muted">
        Each total sums its own source&rsquo;s items and is not saved with the note. Read what it
        means in that source.
      </p>
    </Card>
  )
}
