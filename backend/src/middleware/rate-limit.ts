import type { Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

/**
 * Resolves the client address behind Render's Cloudflare edge.
 *
 * Identical reasoning to the `ipAddress` block in `lib/auth.ts`, and it has to
 * be repeated here because the two limiters resolve the caller independently:
 * `x-forwarded-for` arrives as a chain, so `trust proxy` has to guess a hop
 * count, and a wrong guess buckets every caller under a Cloudflare edge address
 * rather than their own. `cf-connecting-ip` is single-valued, set by Cloudflare,
 * and overwritten if a client supplies it.
 *
 * `ipKeyGenerator` is still used on the fallback path so IPv6 callers are
 * bucketed by subnet rather than by a single address they can trivially vary.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers['cf-connecting-ip']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded
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
