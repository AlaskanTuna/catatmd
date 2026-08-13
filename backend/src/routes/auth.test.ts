import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'

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
