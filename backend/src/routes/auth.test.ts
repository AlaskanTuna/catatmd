import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'

/**
 * better-auth reaches the database through the same client as everything else
 * (`prismaAdapter(prisma)`, `../lib/auth.ts`), so mocking this one module takes
 * every database path in this file offline at once: session resolution, sign-up,
 * and the database-backed rate limiter that was persisting 429s across runs
 * (issue #57).
 *
 * `requireSession` is deliberately NOT mocked. These tests exist to prove it
 * rejects anonymous callers, so stubbing it would remove what is under test. It
 * runs unmodified here and returns 401 because the mocked client resolves no
 * session, which is the same code path a real anonymous request takes.
 */
vi.mock('../lib/prisma.js', () => {
  const model = {
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
    create: async ({ data }: { data: unknown }) => data,
    update: async ({ data }: { data: unknown }) => data,
    updateMany: async () => ({ count: 0 }),
    upsert: async ({ create }: { create: unknown }) => create,
    delete: async () => null,
    deleteMany: async () => ({ count: 0 }),
    count: async () => 0,
  }

  return {
    prisma: new Proxy(
      {},
      {
        get: (_target, property) =>
          typeof property === 'string' && property.startsWith('$') ? async () => undefined : model,
      },
    ),
  }
})

let server: Server
let origin: string

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.close()
})

describe('route protection (issue #14)', () => {
  const protectedRoutes = [
    ['GET', '/api/consultations'],
    ['GET', '/api/consultations/some-id'],
    ['POST', '/api/consultations'],
    ['PATCH', '/api/consultations/some-id'],
    ['POST', '/api/consultations/some-id/approve'],
    ['GET', '/api/fixtures'],
    ['GET', '/api/guidelines'],
  ] as const

  it.each(protectedRoutes)(
    '%s %s rejects an unauthenticated caller with 401',
    async (method, path) => {
      const res = await fetch(`${origin}${path}`, { method })

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({
        error: { code: 'unauthenticated', message: 'Authentication required.' },
      })
    },
  )

  it('exempts /api/health', async () => {
    const res = await fetch(`${origin}/api/health`)

    expect(res.status).not.toBe(401)
  })

  it('exempts /api/auth/** so sign-in is reachable', async () => {
    const res = await fetch(`${origin}/api/auth/get-session`)

    expect(res.status).not.toBe(401)
  })

  it('leaks no stack trace, path, or internal identifier in the 401 body', async () => {
    const body = await (await fetch(`${origin}/api/consultations`)).text()

    expect(body).not.toMatch(/at\s+\w+\s+\(/)
    expect(body).not.toMatch(/\/home\/|node_modules|\.ts:\d+/)
    expect(body).not.toMatch(/prisma|postgres/i)
  })
})

describe('security headers (docs/trd.md §16)', () => {
  it('applies helmet', async () => {
    const res = await fetch(`${origin}/api/health`)

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBeTruthy()
    expect(res.headers.get('x-powered-by')).toBeNull()
  })
})

describe('sign-up (docs/trd.md §14, §19 row 4)', () => {
  it('is mounted and reachable — open self-service sign-up is in scope', async () => {
    const res = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x', name: 'x' }),
    })

    // Deliberately invalid input: this asserts the route exists and validates,
    // not that an account can be created — that would need the database.
    expect(res.status).not.toBe(404)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('guest sign-in rate limit', () => {
  /**
   * `/api/auth/guest` is registered ahead of better-auth's catch-all, so it
   * never reaches that router's own limiter and was bounded by nothing. It
   * mints a session for a shared account without any credential of the
   * caller's, which makes it the cheapest actor in the system to obtain.
   *
   * Driven from one fixed address, because the thing under test is precisely
   * that requests from a single caller are counted together.
   */
  const CALLER = '203.0.113.77'

  const guest = () =>
    fetch(`${origin}/api/auth/guest`, {
      method: 'POST',
      headers: { 'x-forwarded-for': CALLER },
    })

  it('returns 429 once one caller exceeds the window', async () => {
    let limited: Response | undefined

    // One over the limit. Every earlier response is allowed to be anything the
    // route decides, including the 404 it returns when no guest is configured:
    // what matters is that the limiter counts requests rather than successes.
    for (let attempt = 0; attempt <= 20; attempt += 1) {
      const response = await guest()
      if (response.status === 429) {
        limited = response
        break
      }
    }

    expect(limited?.status, 'a 21st request in the window must be refused').toBe(429)
    await expect(limited?.json()).resolves.toMatchObject({
      error: { code: 'rate_limited' },
    })
    // Twenty-one sequential requests, each reaching better-auth and therefore
    // the database, run to roughly 2.7s on their own. That leaves too little
    // room under the 5s default once the rest of the suite is competing for
    // the same connection, and the test failed intermittently on suite runs
    // while passing in isolation.
  }, 20_000)
})
