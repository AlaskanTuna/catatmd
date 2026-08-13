import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MobileDock } from './MobileDock.js'
import { SidebarIsland } from './SidebarIsland.js'

/**
 * The one scrim for the whole app.
 *
 * A single fixed compositor layer carries the blur and dim while the sidebar is
 * expanded. The alternative, filtering the content subtree, repaints the entire
 * review screen on every hover and is what makes this effect feel cheap.
 *
 * Reduced motion drops the blur to dim-only in CSS rather than here: the
 * outcome (the layer beneath is de-emphasised) survives, only the transition
 * and the expensive filter go. Motion degrades to an instant state change,
 * never to no state change (issue #30).
 */
export function AppShell() {
  const [dimmed, setDimmed] = useState(false)
  const onExpandedChange = useCallback((expanded: boolean) => setDimmed(expanded), [])

  return (
    <div className="min-h-dvh">
      <SidebarIsland onExpandedChange={onExpandedChange} />

      <div className="scrim" data-visible={dimmed} data-print="hide" aria-hidden />

      <MobileDock />

      {/* On md+ the left offset clears the collapsed island and never reflows
          when it expands: content shifting under a hover would be worse than
          the dimming it replaces. On small screens the dock is at the bottom,
          so the padding moves there to clear it. */}
      <main className="px-4 pt-6 pb-28 md:py-6 md:pr-6 md:pl-24">
        <Outlet />
      </main>
    </div>
  )
}
