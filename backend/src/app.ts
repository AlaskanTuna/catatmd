import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { healthRouter } from './routes/health.js'

export function createApp() {
  const app = express()

  app.use(compression())
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api', healthRouter)

  return app
}
