import { Prisma } from '@prisma/client'
import { assertOwnedConsultation, assertOwnedPatient } from '../lib/authz.js'
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

export async function erasePatient(patientId: string, actorId: string): Promise<string[]> {
  // Also the gate for already-erased and not-found: 404, never 403.
  const patient = await assertOwnedPatient(patientId, actorId)

  /*
   * Consultations go first. The `Patient` model's own doc comment states why:
   * the transcripts carry the same identity as the row being erased, so
   * tombstoning the row alone would leave the identifiers sitting in clinical
   * content filed under it.
   *
   * Not wrapped in `prisma.$transaction`, deliberately: `recordAuditEvent`
   * reads the hash-chain head and appends within its own transaction, so an
   * interactive transaction spanning this cascade would deadlock against
   * itself. Sequential is correct here, which means a partial failure leaves
   * consultations erased while the patient row stays intact — the safe
   * direction to fail, because the identifiers are then gone from the clinical
   * content while the patient remains findable and the erasure can be retried.
   */
  const visits = await prisma.consultation.findMany({
    where: { patientId: patient.id, doctorId: actorId, erasedAt: null },
    select: { id: true },
  })

  const erasedConsultationIds: string[] = []
  for (const visit of visits) {
    await eraseConsultation(visit.id, actorId)
    erasedConsultationIds.push(visit.id)
  }

  await prisma.patient.update({
    where: { id: patient.id },
    data: {
      name: null,
      nric: null,
      age: null,
      gender: null,
      erasedAt: new Date(),
    },
  })

  /*
   * One more sweep, because the tombstone above is what actually closes the
   * door: `POST /api/consultations` files to a patient only through
   * `assertOwnedPatient`, which scopes on `erasedAt: null`, so no visit can be
   * filed here after this point and none can be missed after this sweep.
   *
   * Before it, there is a window. A visit created between the first read and
   * the update would have survived with the patient's name sitting in its
   * transcript, under a record the system reports as erased, which is the one
   * outcome this function exists to make impossible.
   */
  const late = await prisma.consultation.findMany({
    where: { patientId: patient.id, doctorId: actorId, erasedAt: null },
    select: { id: true },
  })
  for (const visit of late) {
    await eraseConsultation(visit.id, actorId)
    erasedConsultationIds.push(visit.id)
  }

  await recordAuditEvent({ action: 'patient.erased', actorId })

  return erasedConsultationIds
}
