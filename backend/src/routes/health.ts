import { Router } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', provider: env.LLM_PROVIDER })
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' })
  }
})
