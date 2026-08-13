import { toNodeHandler } from 'better-auth/node'
import { Router } from 'express'
import { env } from '../config/env.js'
import { auth } from '../lib/auth.js'

export const authRouter = Router()

/**
 * "Sign in as guest" (#29) — a **single shared demo account**, decided
 * 13/08/26. Concurrent guests see each other's consultations; that risk was
 * raised and explicitly accepted, and the sign-in screen states it.
 *
 * The credentials are held server-side and exchanged here rather than shipped
 * to the SPA: a browser-side sign-in would put the demo password in the
 * JavaScript bundle, which is not "environment configuration" in any useful
 * sense.
 *
 * This is not a bypass. It calls better-auth's own `signInEmail` against a real
 * seeded user, so the caller receives an ordinary session cookie and is subject
 * to `requireSession` and `assertOwnedConsultation` exactly like any other
 * doctor. Guest ownership scoping is therefore not a special case, and the
 * seeded doctors' consultations stay invisible to it.
 *
 * Registered before the better-auth catch-all below so `/api/auth/guest` is
 * not swallowed by it.
 */
authRouter.post('/auth/guest', async (_req, res) => {
  if (!env.GUEST_EMAIL || !env.GUEST_PASSWORD) {
    res.status(404).json({
      error: { code: 'guest_disabled', message: 'Guest access is not enabled.' },
    })
    return
  }

  const response = await auth.api.signInEmail({
    body: { email: env.GUEST_EMAIL, password: env.GUEST_PASSWORD },
    asResponse: true,
  })

  for (const cookie of response.headers.getSetCookie()) {
    res.append('Set-Cookie', cookie)
  }

  res.status(response.status === 200 ? 200 : 503).json(
    response.status === 200
      ? { ok: true }
      : {
          error: {
            code: 'guest_unavailable',
            message: 'The guest account is not available. It may not have been seeded.',
          },
        },
  )
})

/**
 * better-auth owns everything else under `/api/auth/**` — sign-up, sign-in,
 * sign-out, session. Mounted, never re-implemented (docs/trd.md §13).
 *
 * Must be registered before `express.json()`: better-auth reads the raw request
 * stream itself, and a body parser that has already consumed it leaves the
 * handler waiting on a stream that will never emit.
 */
authRouter.all('/auth/*splat', toNodeHandler(auth))
