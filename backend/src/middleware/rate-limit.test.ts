import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { auth } from '../lib/auth.js'
import { CLIENT_IP_HEADER } from './client-ip.js'
import { clientKey } from './rate-limit.js'

const asRequest = (headers: Record<string, string>, ip?: string) =>
  ({ headers, ip }) as unknown as Request

/**
 * Regression cover for a production defect: behind Render's Cloudflare edge,
 * `x-forwarded-for` arrives as a chain, both limiters failed to resolve a
 * client address, and every caller fell into one shared bucket, which turns a
 * brute-force control into a denial-of-service vector.
 *
 * Which headers can be believed is `client-ip.ts`'s problem and is covered in
 * `client-ip.test.ts`. What matters here is that this limiter reads the address
 * that module published and never re-derives its own.
 */
describe('client address resolution', () => {
  it('buckets by the resolved address', () => {
    expect(clientKey(asRequest({ [CLIENT_IP_HEADER]: '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('does not collapse two different callers into one bucket', () => {
    const a = clientKey(asRequest({ [CLIENT_IP_HEADER]: '203.0.113.9' }))
    const b = clientKey(asRequest({ [CLIENT_IP_HEADER]: '198.51.100.7' }))
    expect(a).not.toBe(b)
  })

  /**
   * Raw `cf-connecting-ip` is no longer this module's input. Since #156 it can
   * hold Vercel's address rather than the caller's, so reading it here would
   * reintroduce the shared bucket for every proxied request.
   */
  it('ignores cf-connecting-ip, which the middleware owns', () => {
    const key = clientKey(asRequest({ 'cf-connecting-ip': '203.0.113.9' }, '192.0.2.44'))
    expect(key).toBe('192.0.2.44')
  })

  it('falls back to req.ip where the middleware resolved nothing', () => {
    expect(clientKey(asRequest({}, '192.0.2.44'))).toBe('192.0.2.44')
  })

  it('keys better-auth on the same resolved address', () => {
    // better-auth takes header names rather than a resolver, so agreeing with
    // this limiter means both reading the one header the middleware writes.
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([CLIENT_IP_HEADER])
  })
})

/**
 * `sameSite` was `none` while the SPA called this API cross-origin. Since #156
 * the browser reaches it on the SPA's own origin, so requests are same-site and
 * `lax` is both correct and stricter.
 *
 * Pinned because the failure is silent in the direction that matters: widening
 * it back to `none` costs the CSRF protection without breaking anything a test
 * would otherwise notice.
 */
describe('session cookie attributes', () => {
  it('scopes the session cookie to same-site requests', () => {
    expect(auth.options.advanced?.defaultCookieAttributes?.sameSite).toBe('lax')
  })

  it('keeps the cookie httpOnly', () => {
    expect(auth.options.advanced?.defaultCookieAttributes?.httpOnly).toBe(true)
  })
})
