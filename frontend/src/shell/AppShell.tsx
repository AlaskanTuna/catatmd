import { useCallback, useState } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { CursorGlow } from '../ui/CursorGlow.js'
import { MobileDock } from './MobileDock.js'
import { SidebarIsland } from './SidebarIsland.js'
import { SiteFooter } from './SiteFooter.js'

/**
 * The signed-in shell, now built on the same two layers as the public one.
 *
 * It shares three things it used to lack: the dot grid, the pointer trail, and
 * the footer. The grid is not decoration here. `backdrop-filter` blurs what is
 * behind it, so over the flat fill this used to have, the sidebar's glass had
 * nothing to blur and read as plain translucency however large the radius was.
 * Texture behind the chrome is what makes frost look like frost.
 *
 * The scrim stays outside the page layer. It has to cover the sidebar as well
 * as the content, so it cannot be a child of the thing it is dimming.
 */
export function AppShell() {
  const [dimmed, setDimmed] = useState(false)
  const onExpandedChange = useCallback((expanded: boolean) => setDimmed(expanded), [])

  // The review screen is a working surface with a sticky approve bar, not a
  // page that ends: the reveal footer is wrong there. `/consultations/new`
  // matches the same pattern, so it is excluded explicitly rather than
  // caught by the param shape.
  const reviewMatch = useMatch('/consultations/:id')
  const suppressFooter = reviewMatch != null && reviewMatch.params.id !== 'new'

  return (
    <div className="reveal-shell">
      <div className={cn('reveal-page dot-grid', suppressFooter && 'reveal-page--no-footer')}>
        <CursorGlow />

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

      {!suppressFooter && <SiteFooter />}
    </div>
  )
}
