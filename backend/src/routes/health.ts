import { Router } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'

export const healthRouter = Router()

/**
 * Whether this API is talking to a database on this machine (issue #106).
 *
 * Coarse by design. It answers "would writing here affect the shared
 * instance", which is the only question the caller needs, and it never
 * discloses the host, the port, the database name or any credential. A
 * connection string is a secret and this is a boolean wearing a label.
 *
 * Reported **only outside production**. The deployed API is always remote, so
 * the field would carry no information there, and omitting it means the
 * production API cannot be the source of a warning about itself.
 */
function databaseLocality(): 'local' | 'remote' | undefined {
  if (env.NODE_ENV === 'production') return undefined
  const host = (() => {
    try {
      return new URL(env.DATABASE_URL).hostname
    } catch {
      // An unparseable URL is not a reason to claim safety.
      return ''
    }
  })()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ? 'local' : 'remote'
}

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    const locality = databaseLocality()
    // Spread rather than `database: undefined`. Both serialise identically,
    // because `JSON.stringify` drops undefined values, but only this one is
    // absent before serialisation. The production API's silence should not
    // depend on a property of the serialiser.
    res.json({
      status: 'ok',
      provider: env.LLM_PROVIDER,
      ...(locality ? { database: locality } : {}),
    })
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' })
  }
})
