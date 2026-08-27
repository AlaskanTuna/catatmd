import type { Consultation, Patient as PatientRow } from '@prisma/client'
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

/**
 * The ownership gate for `Patient`, deliberately identical in shape to the one
 * above rather than a variation on it.
 *
 * A second entity introducing a second authorisation rule is how an existence
 * oracle gets reintroduced by accident: the reasoning that makes 404-never-403
 * correct for consultations applies with more force here, because a patient row
 * is identity itself rather than a record derived from one. Confirming that an
 * id is real would confirm that a person is registered.
 */
export async function assertOwnedPatient(id: string, doctorId: string): Promise<PatientRow> {
  const patient = await prisma.patient.findFirst({
    where: { id, doctorId, erasedAt: null },
  })

  if (!patient) {
    throw new HttpError(404, 'not_found', 'Patient not found.')
  }

  return patient
}
