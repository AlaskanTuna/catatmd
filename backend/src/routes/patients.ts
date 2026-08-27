import type { Patient as PatientRow } from '@prisma/client'
import {
  ConsultationListItemSchema,
  CreatePatientInputSchema,
  PatientDetailSchema,
  PatientListItemSchema,
  PatientSchema,
  UpdatePatientInputSchema,
} from '@shared/types'
import { Router } from 'express'
import { recordAuditEvent } from '../audit/index.js'
import { assertOwnedPatient } from '../lib/authz.js'
import { HttpError } from '../lib/http-error.js'
import { prisma } from '../lib/prisma.js'
import { doctorId } from './consultations.js'

export const patientsRouter: Router = Router()

/**
 * Maps a row onto the wire contract, validating on the way out.
 *
 * `Date` to ISO is the only transformation. Everything else is nullable in both
 * shapes on purpose: a patient registered without an NRIC or an age is a
 * complete record with unknown fields, not an incomplete one, and collapsing
 * those to empty strings here would make "not recorded" indistinguishable from
 * "recorded as blank" everywhere downstream.
 */
function toPatient(row: PatientRow) {
  return PatientSchema.parse({
    id: row.id,
    name: row.name,
    nric: row.nric,
    age: row.age,
    gender: row.gender,
    erasedAt: row.erasedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

patientsRouter.get('/', async (req, res) => {
  const rows = await prisma.patient.findMany({
    where: { doctorId: doctorId(req), erasedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      erasedAt: true,
      createdAt: true,
      updatedAt: true,
      /*
       * Counted here rather than fetched per row. The directory shows visit
       * history on every line, and a request per line is how a list of forty
       * patients becomes forty round trips.
       *
       * `nric` is absent from this select deliberately, matching the contract:
       * the strongest identifier in the system has no reason to be on screen
       * while someone is browsing, and not selecting it means it cannot be
       * leaked by a later change to the serialiser.
       */
      _count: { select: { consultations: { where: { erasedAt: null } } } },
    },
  })

  res.json({
    patients: rows.map((row) =>
      PatientListItemSchema.parse({
        id: row.id,
        name: row.name,
        age: row.age,
        gender: row.gender,
        erasedAt: row.erasedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        consultationCount: row._count.consultations,
      }),
    ),
  })
})

patientsRouter.post('/', async (req, res) => {
  const parsed = CreatePatientInputSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'A valid patient name is required.')
  }

  const actor = doctorId(req)
  const created = await prisma.patient.create({
    data: {
      doctorId: actor,
      name: parsed.data.name,
      nric: parsed.data.nric ?? null,
      age: parsed.data.age ?? null,
      gender: parsed.data.gender ?? null,
    },
  })

  await recordAuditEvent({ action: 'patient.created', actorId: actor })

  res.status(201).json({ patient: toPatient(created) })
})

patientsRouter.get('/:id', async (req, res) => {
  const actor = doctorId(req)
  const patient = await assertOwnedPatient(req.params.id, actor)

  const consultations = await prisma.consultation.findMany({
    where: { patientId: patient.id, doctorId: actor, erasedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, title: true, createdAt: true, updatedAt: true },
  })

  res.json({
    patient: PatientDetailSchema.parse({
      ...toPatient(patient),
      consultations: consultations.map((row) => ConsultationListItemSchema.parse(row)),
    }),
  })
})

patientsRouter.patch('/:id', async (req, res) => {
  const parsed = UpdatePatientInputSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'Invalid patient details.')
  }

  const actor = doctorId(req)
  const patient = await assertOwnedPatient(req.params.id, actor)

  /*
   * Only keys actually present are written. `UpdatePatientInputSchema` is a
   * partial, so an absent key means "leave it" while an explicit null means
   * "clear it" — spreading the parsed object directly would collapse those two
   * into the same write and silently blank fields the caller never mentioned.
   */
  const data: Record<string, unknown> = {}
  for (const key of ['name', 'nric', 'age', 'gender'] as const) {
    if (key in parsed.data) data[key] = parsed.data[key] ?? null
  }

  const updated = await prisma.patient.update({ where: { id: patient.id }, data })

  await recordAuditEvent({ action: 'patient.updated', actorId: actor })

  res.json({ patient: toPatient(updated) })
})
