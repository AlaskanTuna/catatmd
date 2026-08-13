import { Loader2, Play, Sparkles, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { TOUR_STEP_COUNT, useDemoTour } from './DemoTour.js'

/**
 * The way in: a floating button, and a dialog that says what is about to happen
 * before it happens.
 *
 * The confirm step is not ceremony. The tour navigates the app on the user's
 * behalf, and a control that starts moving someone around their own screens
 * without warning is hostile. It is also where the honest disclosure lives:
 * this walks real analysed consultations and changes nothing.
 *
 * Hidden while the tour runs, because the button that starts it is meaningless
 * once it has started and would only compete with the step bar's End control.
 */
export function HelpButton() {
  const { active, preparing, start } = useDemoTour()
  const dialog = useRef<HTMLDialogElement>(null)

  // A native <dialog> gives focus trapping, Escape, inertness of the page
  // behind it and the top layer for free. Hand-rolling those is how a modal
  // ends up half-accessible.
  useEffect(() => {
    if (active) dialog.current?.close()
  }, [active])

  if (active) return null

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        data-print="hide"
        style={{ zIndex: 'var(--z-sticky)' }}
        className="glass fixed right-4 bottom-20 flex h-12 items-center gap-2 rounded-control px-4 text-sm font-medium text-ink transition-[transform,background-color] duration-150 ease-out-quart hover:text-accent active:scale-[0.97] md:right-6 md:bottom-6"
      >
        <Sparkles aria-hidden className="size-4 text-accent" />
        Guided Tour
      </button>

      <dialog
        ref={dialog}
        data-print="hide"
        className="m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Take the Guided Tour</h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Close"
              className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {TOUR_STEP_COUNT} steps through a real consultation: the transcript, the red flags and
            where they came from, what the consultation never established, and the approval gate.
          </p>

          {/* The two facts a clinician or an evaluator would otherwise have to
              take on trust, stated before they agree to anything. */}
          <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-muted">
            <li className="flex gap-2">
              <span aria-hidden className="text-accent">
                &middot;
              </span>
              Everything shown was produced by the real pipeline. Nothing is mocked or replayed.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-accent">
                &middot;
              </span>
              It only navigates and explains. Nothing is created, edited or approved for you.
            </li>
          </ul>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="flex h-10 items-center rounded-control px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              Not Now
            </button>
            <button
              type="button"
              disabled={preparing}
              onClick={start}
              className="flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97] disabled:pointer-events-none disabled:opacity-70"
            >
              {preparing ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Play aria-hidden className="size-4" />
              )}
              {preparing ? 'Preparing' : 'Start Tour'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
