import { NOTIFICATION_FEED_LIMIT, NotificationItemSchema } from '@shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { getActorNotifications } from '../audit/index.js'
import { HttpError } from '../lib/http-error.js'

export const notificationsRouter = Router()

/** `req.doctorId` is set by `requireSession`, which guards this prefix. */
function doctorId(req: { doctorId?: string }): string {
  if (!req.doctorId) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return req.doctorId
}

const FeedEnvelope = z.object({ notifications: z.array(NotificationItemSchema) })

/**
 * What this doctor has finished recently (issue #116).
 *
 * A read over `AuditEvent`, not a table of its own. That log is already a
 * per-actor append-only stream whose rows carry an id and a member of a closed
 * action enum, so a feed built on it cannot carry clinical text: the constraint
 * is structural rather than a rule this route has to remember.
 *
 * There is no unread state here on purpose. Persisting one would mean either a
 * migration or a second `localStorage` key, and the badge is worth neither; the
 * client counts what arrived since it last opened the panel.
 */
notificationsRouter.get('/notifications', async (req, res) => {
  const rows = await getActorNotifications(doctorId(req), NOTIFICATION_FEED_LIMIT)

  // Parsed on the way out like every other response. It also pins the promise
  // above: anything that ever appeared in `metadata` would fail here rather
  // than reach a client.
  res.json(FeedEnvelope.parse({ notifications: rows }))
})
