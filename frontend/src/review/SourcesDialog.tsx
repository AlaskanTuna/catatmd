import type { ClinicalSuggestion, GuidelineChunk } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'

export function SourcesDialog({
  suggestions,
  guidelines,
  outOfScope,
  className,
}: {
  suggestions: ClinicalSuggestion[]
  guidelines: GuidelineChunk[]
  outOfScope: boolean | undefined
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const citedIds = suggestions.flatMap((suggestion) =>
    suggestion.citations.map((citation) => citation.guidelineId),
  )

  const seen = new Set<string>()
  const uniqueIds: string[] = []
  for (const id of citedIds) {
    if (!seen.has(id)) {
      seen.add(id)
      uniqueIds.push(id)
    }
  }

  const resolved = uniqueIds
    .map((id) => guidelines.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is GuidelineChunk => chunk !== undefined)

  useEffect(() => {
    if (!isOpen) return
    dialogRef.current?.showModal()
    /*
     * Focus the first control once the content mounts. The list is gated on
     * state, so it is not in the DOM when `showModal()` runs its own autofocus
     * pass. The close button is the first button in the dialog so this focuses
     * it.
     */
    dialogRef.current?.querySelector('button')?.focus()
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-print="hide"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-control border border-line bg-sunken-soft px-3 py-1.5 text-2xs font-medium text-ink shadow-raised transition-colors hover:bg-sunken',
          className,
        )}
      >
        Sources {resolved.length}
      </button>

      <dialog
        ref={dialogRef}
        data-print="hide"
        onClose={() => setIsOpen(false)}
        aria-labelledby="sources-title"
        className="glass-panel m-auto w-[44rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {isOpen && (
          <div className="flex max-h-[80vh] flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
              <h2 id="sources-title" className="font-display text-lg font-semibold">
                Sources
              </h2>
              <Button size="sm" variant="neutral" onClick={() => dialogRef.current?.close()}>
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-6">
              {resolved.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  {outOfScope === true
                    ? "Outside the guideline corpus's scope, so no guideline was cited."
                    : outOfScope === false
                      ? "Within the guideline corpus's scope, with nothing to cite for this consultation."
                      : 'This consultation was analysed before scope was recorded, so whether the corpus applied is not known.'}
                </p>
              ) : (
                resolved.map((chunk) => (
                  <div key={chunk.id} className="flex flex-col gap-1">
                    <span className="inline-flex min-h-6 w-fit items-center rounded-full border border-line bg-sunken px-2.5 py-1 font-mono text-2xs text-ink">
                      {chunk.id}
                    </span>
                    <p className="text-sm font-medium text-ink">{chunk.title}</p>
                    <p className="text-2xs text-ink-muted">
                      {chunk.publisher} · {chunk.year}
                    </p>
                    <p className="text-xs text-ink-muted">{chunk.summary}</p>
                    <p className="text-2xs text-ink-muted">Licence: {chunk.sourceLicence}</p>
                    <a
                      href={chunk.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-block w-fit text-xs font-medium text-accent underline underline-offset-2"
                    >
                      Open Guideline
                    </a>
                  </div>
                ))
              )}
              <p className="border-t border-line pt-3 text-2xs text-ink-muted">
                CatatMD can only cite guidelines from this curated Malaysian corpus. A reference
                outside it fails validation and never reaches this screen.
              </p>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
