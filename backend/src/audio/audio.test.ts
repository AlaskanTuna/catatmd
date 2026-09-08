import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The retention rules for the consultation recording (#293).
 *
 * Three properties are worth pinning here, because each of them is a promise
 * made in `docs/dpia.md` and in `.env.example` rather than an implementation
 * detail: nothing is stored without an adopted retention period, nothing is
 * served past its window, and the sweep actually deletes.
 */

type Row = { consultationId: string; data: Uint8Array; mimeType: string; expiresAt: Date }

const rows = new Map<string, Row>()
const appended: { action: string; actorId?: string; metadata?: unknown }[] = []
const retention = vi.hoisted(() => ({ hours: undefined as number | undefined }))

vi.mock('../config/env.js', () => ({
  get env() {
    return { AUDIO_RETENTION_HOURS: retention.hours }
  },
}))

vi.mock('../audit/index.js', () => ({
  recordAuditEvent: vi.fn(async (event: { action: string }) => {
    appended.push(event)
  }),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    consultationAudio: {
      upsert: vi.fn(
        async ({ where, create }: { where: { consultationId: string }; create: Row }) => {
          rows.set(where.consultationId, create)
          return create
        },
      ),
      /*
       * Honours the `expiresAt` filter rather than ignoring it, because that
       * filter is the control being tested: `readAudio` puts the clock in the
       * WHERE clause so an expired recording never leaves Postgres, and a mock
       * that returned the row regardless would pass whether or not the real
       * query still carried the condition.
       */
      findFirst: vi.fn(
        async ({ where }: { where: { consultationId: string; expiresAt?: { gt: Date } } }) => {
          const row = rows.get(where.consultationId)
          if (row === undefined) return null
          if (where.expiresAt && row.expiresAt.getTime() <= where.expiresAt.gt.getTime()) {
            return null
          }
          return row
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { consultationId?: string; expiresAt?: { lte: Date } } }) => {
          let count = 0
          for (const [id, row] of [...rows]) {
            const matchesId = where.consultationId === undefined || where.consultationId === id
            const matchesClock =
              where.expiresAt === undefined ||
              row.expiresAt.getTime() <= where.expiresAt.lte.getTime()
            if (matchesId && matchesClock) {
              rows.delete(id)
              count += 1
            }
          }
          return { count }
        },
      ),
    },
  },
}))

const { audioRetentionEnabled, purgeAudio, readAudio, storeAudio, sweepExpiredAudio } =
  await import('./index.js')

const audio = () => new Uint8Array([1, 2, 3])

beforeEach(() => {
  rows.clear()
  appended.length = 0
  retention.hours = 720
})

describe('retention has to be adopted before anything is stored', () => {
  it('is disabled while the period is unset', () => {
    retention.hours = undefined
    expect(audioRetentionEnabled()).toBe(false)
  })

  it('is enabled once a period is set', () => {
    expect(audioRetentionEnabled()).toBe(true)
  })

  /*
   * The route refuses before reaching this, so a caller sees a 503 rather than
   * a 500. The throw is the backstop: a second caller added later must not be
   * able to store a recording under a retention period nobody adopted.
   */
  it('refuses to store with no period adopted, rather than inventing one', async () => {
    retention.hours = undefined
    await expect(storeAudio('c1', 'doctor-1', audio(), 'audio/webm')).rejects.toThrow()
    expect(rows.size).toBe(0)
  })
})

describe('storing', () => {
  it('sets the expiry from the configured window', async () => {
    const before = Date.now()
    const { expiresAt } = await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')

    const hours = (expiresAt.getTime() - before) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(719.9)
    expect(hours).toBeLessThanOrEqual(720.1)
  })

  it('records size and window, never content', async () => {
    await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')

    expect(appended).toEqual([
      {
        action: 'consultation.audio_stored',
        actorId: 'doctor-1',
        consultationId: 'c1',
        metadata: { bytes: 3, retentionHours: 720 },
      },
    ])
  })

  it('replaces an earlier recording, so offsets never point into stale audio', async () => {
    await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')
    await storeAudio('c1', 'doctor-1', new Uint8Array([9]), 'audio/ogg')

    expect(rows.size).toBe(1)
    expect((await readAudio('c1'))?.mimeType).toBe('audio/ogg')
  })
})

describe('reading', () => {
  it('returns the recording it was given', async () => {
    await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')

    const found = await readAudio('c1')
    expect(found?.mimeType).toBe('audio/webm')
    expect([...(found?.data ?? [])]).toEqual([1, 2, 3])
  })

  it('is null for a consultation that has none', async () => {
    expect(await readAudio('c1')).toBeNull()
  })

  /*
   * The load-bearing one. A sweep that has not run yet is untidiness; serving a
   * recording past its window would be a broken retention promise, so the read
   * path checks the clock itself rather than trusting deletion happened.
   */
  it('refuses an expired recording even though the row is still there', async () => {
    await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')
    const row = rows.get('c1')
    if (row) row.expiresAt = new Date(Date.now() - 1_000)

    expect(await readAudio('c1')).toBeNull()
    expect(rows.size).toBe(1)
  })
})

describe('purging', () => {
  it('deletes the recording and says it did', async () => {
    await storeAudio('c1', 'doctor-1', audio(), 'audio/webm')
    appended.length = 0

    expect(await purgeAudio('c1', 'doctor-1')).toBe(true)
    expect(rows.size).toBe(0)
    expect(appended).toEqual([
      { action: 'consultation.audio_purged', actorId: 'doctor-1', consultationId: 'c1' },
    ])
  })

  it('says nothing happened, and writes nothing, when there was no recording', async () => {
    expect(await purgeAudio('c1', 'doctor-1')).toBe(false)
    expect(appended).toEqual([])
  })
})

describe('the retention sweep', () => {
  it('deletes what has expired and leaves what has not', async () => {
    await storeAudio('stale', 'doctor-1', audio(), 'audio/webm')
    await storeAudio('fresh', 'doctor-2', audio(), 'audio/webm')
    const stale = rows.get('stale')
    if (stale) stale.expiresAt = new Date(Date.now() - 1_000)
    appended.length = 0

    expect(await sweepExpiredAudio()).toBe(1)
    expect([...rows.keys()]).toEqual(['fresh'])
  })

  /*
   * No actor, deliberately. A clock closing a window across every doctor's
   * recordings is not something one doctor did, and stamping whoever happened
   * to trigger the sweep would put their id against the destruction of someone
   * else's audio.
   */
  it('records the sweep with a count and no actor', async () => {
    await storeAudio('stale', 'doctor-1', audio(), 'audio/webm')
    const stale = rows.get('stale')
    if (stale) stale.expiresAt = new Date(Date.now() - 1_000)
    appended.length = 0

    await sweepExpiredAudio()

    expect(appended).toEqual([{ action: 'audio.swept', metadata: { count: 1 } }])
  })

  it('writes nothing when there is nothing to sweep', async () => {
    await storeAudio('fresh', 'doctor-1', audio(), 'audio/webm')
    appended.length = 0

    expect(await sweepExpiredAudio()).toBe(0)
    expect(appended).toEqual([])
  })
})
