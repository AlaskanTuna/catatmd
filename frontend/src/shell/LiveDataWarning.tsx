import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useEffect } from 'react'
import { api } from '../lib/api.js'

/**
 * Says so, on screen, when this development build is writing to the shared
 * database (issue #106).
 *
 * The hazard it exists for is specific and was not hypothetical: a review
 * control clicked during local testing wrote a real dismissal into the demo
 * account, because `.env` pointed at the deployed Supabase instance and nothing
 * on screen said so. `docker-compose.yml` gives a local Postgres, but adopting
 * it is opt-in, so until a developer switches their `.env` the hazard is still
 * there and silent. This makes it loud.
 *
 * **It cannot appear in production, and that is structural rather than
 * careful.** Two independent conditions must both hold, and either alone is
 * sufficient to prevent it:
 *
 * 1. `import.meta.env.DEV` is a compile-time constant that is `false` in every
 *    `vite build`, so this component's body is eliminated from the production
 *    bundle. The code is not shipped, not merely unreached.
 * 2. The API omits `database` entirely when `NODE_ENV` is production, so even a
 *    development bundle pointed at the deployed API is told nothing to warn
 *    about.
 *
 * That ordering matters. A banner reading "non-production" on the real product,
 * during an evaluation, would be a worse failure than the one it prevents, so
 * the safe direction is the default: say nothing unless positively told there
 * is something to say.
 */
export function LiveDataWarning() {
  // Guard first, so everything below is dead code in a production build.
  if (!import.meta.env.DEV) return null
  return <LiveDataBanner />
}

/** `py-1.5` around a `text-xs` line, plus a small gap for what sits beneath. */
const BANNER_HEIGHT = '2rem'

function LiveDataBanner() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const showing = health.data?.database === 'remote'

  // Published as a custom property so fixed chrome can sit below this banner
  // without importing anything from it, and without production paying for a
  // dev-only concern: nothing sets this variable in a production build, so the
  // fallback of zero is what ships (#116).
  useEffect(() => {
    if (!showing) return
    const root = document.documentElement
    root.style.setProperty('--live-banner-inset', BANNER_HEIGHT)
    return () => {
      root.style.removeProperty('--live-banner-inset')
    }
  }, [showing])

  // Anything other than an explicit `remote` is silence, including an error, a
  // pending fetch, and the absent field a production API returns.
  if (!showing) return null

  return (
    <div
      role="status"
      data-print="hide"
      style={{ zIndex: 'var(--z-toast)' }}
      className="fixed inset-x-0 top-0 flex items-center justify-center gap-2 bg-urgent-rule px-4 py-1.5 text-center text-xs font-medium text-ink"
    >
      <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
      <span>
        Development build connected to the <strong>shared database</strong>. Anything you approve,
        edit or dismiss here changes real data. Run <code>docker compose up -d</code> and point{' '}
        <code>DATABASE_URL</code> at it to work locally.
      </span>
    </div>
  )
}
