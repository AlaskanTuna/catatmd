import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

/**
 * The single header every per-caller limiter reads, both this codebase's
 * (`middleware/rate-limit.ts`) and better-auth's (`lib/auth.ts`).
 *
 * It is written on every request and never read from the client, so a caller
 * supplying it cannot choose its own bucket. better-auth takes a list of header
 * names rather than a resolver function, so funnelling both limiters through
 * one header is what lets them agree on the caller without the resolution
 * logic being written twice.
 */
export const CLIENT_IP_HEADER = 'x-resolved-client-ip'

const trustedProxies = new Set(
  env.TRUSTED_PROXY_IPS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
)

function leftmostForwardedFor(req: Request): string | null {
  const header = req.headers['x-forwarded-for']
  const raw = Array.isArray(header) ? header[0] : header
  const first = raw?.split(',')[0]?.trim()
  return first ? first : null
}

/**
 * Resolves the caller behind Render's Cloudflare edge, and behind the Vercel
 * rewrite in front of it (#156).
 *
 * `cf-connecting-ip` is the only address here that cannot be forged: Cloudflare
 * sets it from the TCP peer and overwrites anything the caller supplied. It is
 * therefore the default, and for a caller reaching Render directly it is the
 * answer.
 *
 * Since #156 the SPA's API calls arrive through a Vercel rewrite instead, so
 * that peer is Vercel and every caller would otherwise collapse into one
 * bucket. The real address is then the leftmost `x-forwarded-for` entry, which
 * Vercel recorded.
 *
 * Reading that entry unconditionally would be a downgrade rather than a fix.
 * Render is publicly reachable, so a caller who skips Vercel and posts straight
 * to the API can put anything in `x-forwarded-for` and rotate it per request,
 * which is exactly the bypass the limiter exists to prevent. The allow-list is
 * what closes that: `x-forwarded-for` is consulted only when the unforgeable
 * peer is a known edge address, so a direct caller is always keyed by the
 * address Cloudflare observed and their forged header is ignored.
 *
 * With `TRUSTED_PROXY_IPS` unset the proxied path degrades to a shared bucket
 * rather than to a spoofable one. That is the safer of the two failure modes,
 * and it is the pre-#156 behaviour.
 */
export function resolveClientIp(req: Request): string | null {
  const edge = req.headers['cf-connecting-ip']
  const peer = typeof edge === 'string' && edge.length > 0 ? edge : null
  if (!peer) return null
  if (!trustedProxies.has(peer)) return peer
  return leftmostForwardedFor(req) ?? peer
}

export function clientIp(req: Request, _res: Response, next: NextFunction): void {
  const resolved = resolveClientIp(req)
  if (resolved) {
    req.headers[CLIENT_IP_HEADER] = resolved
  } else {
    delete req.headers[CLIENT_IP_HEADER]
  }
  next()
}
