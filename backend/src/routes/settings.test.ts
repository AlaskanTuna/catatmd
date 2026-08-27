import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { RETENTION_DEFAULT_YEARS, RetentionPolicySchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The retention period is a governance decision the system records and does not
 * act on, so the properties worth pinning are the ones that keep it honest: the
 * unadopted state must survive a round trip as null, the value must be a bounded
 * whole number, and the prefix must be authenticated.
 */
let stored: number | null = null

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ retentionYears: stored })),
      update: vi.fn(async ({ data }: { data: { retentionYears: number | null } }) => {
        stored = data.retentionYears
        return { retentionYears: stored }
      }),
    },
  },
}))

let server: Server
let origin: string

beforeAll(async () => {
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  origin = `http://127.0.0.1:${addr.port}`
})

afterAll(() => server.close())

beforeEach(() => {
  stored = null
})

const read = async () => {
  const res = await fetch(`${origin}/api/settings/retention`)
  return {
    status: res.status,
    body: (await res.json()) as { retention: { adoptedYears: unknown } },
  }
}

const write = async (body: unknown) => {
  const res = await fetch(`${origin}/api/settings/retention`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('reading the retention period', () => {
  it('reports an unreviewed account as null, never as the default', async () => {
    // The whole point of the nullable column. A default substituted here would
    // report a decision the controller has not made.
    const { status, body } = await read()

    expect(status).toBe(200)
    expect(body.retention.adoptedYears).toBeNull()
    expect(body.retention.adoptedYears).not.toBe(RETENTION_DEFAULT_YEARS)
  })

  it('reports an adopted period', async () => {
    stored = 7

    expect((await read()).body.retention.adoptedYears).toBe(7)
  })
})

describe('adopting a retention period', () => {
  it('persists a whole number of years and reads it back', async () => {
    const written = await write({ adoptedYears: RETENTION_DEFAULT_YEARS })

    expect(written.status).toBe(200)
    expect((await read()).body.retention.adoptedYears).toBe(RETENTION_DEFAULT_YEARS)
  })

  it('returns to unadopted on null', async () => {
    stored = 7

    await write({ adoptedYears: null })

    expect((await read()).body.retention.adoptedYears).toBeNull()
  })

  it('rejects a fractional, out-of-range, or non-numeric period', async () => {
    for (const adoptedYears of [0, 7.5, 51, -1, '7', {}]) {
      const { status, body } = await write({ adoptedYears })

      expect(status).toBe(400)
      expect(body).toHaveProperty('error')
    }
    // Nothing above reached the column.
    expect(stored).toBeNull()
  })

  it('rejects a body missing the field rather than clearing the period', async () => {
    stored = 7

    expect((await write({})).status).toBe(400)
    expect(stored).toBe(7)
  })
})

describe('route protection', () => {
  it('mounts /api/settings under a session-guarded prefix', () => {
    // Authentication here is per-prefix, not global, so a new top-level prefix
    // is unauthenticated by default. Pinned in source rather than left to a
    // reviewer noticing.
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')
    const prefixes = app.slice(
      app.indexOf('const PROTECTED_PREFIXES'),
      app.indexOf('export function createApp'),
    )

    expect(prefixes).toContain("'/api/settings'")
  })

  it('registers a limiter for the write route', () => {
    // security.md: any new route that writes must register its own limiter.
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')

    expect(app).toContain("app.patch('/api/settings/retention', settingsWriteRateLimit)")
  })
})

describe('the shared contract', () => {
  it('bounds the period to whole years', () => {
    expect(RetentionPolicySchema.safeParse({ adoptedYears: 1 }).success).toBe(true)
    expect(RetentionPolicySchema.safeParse({ adoptedYears: 50 }).success).toBe(true)
    expect(RetentionPolicySchema.safeParse({ adoptedYears: null }).success).toBe(true)

    for (const adoptedYears of [0, 51, 7.5, Number.NaN]) {
      expect(RetentionPolicySchema.safeParse({ adoptedYears }).success).toBe(false)
    }
  })

  it('offers a default that is inside the accepted range', () => {
    expect(RetentionPolicySchema.safeParse({ adoptedYears: RETENTION_DEFAULT_YEARS }).success).toBe(
      true,
    )
  })
})
