import type { Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { CLIENT_IP_HEADER } from './client-ip.js'

/**
 * Buckets by the caller `middleware/client-ip.ts` resolved, which is the same
 * address better-auth's own limiter keys on. That module owns the reasoning
 * about which headers can be believed; this one only consumes the result.
 *
 * `ipKeyGenerator` is still used on the fallback path so IPv6 callers are
 * bucketed by subnet rather than by a single address they can trivially vary.
 */
export function clientKey(req: Request): string {
  const resolved = req.headers[CLIENT_IP_HEADER]
  if (typeof resolved === 'string' && resolved.length > 0) return resolved
  return ipKeyGenerator(req.ip ?? '')
}

/**
 * Per-IP limiter for `POST /api/consultations/:id/analyze` (docs/trd.md §16) —
 * the only route that spends an LLM call, so the only one where a loop is
 * expensive rather than merely noisy.
 *
 * better-auth limits its own endpoints separately (see `lib/auth.ts`); this
 * covers the clinical surface, which never passes through that router.
 */
export const analyzeRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many analysis requests. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/analyze-ephemeral` (#80).
 *
 * Tighter than `analyzeRateLimit`, and on its own bucket rather than sharing
 * that one, for two reasons. The route is reachable from a guest session, and
 * `POST /api/auth/guest` is limited by neither `express-rate-limit` nor
 * better-auth, so anyone can mint an actor for free. And it takes a transcript
 * in the request body instead of resolving one the caller already owns, so
 * unlike every other clinical route it spends an LLM call without the caller
 * having created anything first.
 *
 * A shared bucket would also let demo traffic exhaust a real doctor's analysis
 * budget, which is the wrong way round.
 */
export const ephemeralAnalyzeRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many analysis requests. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `POST /api/auth/guest`.
 *
 * This endpoint was limited by neither `express-rate-limit` nor better-auth,
 * because it is registered ahead of the better-auth catch-all and so never
 * reaches that router's own limiter. It mints a session for a shared account
 * with no credential of the caller's own, which makes it the cheapest way in
 * the system to obtain an actor that can then spend an analysis budget.
 *
 * Twenty a minute, which is loose enough for a demo audience arriving together
 * behind one clinic NAT and tight enough that minting actors in bulk is not
 * free. It sits on its own bucket so guest traffic cannot exhaust a signed-in
 * doctor's allowance.
 */
export const guestSignInRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many sign-in attempts. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/erase` (#114).
 *
 * Erasure spends no LLM call, so this is not a cost control. It is here because
 * the route is destructive and irreversible: the batch bound stops one request
 * erasing an unbounded number of consultations, and this stops a caller
 * sidestepping that bound by sending many requests.
 *
 * Ten a minute is far above the handful of gestures a doctor tidying a list
 * makes, and far below what a script sweeping ids would need.
 */
export const eraseRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many erase requests. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for the CatatAI copilot stream (#169).
 *
 * Looser than `analyzeRateLimit` because a conversation is many small turns
 * rather than one large job, and a doctor working through a note may send a
 * dozen messages in a minute without doing anything unusual. Still bounded,
 * because every turn is a provider call whose prompt carries the whole
 * consultation digest, so an unbounded panel is the most expensive surface in
 * the product per keystroke.
 *
 * Its own bucket rather than sharing the analysis one: a doctor exploring the
 * copilot must never exhaust the budget for analysing their next consultation,
 * which is the operation the product cannot do without.
 */
export const copilotRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many copilot messages. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `POST /api/asr/transcriptions` (#154).
 *
 * A per-caller cost control: each request spends provider credit per second
 * of audio, so five a minute bounds one caller's spend while staying several
 * times what one doctor finishing recordings can produce. It bounds requests
 * per key per window, not memory; the process-wide cap on concurrent audio
 * buffers is the route's own in-flight gate (`MAX_CONCURRENT_RELAYS` in
 * `routes/asr.ts`). Its own bucket, so relay traffic can neither be funded by
 * an unspent analysis budget nor exhaust one.
 */
export const hostedAsrRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many transcription requests. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/asr/live-sessions`, which mints one ambient
 * session key (#268).
 *
 * Five a minute because one consultation needs one key: the number is a bound
 * on restarts and retries by a human hand, not a throughput allowance. It is
 * the only per-caller control on this path, since the request carries no audio
 * and so needs no in-flight gate; each key it issues is separately bounded by
 * `MAX_SESSION_DURATION_SECONDS`. Its own bucket, so ambient sessions can
 * neither be funded by an unspent relay budget nor exhaust one.
 */
export const liveSessionRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many ambient session requests. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/asr/draft-turns`, the labelling pass that
 * follows a hosted relay. An LLM call, so it registers its own limiter like
 * every route that spends model budget; its own bucket rather than the relay's
 * because a retried labelling attempt must not consume the credit to relay the
 * next recording, and 5/min matches the relay it follows one-to-one.
 */
export const draftTurnsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many labelling requests. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/:id/live-flags`, ambient
 * capture's deterministic pane (#219).
 *
 * Spends no model budget: the route runs the rules engine in-process and calls
 * nothing outward. The limiter exists because every new route registers one,
 * and because an unbounded loop against it is still CPU a caller did not pay
 * for.
 *
 * 120 a minute is sized from the cadence rather than guessed. A segment closes
 * every 3 to 8 seconds, so one live consultation is 8 to 20 requests a minute,
 * and a clinic sitting behind one address can therefore run several at once
 * without any of them being throttled mid-consultation. Throttling this pane
 * is worse than throttling most things: it is the surface that carries red
 * flags.
 */
export const liveFlagsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many live safety checks. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/:id/prescriptions/parse` (#312).
 *
 * Runs no model and writes nothing: it is the deterministic sig parser and
 * lexicon matcher from #311, in process. The limiter exists because every new
 * route registers one, and because the matcher walks an n-gram window over the
 * dictation against the whole lexicon, so an unbounded loop is CPU a caller
 * did not pay for.
 *
 * 30 a minute matches the corrections limiter, and for the same reason: the
 * doctor dictates one prescription, reads the parse, and dictates the next.
 * That is human cadence, not a stream.
 */
export const prescriptionParseRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many prescription checks. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/:id/transcript-corrections`, the
 * mishear proposal surface (#308).
 *
 * **It now spends model budget, which it did not when it was written.** #309
 * added the constrained cleanup pass behind `TRANSCRIPT_CLEANUP`, so this route
 * can fan out to several concurrent provider calls per request. The old comment
 * here said it spent nothing and sized the allowance accordingly; that reasoning
 * is gone rather than merely stale, and the number moved with it.
 *
 * 20 a minute matches `liveAnalysisRateLimit`, which is the closest thing in
 * this file: a model-backed route at a cadence a person sets rather than a
 * stream. It is deliberately not `analyzeRateLimit`'s 10, because that route
 * always spends a model call and this one usually spends none: the cleanup pass
 * is off by default, and even switched on the client keys its query on the
 * stored transcript text, so a doctor opening one consultation asks once and
 * asks again only after saving an edit.
 *
 * **The floor it must not drop below is the deterministic half.** Layer 2 ships
 * unconditionally and is free, so this limiter refusing a request also refuses
 * the measured mishear proposals. That is the cost of the two sharing a route,
 * and it is why the number did not simply follow the paid egress down.
 */
export const transcriptCorrectionsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many correction checks. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `POST /api/consultations/:id/live-analysis`, the
 * model-backed half of the live panes (#219).
 *
 * One consultation at the 12 second cadence is 5 requests a minute, so 20
 * covers roughly four clinicians on one address. **Its own bucket, and that is
 * the point:** live cycles must not be fundable from, nor able to exhaust,
 * `analyzeRateLimit`. The Finish analysis is the operation the product cannot
 * do without, and a doctor who has just finished a consultation must never be
 * refused it because the live pane spent the budget while they were talking.
 *
 * Per-request cost is separately bounded by `MAX_LIVE_DELTA_TURNS` and
 * `MAX_LIVE_DELTA_CHARACTERS`. **There is still no per-actor or global spend
 * cap**, which is the same open gap `hostedAsrRateLimit` and
 * `liveSessionRateLimit` already record rather than a new one.
 */
export const liveAnalysisRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many live analysis requests. Please retry shortly.',
    },
  },
})

/**
 * Per-IP limiter for `PATCH /api/settings/retention` (#80).
 *
 * Not a cost control and not a destructive one: the route writes a single
 * integer on the caller's own account row. It is here because security.md
 * requires every new write route to register its own limiter, and because a
 * write is a write, and an unbounded one is a free way to keep a database
 * connection busy. Twenty a minute is far above a doctor adjusting a setting
 * and far below anything worth doing in a loop.
 */
export const settingsWriteRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many settings updates. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `PUT /api/consultations/:id/audio` (#293).
 *
 * Not a cost control: nothing outward is called. It bounds a write that can
 * carry 25 MB, which makes it the largest body the clinical surface accepts and
 * the cheapest way to fill a database. Five a minute matches
 * `hostedAsrRateLimit`, which bounds the same recording arriving by the other
 * route, so one doctor finishing recordings sees the same allowance whichever
 * path their audio took.
 */
export const audioWriteRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many recording uploads. Please retry shortly.' },
  },
})

/**
 * Per-IP limiter for `GET /api/consultations/:id/audio` (#293).
 *
 * Looser than the write because playing back is the behaviour the feature
 * exists to encourage, and a doctor checking several sentences across a
 * consultation legitimately fetches more than once. Still bounded, because each
 * response can be megabytes and the route is the only one on the clinical
 * surface where that is true.
 *
 * Its own bucket, so reading a recording can neither be funded by, nor exhaust,
 * the allowance to store the next one.
 */
export const audioReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: { code: 'rate_limited', message: 'Too many recording requests. Please retry shortly.' },
  },
})
