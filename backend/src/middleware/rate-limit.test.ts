import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { auth } from '../lib/auth.js'
import { clientKey } from './rate-limit.js'

const asRequest = (headers: Record<string, string>, ip?: string) =>
  ({ headers, ip }) as unknown as Request

/**
 * Regression cover for a production defect: behind Render's Cloudflare edge,
 * `x-forwarded-for` arrives as a chain, both limiters failed to resolve a
 * client address, and every caller fell into one shared bucket — which turns a
 * brute-force control into a denial-of-service vector.
 */
describe('client address resolution behind the Cloudflare edge', () => {
  it('prefers cf-connecting-ip over a multi-entry x-forwarded-for', () => {
    const key = clientKey(
      asRequest({
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '203.0.113.9, 172.71.0.1, 10.0.0.5',
      }),
    )
    expect(key).toBe('203.0.113.9')
  })

  it('does not collapse two different callers into one bucket', () => {
    const chain = '198.51.100.7, 172.71.0.1, 10.0.0.5'
    const a = clientKey(asRequest({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': chain }))
    const b = clientKey(asRequest({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': chain }))
    expect(a).not.toBe(b)
  })

  it('falls back to req.ip where no Cloudflare header is present', () => {
    expect(clientKey(asRequest({}, '192.0.2.44'))).toBe('192.0.2.44')
  })

  it('keeps cf-connecting-ip ahead of x-forwarded-for in the auth config', () => {
    // better-auth 1.6.27 rejects a multi-entry x-forwarded-for outright unless
    // trustedProxies is set, so the ordering here is the fix, not a preference.
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders?.[0]).toBe('cf-connecting-ip')
  })
})
