import { Loader2, Play, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useMatch } from 'react-router-dom'
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

  // On a consultation record the corner belongs to CatatAI rather than to the
  // tour, so this yields the corner entirely rather than competing for it.
  // `new` is excluded because the intake screen shares the route shape but is
  // not a record.
  const review = useMatch('/consultations/:id')
  const onRecord = review !== null && review.params.id !== 'new'

  // A native <dialog> gives focus trapping, Escape, inertness of the page
  // behind it and the top layer for free. Hand-rolling those is how a modal
  // ends up half-accessible.
  useEffect(() => {
    if (active) dialog.current?.close()
  }, [active])

  if (active || onRecord) return null

  return (
    <>
      {/* Round, and the one deliberate exception to the rounded-rectangle CTA
          rule in docs/DESIGN.md. A floating action button is a persistent
          affordance parked over the content rather than an action inside a
          layout, and the circle is what separates it from the interface it
          floats above. A bare glyph rather than lucide's `HelpCircle`, whose
          own ring would sit inside this one and read as a double border. */}
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        data-print="hide"
        aria-label="Take the guided tour"
        title="Guided Tour"
        style={{ zIndex: 'var(--z-sticky)' }}
        /*
         * Bottom-right corner, lifted only where something is genuinely under
         * it. A single global offset was the previous approach and it parked
         * the button 7rem up on every screen, which reads as misplaced on the
         * majority that have no bottom chrome at all.
         *
         * The one thing it has to clear, measured rather than guessed: the
         * mobile dock below `md` reaches about 4.5rem up (`bottom-3` plus a
         * `min-h-12` row and padding). Everywhere else gets the corner.
         *
         * The approve bar used to be the other one, and no longer is: this
         * button does not render on a consultation record at all now, so the
         * `--approve-bar-height` half of `.fab-anchor` is there for CatatAI's
         * button rather than for this one.
         */
        className="glass fab-anchor fixed flex size-12 items-center justify-center rounded-full text-lg font-semibold text-accent transition-[transform,color] duration-150 ease-out-quart hover:text-accent-hover active:scale-[0.94]"
      >
        <span aria-hidden>?</span>
      </button>

      <dialog
        ref={dialog}
        data-print="hide"
        className="glass-panel m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
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
            {TOUR_STEP_COUNT} steps through a consultation the tour analyses for you: the
            transcript, the red flags and where they came from, what the consultation never
            established, and the approval gate.
          </p>

          {/* The three facts a clinician or an evaluator would otherwise have to
              take on trust, stated before they agree to anything. */}
          <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-muted">
            <li className="flex gap-2">
              <span aria-hidden className="text-accent">
                &middot;
              </span>
              It runs the real pipeline on a simulated transcript. The analysis starts now and runs
              while you walk the first couple of screens. Nothing is mocked or replayed.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-accent">
                &middot;
              </span>
              Nothing is saved. The analysis exists only in this tab and is discarded when the tour
              ends.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-accent">
                &middot;
              </span>
              Your own consultations are untouched.
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
              {preparing ? 'Analysing' : 'Start Tour'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
