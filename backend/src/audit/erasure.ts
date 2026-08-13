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
      erasedAt: new Date(),
    },
  })

  await recordAuditEvent({
    action: 'consultation.erased',
    actorId,
    consultationId,
  })
}
