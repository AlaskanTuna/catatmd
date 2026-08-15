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
