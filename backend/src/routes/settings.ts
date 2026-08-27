import { RetentionPolicySchema } from '@shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../lib/http-error.js'
import { prisma } from '../lib/prisma.js'
import { doctorId } from './consultations.js'

export const settingsRouter: Router = Router()

const RetentionEnvelope = z.object({ retention: RetentionPolicySchema })

/**
 * The adopted clinical-records retention period (#80).
 *
 * **This route stores a decision. It does not act on one.** There is no
 * retention job, no TTL, and no deletion sweep anywhere in the system, so
 * writing a period here changes what the record says and changes nothing about
 * what the database keeps. Enforcement is separate work and is not built.
 *
 * `adoptedYears: null` is returned as null rather than defaulted, because
 * "the controller has not reviewed this yet" and "the controller adopted the
 * conventional default" are different answers and only one of them is a
 * decision. `RETENTION_DEFAULT_YEARS` lives in `@shared/types` where the UI can
 * offer it for review; the API never substitutes it for an absent value.
 */
settingsRouter.get('/retention', async (req, res) => {
  const row = await prisma.user.findUnique({
    where: { id: doctorId(req) },
    select: { retentionYears: true },
  })
  if (!row) throw new HttpError(404, 'not_found', 'Account not found.')

  res.json(RetentionEnvelope.parse({ retention: { adoptedYears: row.retentionYears } }))
})

settingsRouter.patch('/retention', async (req, res) => {
  const parsed = RetentionPolicySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'Retention must be a whole number of years, or none.')
  }

  const updated = await prisma.user.update({
    where: { id: doctorId(req) },
    data: { retentionYears: parsed.data.adoptedYears },
    select: { retentionYears: true },
  })

  res.json(RetentionEnvelope.parse({ retention: { adoptedYears: updated.retentionYears } }))
})
