import type { Server } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestContext } from './request-context.js'

let server: Server
let origin: string
let captured: string[] = []

beforeAll(async () => {
  const app = express()
  app.use(requestContext)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/api/consultations/:id', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Consultation not found.' } })
  })

  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  origin = `http://127.0.0.1:${addr.port}`
})

afterAll(() => server.close())

beforeEach(() => {
  captured = []
})

async function call(path: string, headers: Record<string, string> = {}) {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.push(String(chunk))
    return true
  })
  try {
    const res = await fetch(`${origin}${path}`, { headers })
    await new Promise((r) => setTimeout(r, 30))
    return res
  } finally {
    spy.mockRestore()
  }
}

function records() {
  return captured
    .join('')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('request id', () => {
  it('generates one and returns it on the response', async () => {
    const res = await call('/api/health')

    const header = res.headers.get('x-request-id')
    expect(header).toMatch(/^[0-9a-f-]{36}$/)
    expect(records()[0]?.requestId).toBe(header)
  })

  it('is present on an error response, not only a success', async () => {
    const res = await call('/api/consultations/cmeg1q2r30000abcd1234efgh')

    expect(res.status).toBe(404)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('echoes a well-formed client-supplied id so a caller can correlate', async () => {
    const res = await call('/api/health', { 'x-request-id': 'client-trace-42' })

    expect(res.headers.get('x-request-id')).toBe('client-trace-42')
  })

  /**
   * The header is attacker-controlled, so it is a way to write arbitrary text
   * into the log drain from outside the system. Anything not matching the id
   * shape is discarded and replaced rather than sanitised in place.
   */
  it.each([
    ['clinical text', 'Encik Ahmad bin Ismail NRIC 850523-14-5677'],
    ['an over-long value', 'a'.repeat(200)],
    ['an empty value', ''],
    ['path traversal', '../../etc/passwd'],
  ])('refuses a hostile client-supplied id: %s', async (_label, hostile) => {
    const res = await call('/api/health', { 'x-request-id': hostile })

    const header = res.headers.get('x-request-id')
    expect(header).toMatch(/^[0-9a-f-]{36}$/)
    expect(captured.join('')).not.toContain('Ahmad')
    expect(captured.join('')).not.toContain('850523-14-5677')
    expect(captured.join('')).not.toContain('etc/passwd')
  })

  /**
   * A newline in a header is not deliverable through a compliant HTTP client
   * (Node's `fetch` rejects it before it reaches the server, and so does the
   * http parser), so this exercises the middleware directly rather than
   * pretending the attack arrives over the wire. The guard is cheap and the
   * next transport may be less strict.
   */
  it('refuses an id carrying a forged log line, tested at the middleware', () => {
    const headers: Record<string, string> = {
      'x-request-id': 'x\n{"level":"error","msg":"forged"}',
    }
    const req = { header: (k: string) => headers[k.toLowerCase()], method: 'GET', path: '/api/x' }
    const setHeader = vi.fn()
    const res = { setHeader, on: vi.fn(), statusCode: 200 }

    requestContext(
      req as unknown as Parameters<typeof requestContext>[0],
      res as unknown as Parameters<typeof requestContext>[1],
      () => {},
    )

    expect(setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(/^[0-9a-f-]{36}$/))
    expect(setHeader).not.toHaveBeenCalledWith('x-request-id', expect.stringContaining('forged'))
  })
})

describe('request logging', () => {
  it('records method, route, status and duration', async () => {
    await call('/api/health')

    expect(records()[0]).toMatchObject({
      msg: 'request completed',
      method: 'GET',
      route: '/api/health',
      status: 200,
    })
    expect(typeof records()[0]?.durationMs).toBe('number')
  })

  /**
   * A consultation id is opaque, but a URL is the wrong place for it: it ends
   * up in log tooling and search indexes as a path rather than a field
   * (healthcare-phi-compliance, "URL parameters").
   */
  it('normalises opaque path segments so the route stays a pattern', async () => {
    await call('/api/consultations/cmeg1q2r30000abcd1234efgh')

    expect(records()[0]?.route).toBe('/api/consultations/:id')
  })
})
