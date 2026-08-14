import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import {
  analyzeRateLimit,
  ephemeralAnalyzeRateLimit,
  eraseRateLimit,
  guestSignInRateLimit,
} from './middleware/rate-limit.js'
import { requestContext } from './middleware/request-context.js'
import { requireSession } from './middleware/require-session.js'
import { authRouter } from './routes/auth.js'
import { consultationsRouter } from './routes/consultations.js'
import { healthRouter } from './routes/health.js'
import { notificationsRouter } from './routes/notifications.js'
import { referenceRouter } from './routes/reference.js'

/** Routes that carry clinical data. Everything here requires a session. */
const PROTECTED_PREFIXES = [
  '/api/consultations',
  '/api/fixtures',
  '/api/guidelines',
  '/api/notifications',
]

export function createApp() {
  const app = express()

  // Render terminates TLS at its proxy, so the socket address is the proxy's.
  // Without this, express-rate-limit buckets every caller into one buffer.
  app.set('trust proxy', 1)

  // First, so every response carries `x-request-id` and no later middleware can
  // log without a request id in scope (GitHub issue #15).
  app.use(requestContext)

  // CSP is left at helmet's default: the SPA is served by Vercel, not by this
  // API, so this process only ever emits JSON (docs/trd.md §16).
  app.use(helmet())
  app.use(compression())
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))

  // Ahead of the auth router, for the same reason the clinical limiters sit
  // ahead of theirs. `/api/auth/guest` is registered before better-auth's
  // catch-all and so never reaches that router's own limiter, which left the
  // cheapest way to mint an actor unbounded.
  app.post('/api/auth/guest', guestSignInRateLimit)

  // Before express.json() — better-auth consumes the raw request stream.
  app.use('/api', authRouter)

  app.use(express.json({ limit: '1mb' }))

  app.use('/api', healthRouter)

  for (const prefix of PROTECTED_PREFIXES) {
    app.use(prefix, requireSession)
  }

  // Registered ahead of the consultation routes themselves so the limiter runs
  // whichever router later owns this path.
  app.post('/api/consultations/:id/analyze', analyzeRateLimit)
  // Separate bucket, and tighter: this one is guest-reachable and takes its
  // transcript from the body, so it spends an LLM call without the caller
  // having stored anything first (#80).
  app.post('/api/consultations/analyze-ephemeral', ephemeralAnalyzeRateLimit)
  // Destructive and irreversible rather than expensive, so its own bucket: an
  // erase sweep must not be funded by an unspent analysis budget (#114).
  app.post('/api/consultations/erase', eraseRateLimit)

  // ── Clinical routers ─────────────────────────────────────────────────────
  // These inherit the session guard and the analyze limiter above, and must
  // stay above `errorHandler` — an error handler registered before a router
  // never sees that router's errors.
  app.use('/api', referenceRouter)
  app.use('/api', notificationsRouter)
  app.use('/api/consultations', consultationsRouter)

  app.use(errorHandler)

  return app
}
