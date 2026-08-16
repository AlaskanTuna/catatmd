import { Prisma } from '@prisma/client'
import { assertOwnedConsultation } from '../lib/authz.js'
import { prisma } from '../lib/prisma.js'
import { recordAuditEvent } from './index.js'

export async function eraseConsultation(consultationId: string, actorId: string): Promise<void> {
  await assertOwnedConsultation(consultationId, actorId)

  await prisma.consultation.update({
    where: { id: consultationId },
    data: {
      transcript: Prisma.DbNull,
      analysis: Prisma.DbNull,
      editedNote: Prisma.DbNull,
      // The fourth PHI column. `title` is doctor-editable free text shown in
      // every list, so it holds a patient name whenever one is useful as a
      // filing name, and an erasure that left it behind would leave the name
      // of the person whose record was just erased sitting on the row.
      // `null` rather than `Prisma.DbNull`: this is a nullable String column,
      // not Json, and `DbNull` is only for the Json ones.
      title: null,
      erasedAt: new Date(),
    },
  })

  await recordAuditEvent({
    action: 'consultation.erased',
    actorId,
    consultationId,
  })
}
