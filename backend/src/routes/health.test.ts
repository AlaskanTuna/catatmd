import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue #106. The warning banner in the SPA is driven entirely by this field,
 * so its two safety properties live here rather than in the UI:
 *
 * - production must never emit it, so the deployed API cannot be the source of
 *   a warning about itself
 * - anything that is not provably on this machine must read as `remote`, so an
 *   unparseable or unexpected connection string fails towards warning rather
 *   than towards silence
 */
const envMock = { NODE_ENV: 'development', DATABASE_URL: '', LLM_PROVIDER: 'qwen' }

vi.mock('../config/env.js', () => ({ env: envMock }))
vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(async () => [{ 1: 1 }]) } }))

async function health() {
  vi.resetModules()
  const { healthRouter } = await import('./health.js')
  const layer = healthRouter.stack.find((entry) => entry.route?.path === '/health')
  const handler = layer?.route?.stack[0]?.handle as (
    req: unknown,
    res: unknown,
  ) => Promise<void> | void
  let body: Record<string, unknown> = {}
  const res = {
    json: (payload: Record<string, unknown>) => {
      body = payload
    },
    status: () => res,
  }
  await handler({}, res)
  return body
}

beforeEach(() => {
  envMock.NODE_ENV = 'development'
  envMock.DATABASE_URL = ''
})

describe('database locality reporting', () => {
  it('says nothing at all in production', async () => {
    envMock.NODE_ENV = 'production'
    envMock.DATABASE_URL = 'postgresql://user:pw@db.supabase.co:5432/postgres'

    const body = await health()

    // Absent, not `remote`. The deployed API has no business describing itself
    // as somewhere a developer might be about to write.
    expect(body).not.toHaveProperty('database')
  })

  it.each([
    ['postgresql://u:p@localhost:5434/catatmd', 'local'],
    ['postgresql://u:p@127.0.0.1:5434/catatmd', 'local'],
    ['postgresql://u:p@db.supabase.co:5432/postgres', 'remote'],
    ['postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres', 'remote'],
  ])('classifies %s as %s', async (url, expected) => {
    envMock.DATABASE_URL = url

    expect((await health()).database).toBe(expected)
  })

  it('treats an unparseable connection string as remote', async () => {
    envMock.DATABASE_URL = 'not-a-url'

    // The safe direction. A string this code cannot read is not evidence that
    // the database is local, and guessing `local` would silence the warning on
    // exactly the setup nobody understands.
    expect((await health()).database).toBe('remote')
  })
})
