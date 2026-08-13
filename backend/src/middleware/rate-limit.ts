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
