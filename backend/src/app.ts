import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { clientIp } from './middleware/client-ip.js'
import { errorHandler } from './middleware/error-handler.js'
import {
  analyzeRateLimit,
  audioReadRateLimit,
  audioWriteRateLimit,
  draftTurnsRateLimit,
  ephemeralAnalyzeRateLimit,
  eraseRateLimit,
  guestSignInRateLimit,
  hostedAsrRateLimit,
  liveAnalysisRateLimit,
  liveFlagsRateLimit,
  liveSessionRateLimit,
  prescriptionParseRateLimit,
  settingsWriteRateLimit,
  transcriptCorrectionsRateLimit,
} from './middleware/rate-limit.js'
import { requestContext } from './middleware/request-context.js'
import { requireSession } from './middleware/require-session.js'
import { asrRouter } from './routes/asr.js'
import { authRouter } from './routes/auth.js'
import { consultationsRouter } from './routes/consultations.js'
import { copilotRouter } from './routes/copilot.js'
import { healthRouter } from './routes/health.js'
import { notificationsRouter } from './routes/notifications.js'
import { patientsRouter } from './routes/patients.js'
import { referenceRouter } from './routes/reference.js'
import { settingsRouter } from './routes/settings.js'

/** Routes that carry clinical data. Everything here requires a session. */
const PROTECTED_PREFIXES = [
  '/api/asr',
  '/api/consultations',
  '/api/fixtures',
  '/api/guidelines',
  '/api/notifications',
  '/api/patients',
  '/api/settings',
]

export function createApp() {
  const app = express()

  // Render terminates TLS at its proxy, so the socket address is the proxy's.
  // Without this, express-rate-limit buckets every caller into one buffer.
  app.set('trust proxy', 1)

  // First, so every response carries `x-request-id` and no later middleware can
  // log without a request id in scope (GitHub issue #15).
  app.use(requestContext)

  // Ahead of every limiter, this codebase's and better-auth's, because both
  // read the header it writes. Also ahead of the auth router, which converts
  // the request to a Fetch Request and would otherwise copy the headers before
  // this one is set (#156).
  app.use(clientIp)

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
  // Same destructive class as the consultation batch above, so it shares that
  // bucket rather than a fresh one: both spend irreversible tombstones, and
  // neither should be funded by an unspent analysis budget.
  app.post('/api/patients/:id/erase', eraseRateLimit)
  // A write, so it registers its own limiter like every other one. Neither
  // expensive nor destructive, hence the loosest bucket here (#80).
  app.patch('/api/settings/retention', settingsWriteRateLimit)
  // Buffers up to 25 MB per request and spends provider credit, so its own
  // bucket too; runs after the session guard above and before the route-level
  // body parser, so a limited request is refused before any audio is read (#154).
  app.post('/api/asr/transcriptions', hostedAsrRateLimit)
  // The labelling pass that follows a hosted relay is an LLM call, so it
  // carries its own bucket for the same reason the relay does.
  app.post('/api/asr/draft-turns', draftTurnsRateLimit)
  // Ambient capture mints one provider key per session and streams the audio
  // from the browser, so this bounds key issuance rather than audio (#268).
  app.post('/api/asr/live-sessions', liveSessionRateLimit)
  // The two live panes, bucketed apart because they cost different things
  // (#219). Flags run the rules engine in-process and spend no model budget, so
  // they get a cadence-sized allowance; the fold is an LLM call and gets a
  // small one that cannot borrow from, or exhaust, the Finish analysis above.
  app.post('/api/consultations/:id/live-flags', liveFlagsRateLimit)
  app.post('/api/consultations/:id/live-analysis', liveAnalysisRateLimit)
  // Mishear proposals over the stored transcript (#308). In-process like the
  // flags pane above and writes nothing, but it is a review-time action at
  // human cadence rather than a streaming one, so it gets a much smaller
  // allowance than the live panes.
  app.post('/api/consultations/:id/transcript-corrections', transcriptCorrectionsRateLimit)
  // Prescription parsing (#312). Deterministic and read-only like the two
  // above, and at the same human cadence, so it takes the same allowance.
  app.post('/api/consultations/:id/prescriptions/parse', prescriptionParseRateLimit)
  // The consultation recording (#293). The write carries up to 25 MB and is the
  // only way the audio store grows, so it gets the tightest bucket here; the
  // read is looser because playing a sentence back repeatedly is the behaviour
  // the feature exists for. Separate buckets, so reading cannot exhaust the
  // allowance to store the next recording.
  app.put('/api/consultations/:id/audio', audioWriteRateLimit)
  app.get('/api/consultations/:id/audio', audioReadRateLimit)

  // ── Clinical routers ─────────────────────────────────────────────────────
  // These inherit the session guard and the analyze limiter above, and must
  // stay above `errorHandler` — an error handler registered before a router
  // never sees that router's errors.
  app.use('/api', referenceRouter)
  app.use('/api', notificationsRouter)
  app.use('/api/asr', asrRouter)
  // Above the consultations router, because that one owns `/:id` and would
  // otherwise answer this path first. It inherits the session guard from the
  // `/api/consultations` prefix above and carries its own limiter (#169).
  app.use('/api/consultations/:id/copilot', copilotRouter)
  app.use('/api/patients', patientsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/consultations', consultationsRouter)

  app.use(errorHandler)

  return app
}
