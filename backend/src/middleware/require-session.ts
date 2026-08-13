import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import { auth } from '../lib/auth.js'

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireSession`. Absent on exempt routes. */
      doctorId?: string
    }
  }
}

/**
 * Resolves the better-auth session and rejects anonymous callers with 401.
 *
 * Mounted per protected path prefix in `app.ts` rather than globally, so
 * `/api/health` and `/api/auth/**` stay reachable without a session
 * (docs/trd.md §14).
 *
 * On success it exposes only `doctorId` — the downstream route never sees the
 * user record, so an email or name cannot drift into a response or a log line.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })

  if (!session) {
    res.status(401).json({
      error: { code: 'unauthenticated', message: 'Authentication required.' },
    })
    return
  }

  req.doctorId = session.user.id
  next()
}
