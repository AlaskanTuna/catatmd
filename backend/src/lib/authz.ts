import type { Consultation } from '@prisma/client'
import { HttpError } from './http-error.js'
import { prisma } from './prisma.js'

/**
 * The single ownership gate for `Consultation`. Every read and write path goes
 * through this rather than re-implementing a `doctorId` check per route —
 * one helper is one place to audit, and one place to get wrong.
 *
 * A row that exists but belongs to another doctor and a row that does not
 * exist are deliberately indistinguishable: both raise 404, never 403. A 403
 * would confirm the id is real, handing an unauthorised caller an existence
 * oracle over the consultation table (docs/trd.md §13, §14).
 */
export async function assertOwnedConsultation(id: string, doctorId: string): Promise<Consultation> {
  const consultation = await prisma.consultation.findFirst({
    where: { id, doctorId, erasedAt: null },
  })

  if (!consultation) {
    throw new HttpError(404, 'not_found', 'Consultation not found.')
  }

  return consultation
}
