import type { NextFunction, Request, Response } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

const asRequest = (headers: Record<string, string>) => ({ headers }) as unknown as Request

/**
 * `trustedProxies` is built once at module load, so each allow-list has to be
 * installed before the module is imported.
 */
async function load(trusted: string) {
  vi.resetModules()
  vi.stubEnv('TRUSTED_PROXY_IPS', trusted)
  return await import('./client-ip.js')
}

const VERCEL_EDGE = '76.76.21.21'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('resolveClientIp', () => {
  it('returns the Cloudflare peer for a caller reaching the API directly', async () => {
    const { resolveClientIp } = await load('')
    const ip = resolveClientIp(
      asRequest({
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '203.0.113.9, 172.71.0.1',
      }),
    )
    expect(ip).toBe('203.0.113.9')
  })

  /**
   * The bypass this allow-list exists to prevent. Render is publicly reachable,
   * so a caller can skip Vercel entirely and post straight to the API with any
   * `x-forwarded-for` they like, rotating it per request to get a fresh bucket
   * each time. Their `cf-connecting-ip` is set by Cloudflare and cannot be
   * forged, so it has to win.
   */
  it('ignores a forged x-forwarded-for from an untrusted peer', async () => {
    const { resolveClientIp } = await load(VERCEL_EDGE)
    const forged = asRequest({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.200',
    })
    expect(resolveClientIp(forged)).toBe('203.0.113.9')
  })

  it('reads the forwarded caller when the peer is a trusted edge', async () => {
    const { resolveClientIp } = await load(VERCEL_EDGE)
    const ip = resolveClientIp(
      asRequest({
        'cf-connecting-ip': VERCEL_EDGE,
        'x-forwarded-for': '203.0.113.9, 172.71.0.1',
      }),
    )
    expect(ip).toBe('203.0.113.9')
  })

  it('does not collapse two proxied callers into one bucket', async () => {
    const { resolveClientIp } = await load(VERCEL_EDGE)
    const proxied = (client: string) =>
      resolveClientIp(asRequest({ 'cf-connecting-ip': VERCEL_EDGE, 'x-forwarded-for': client }))
    expect(proxied('203.0.113.9')).not.toBe(proxied('198.51.100.7'))
  })

  it('falls back to the trusted peer when it forwards no caller', async () => {
    const { resolveClientIp } = await load(VERCEL_EDGE)
    expect(resolveClientIp(asRequest({ 'cf-connecting-ip': VERCEL_EDGE }))).toBe(VERCEL_EDGE)
  })

  /**
   * With no allow-list configured the proxied path degrades to one shared
   * bucket rather than to a spoofable one. Shared is the safer failure: it
   * costs availability, where believing `x-forwarded-for` would cost the
   * control itself.
   */
  it('degrades to the peer, not to x-forwarded-for, when no proxy is trusted', async () => {
    const { resolveClientIp } = await load('')
    const ip = resolveClientIp(
      asRequest({ 'cf-connecting-ip': VERCEL_EDGE, 'x-forwarded-for': '203.0.113.9' }),
    )
    expect(ip).toBe(VERCEL_EDGE)
  })

  it('reports no address where Cloudflare is not in front', async () => {
    const { resolveClientIp } = await load('')
    expect(resolveClientIp(asRequest({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull()
  })
})

describe('clientIp middleware', () => {
  const run = (mod: { clientIp: typeof import('./client-ip.js').clientIp }, req: Request) => {
    const next = vi.fn() as unknown as NextFunction
    mod.clientIp(req, {} as Response, next)
    return next
  }

  /**
   * The header is the limiters' only input, so a caller who could set it would
   * choose their own bucket. It is written unconditionally for exactly that
   * reason.
   */
  it('overwrites a caller-supplied resolved-ip header', async () => {
    const mod = await load('')
    const req = asRequest({
      'x-resolved-client-ip': '198.51.100.200',
      'cf-connecting-ip': '203.0.113.9',
    })
    run(mod, req)
    expect(req.headers[mod.CLIENT_IP_HEADER]).toBe('203.0.113.9')
  })

  it('strips a caller-supplied header when no address can be resolved', async () => {
    const mod = await load('')
    const req = asRequest({ 'x-resolved-client-ip': '198.51.100.200' })
    run(mod, req)
    expect(req.headers[mod.CLIENT_IP_HEADER]).toBeUndefined()
  })

  it('calls next', async () => {
    const mod = await load('')
    expect(run(mod, asRequest({}))).toHaveBeenCalledOnce()
  })
})
