import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The notification feed is a read over `AuditEvent`, so the properties worth
 * pinning are the ones that stop it becoming a second, looser way to read that
 * table: it must be scoped to the caller in the query, it must expose only the
 * four notifiable actions, and it must never carry `metadata`.
 */
type Row = {
  id: string
  action: string
  actorId: string
  consultationId: string | null
  createdAt: Date
  metadata?: unknown
}

const rows: Row[] = []

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    auditEvent: {
      findMany: vi.fn(
        async ({
          where,
          take,
          select,
        }: {
          where: { actorId: string; action: { in: string[] } }
          take: number
          select: Record<string, boolean>
        }) => {
          const matched = rows
            .filter((r) => r.actorId === where.actorId && where.action.in.includes(r.action))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, take)
          // Mirrors Prisma's `select`, so a column the route never asked for
          // cannot reach the assertion by way of a too-generous stub.
          return matched.map((r) =>
            Object.fromEntries(Object.keys(select).map((k) => [k, r[k as keyof Row]])),
          )
        },
      ),
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
  rows.length = 0
})

let clock = 0
function seed(action: string, extra: Partial<Row> = {}) {
  clock += 1000
  rows.push({
    id: `e${rows.length}`,
    action,
    actorId: 'doctor-1',
    consultationId: 'c1',
    createdAt: new Date(clock),
    ...extra,
  })
}

const feed = async () => {
  const res = await fetch(`${origin}/api/notifications`)
  return { status: res.status, body: (await res.json()) as { notifications: Row[] } }
}

describe('notification feed', () => {
  it("never returns another doctor's events", async () => {
    seed('consultation.approved', { actorId: 'doctor-2', id: 'theirs' })
    seed('consultation.approved', { id: 'mine' })

    const { body } = await feed()

    expect(body.notifications.map((n) => n.id)).toEqual(['mine'])
  })

  it('returns only the four notifiable actions', async () => {
    // The noisy half of the taxonomy. A feed carrying these is a log, and it is
    // also a much larger surface to have to keep free of clinical text.
    for (const action of [
      'consultation.created',
      'consultation.analysis_started',
      'consultation.edited',
      'redflag.disposition_set',
      'gap.reviewed',
    ]) {
      seed(action)
    }
    seed('consultation.analysis_completed')
    seed('consultation.analysis_failed')
    seed('consultation.approved')
    seed('consultation.erased')

    const { body } = await feed()

    expect(body.notifications.map((n) => n.action).sort()).toEqual([
      'consultation.analysis_completed',
      'consultation.analysis_failed',
      'consultation.approved',
      'consultation.erased',
    ])
  })

  it('orders newest first', async () => {
    seed('consultation.approved', { id: 'older' })
    seed('consultation.erased', { id: 'newer' })

    const { body } = await feed()

    expect(body.notifications.map((n) => n.id)).toEqual(['newer', 'older'])
  })

  it('never carries audit metadata', async () => {
    // `metadata` holds detector labels today, and is the one audit column that
    // could ever carry more than a label. Chrome rendered on every screen must
    // not be the first thing to read it.
    seed('consultation.analysis_completed', { metadata: { detectorLabels: ['NRIC'] } })

    const { body } = await feed()

    expect(body.notifications[0]).not.toHaveProperty('metadata')
    expect(JSON.stringify(body)).not.toContain('NRIC')
  })

  it('caps the feed at the shared limit', async () => {
    const { NOTIFICATION_FEED_LIMIT } = await import('@shared/types')
    for (let i = 0; i < NOTIFICATION_FEED_LIMIT + 5; i += 1) seed('consultation.approved')

    const { body } = await feed()

    expect(body.notifications).toHaveLength(NOTIFICATION_FEED_LIMIT)
  })
})

describe('route protection', () => {
  it('mounts /api/notifications under a session-guarded prefix', () => {
    // Authentication in this app is per-prefix, not global, so a new top-level
    // prefix is unauthenticated by default. That failure mode is silent and
    // this feed reads the audit log, so it is pinned in source rather than left
    // to a reviewer noticing.
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')
    const prefixes = app.slice(
      app.indexOf('const PROTECTED_PREFIXES'),
      app.indexOf('export function createApp'),
    )

    expect(prefixes).toContain("'/api/notifications'")
  })
})
