import { useCallback, useState } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import { DemoStepBar } from '../demo/DemoStepBar.js'
import { DemoTourProvider } from '../demo/DemoTour.js'
import { HelpButton } from '../demo/HelpButton.js'
import { Spotlight } from '../demo/Spotlight.js'
import { cn } from '../lib/cn.js'
import { CursorGlow } from '../ui/CursorGlow.js'
import { ChromeCluster } from './ChromeCluster.js'
import { LiveDataWarning } from './LiveDataWarning.js'
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
    // The tour provider wraps the shell rather than the app, so it sits inside
    // the authenticated boundary: it walks real consultations and has nothing
    // to narrate on the marketing routes.
    <DemoTourProvider>
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
          {/* Every signed-in route renders a bare `mx-auto max-w-*` container with
              no vertical spacing of its own, so this padding is the only thing
              between a page header and the top of the viewport. The bottom half
              also has to clear two different things: the mobile dock below md,
              and the sticky approve bar on the review screen. */}
          {/* The top half clears `ChromeCluster`, which is fixed and therefore
              out of flow. It ends 62px down, so 80px clears it with a gap and
              the cluster reads as chrome sitting above the hero rather than
              floating on it.

              One value at every width, because this is not a mobile-only
              collision. Measured on the deployed build: 30px of overlap at
              390px, and still 22px tall by 62px wide at 1024px. The page
              container is `max-w-3xl` inside `pl-24`, so its right edge only
              clears the cluster's left edge once the viewport passes ~1148px.
              Every narrower desktop window collides, which is most of them
              that are not maximised on a large display. */}
          <main className="px-4 pt-20 pb-32 md:pb-10 md:pr-6 md:pl-24">
            <Outlet />
          </main>
        </div>

        {!suppressFooter && <SiteFooter />}

        {/* Outside the page layer: the spotlight ring and the step bar sit above
            the sidebar and the scrim, and a coachmark clipped by the surface it
            is pointing at would defeat itself. */}
        <LiveDataWarning />
        <ChromeCluster />
        <HelpButton />
        <DemoStepBar />
        <Spotlight />
      </div>
    </DemoTourProvider>
  )
}
