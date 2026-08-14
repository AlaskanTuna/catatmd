import { Toaster as HotToaster } from 'react-hot-toast'

/**
 * The app's one transient-feedback surface (issue #116).
 *
 * **Top centre because every other edge is taken.** The chrome cluster holds
 * the top right, the guided-tour button the bottom right, the mobile dock the
 * bottom, and the sidebar island the left. Top centre is the only region no
 * fixed element occupies at any breakpoint. The offset reuses
 * `--live-banner-inset`, so toasts drop below the dev-only live-data banner and
 * sit at the plain inset in production, where nothing defines that variable.
 *
 * Styling is by token rather than by this library's defaults, so a toast reads
 * as part of the app in both themes instead of as a white card in dark mode.
 *
 * Motion needs no handling here: the blanket `prefers-reduced-motion` rule in
 * index.css uses `!important`, which beats the inline animation this library
 * sets.
 *
 * **Nothing clinical goes in a toast.** These are confirmations of actions the
 * doctor just took, not a place to surface note content, a red flag or a
 * finding: a message that fades after four seconds is the wrong carrier for
 * anything a clinician has to act on.
 */
export function Toaster() {
  return (
    <HotToaster
      position="top-center"
      containerStyle={{ top: 'calc(1rem + var(--live-banner-inset, 0px))' }}
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          border: '1px solid var(--color-line)',
          borderRadius: 'var(--radius-control)',
          boxShadow: 'var(--shadow-raised)',
          fontSize: '0.875rem',
          maxWidth: '30rem',
        },
        success: {
          iconTheme: { primary: 'var(--color-accent)', secondary: 'var(--color-surface)' },
        },
        error: {
          // Longer, because a failure is the one a doctor may need to read
          // twice and then act on.
          duration: 6000,
          iconTheme: { primary: 'var(--color-emergency)', secondary: 'var(--color-surface)' },
        },
      }}
    />
  )
}
