import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseConsultation, erasePatient } from './erasure.js'
import { type AuditChainRow, recordAuditEvent, verifyAuditChainFromDatabase } from './index.js'

type ConsultationRow = {
  id: string
  doctorId: string
  patientId: string
  /** The fourth PHI column, and the only one that is not Json. */
  title: string | null
  transcript: unknown
  analysis: unknown
  editedNote: unknown
  editedMedicalRecordNote?: unknown
  erasedAt: Date | null
}

type PatientRow = {
  id: string
  doctorId: string
  name: string | null
  nric: string | null
  age: number | null
  gender: string | null
  erasedAt: Date | null
}

/**
 * Runs once, immediately before the patient row is tombstoned, so a test can
 * simulate a visit filed inside the window that update closes.
 */
const race = vi.hoisted(() => ({ beforePatientUpdate: null as (() => void) | null }))

const consultations = new Map<string, ConsultationRow>()
const patients = new Map<string, PatientRow>()
const appended: AuditChainRow[] = []

vi.mock('../lib/prisma.js', () => {
  const databaseNull = (value: unknown) =>
    typeof value === 'object' && value !== null && String(value) === 'Prisma.DbNull' ? null : value

  const auditEvent = {
    create: vi.fn(async ({ data }: { data: AuditChainRow }) => {
      appended.push(data)
      return data
    }),
    findFirst: vi.fn(async () => {
      const head = appended.at(-1)
      return head === undefined ? null : { hash: head.hash }
    }),
    findMany: vi.fn(async () => appended),
  }

  return {
    prisma: {
      patient: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; doctorId: string; erasedAt: null } }) => {
            const row = patients.get(where.id)
            return row?.doctorId === where.doctorId && row.erasedAt === where.erasedAt
              ? { ...row }
              : null
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<PatientRow> }) => {
            race.beforePatientUpdate?.()
            race.beforePatientUpdate = null
            const row = patients.get(where.id)
            if (!row) throw new Error('Patient not found')
            const updated = { ...row, ...data }
            patients.set(where.id, updated)
            return { ...updated }
          },
        ),
      },
      consultation: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; doctorId: string; erasedAt: null } }) => {
            const row = consultations.get(where.id)
            return row?.doctorId === where.doctorId && row.erasedAt === where.erasedAt
              ? { ...row }
              : null
          },
        ),
        findMany: vi.fn(
          async ({ where }: { where: { patientId: string; doctorId: string; erasedAt: null } }) =>
            [...consultations.values()].filter(
              (row) =>
                row.patientId === where.patientId &&
                row.doctorId === where.doctorId &&
                row.erasedAt === null,
            ),
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<ConsultationRow> }) => {
            const row = consultations.get(where.id)
            if (!row) throw new Error('Consultation not found')
            const updated = {
              ...row,
              ...data,
              transcript: databaseNull(data.transcript),
              analysis: databaseNull(data.analysis),
              editedNote: databaseNull(data.editedNote),
              editedMedicalRecordNote: databaseNull(data.editedMedicalRecordNote),
            }
            consultations.set(where.id, updated)
            return { ...updated }
          },
        ),
      },
      auditEvent,
      $transaction: vi.fn((run: (tx: { auditEvent: typeof auditEvent }) => unknown) =>
        run({ auditEvent }),
      ),
    },
  }
})

beforeEach(() => {
  consultations.clear()
  patients.clear()
  appended.length = 0
  race.beforePatientUpdate = null
  patients.set('patient-1', {
    id: 'patient-1',
    doctorId: 'doctor-1',
    name: 'Rahman bin Abdullah',
    nric: '850312-14-5678',
    age: 56,
    gender: 'male',
    erasedAt: null,
  })
  consultations.set('consult-1', {
    id: 'consult-1',
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    title: null,
    transcript: { turns: [{ speaker: 'patient', text: 'I am Ahmad with a cough' }] },
    analysis: { note: { subjective: 'Ahmad reports cough' } },
    editedNote: { subjective: 'Doctor note about Ahmad' },
    editedMedicalRecordNote: { presentingComplaint: 'Ahmad has a cough' },
    erasedAt: null,
  })
})

describe('eraseConsultation', () => {
  it('clears patient-derived content while preserving a verifiable audit chain', async () => {
    await recordAuditEvent({
      action: 'consultation.created',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
    })
    await recordAuditEvent({
      action: 'consultation.edited',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
    })

    await eraseConsultation('consult-1', 'doctor-1')

    expect(consultations.get('consult-1')).toMatchObject({
      id: 'consult-1',
      transcript: null,
      analysis: null,
      editedNote: null,
      editedMedicalRecordNote: null,
      erasedAt: expect.any(Date),
    })
    expect(appended.at(-1)).toMatchObject({
      action: 'consultation.erased',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
    })
    await expect(verifyAuditChainFromDatabase()).resolves.toMatchObject({ ok: true, verified: 3 })
  })

  /*
   * The fourth erasure target, pinned separately from the three above because
   * it is the one that is not a Json column and the one a reader is most likely
   * to forget.
   *
   * `title` is doctor-editable free text shown on every list row, so it holds a
   * patient's name whenever that is the useful thing to file under. An erasure
   * that cleared the transcript and left the title would leave the name of the
   * person whose record was just erased sitting at the top of the list, which
   * is the most visible place in the product it could possibly survive.
   */
  it('clears the title, which is free text a doctor may have put a name in', async () => {
    consultations.set('consult-2', {
      id: 'consult-2',
      doctorId: 'doctor-1',
      patientId: 'patient-1',
      title: 'Siti Nurhaliza, recurrent cough',
      transcript: { turns: [] },
      analysis: {},
      editedNote: {},
      erasedAt: null,
    })

    await eraseConsultation('consult-2', 'doctor-1')

    const erased = consultations.get('consult-2')
    expect(erased).toMatchObject({ title: null, erasedAt: expect.any(Date) })
    expect(JSON.stringify(erased)).not.toMatch(/Siti|Nurhaliza/)
  })
})

function seedVisit(id: string, over: Partial<ConsultationRow> = {}): ConsultationRow {
  const row: ConsultationRow = {
    id,
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    title: null,
    transcript: { turns: [{ speaker: 'patient', text: 'I am Rahman with a cough' }] },
    analysis: { note: { subjective: 'Rahman reports cough' } },
    editedNote: { subjective: 'Doctor note about Rahman' },
    erasedAt: null,
    ...over,
  }
  consultations.set(id, row)
  return row
}

describe('erasePatient', () => {
  it('nulls every identifying column on the patient row', async () => {
    await erasePatient('patient-1', 'doctor-1')

    expect(patients.get('patient-1')).toMatchObject({
      name: null,
      nric: null,
      age: null,
      gender: null,
      erasedAt: expect.any(Date),
    })
  })

  it('cascades to every consultation the patient owns, titles included', async () => {
    seedVisit('consult-2', { title: 'Siti Nurhaliza, recurrent cough' })

    const erased = await erasePatient('patient-1', 'doctor-1')

    expect(erased).toEqual(['consult-1', 'consult-2'])
    for (const id of ['consult-1', 'consult-2']) {
      expect(consultations.get(id)).toMatchObject({
        transcript: null,
        analysis: null,
        editedNote: null,
        title: null,
        erasedAt: expect.any(Date),
      })
    }
    expect(JSON.stringify(consultations.get('consult-2'))).not.toMatch(/Siti|Nurhaliza/)
  })

  it('emits one consultation.erased per visit and a single trailing patient.erased', async () => {
    seedVisit('consult-2')

    await erasePatient('patient-1', 'doctor-1')

    // The visit rows carry ids as chain inputs; the patient event carries
    // neither a consultation link nor metadata.
    expect(appended.map((row) => row.action)).toEqual([
      'consultation.erased',
      'consultation.erased',
      'patient.erased',
    ])
    expect(appended.at(-1)).toMatchObject({
      action: 'patient.erased',
      actorId: 'doctor-1',
      consultationId: null,
    })
    await expect(verifyAuditChainFromDatabase()).resolves.toMatchObject({ ok: true, verified: 3 })
  })

  it('erases a patient who owns no visits, emitting only patient.erased', async () => {
    consultations.delete('consult-1')

    const erased = await erasePatient('patient-1', 'doctor-1')

    expect(erased).toEqual([])
    expect(appended.map((row) => row.action)).toEqual(['patient.erased'])
  })

  it('is 404 for another doctor s patient, never 403, and changes nothing', async () => {
    patients.set('patient-2', {
      id: 'patient-2',
      doctorId: 'doctor-2',
      name: 'Rahman bin Abdullah',
      nric: '850312-14-5678',
      age: 56,
      gender: 'male',
      erasedAt: null,
    })
    consultations.set('theirs', {
      id: 'theirs',
      doctorId: 'doctor-2',
      patientId: 'patient-2',
      title: null,
      transcript: { turns: [] },
      analysis: {},
      editedNote: {},
      erasedAt: null,
    })

    await expect(erasePatient('patient-2', 'doctor-1')).rejects.toMatchObject({ status: 404 })

    expect(patients.get('patient-2')).toMatchObject({
      name: 'Rahman bin Abdullah',
      erasedAt: null,
    })
    expect(consultations.get('theirs')?.erasedAt).toBeNull()
    expect(appended).toHaveLength(0)
  })

  it('is 404 for an already-erased patient', async () => {
    patients.set('patient-2', {
      id: 'patient-2',
      doctorId: 'doctor-1',
      name: 'Rahman bin Abdullah',
      nric: '850312-14-5678',
      age: 56,
      gender: 'male',
      erasedAt: new Date(),
    })

    await expect(erasePatient('patient-2', 'doctor-1')).rejects.toMatchObject({ status: 404 })

    expect(appended).toHaveLength(0)
  })

  it("leaves another patient's consultations untouched", async () => {
    patients.set('patient-2', {
      id: 'patient-2',
      doctorId: 'doctor-1',
      name: 'Siti binti Hassan',
      nric: null,
      age: 30,
      gender: 'female',
      erasedAt: null,
    })
    const theirs = seedVisit('other-patient-visit', { patientId: 'patient-2' })

    await erasePatient('patient-1', 'doctor-1')

    expect(theirs.erasedAt).toBeNull()
    expect(theirs.transcript).not.toBeNull()
  })

  /*
   * The window between the first read and the tombstone. `POST
   * /api/consultations` files to a patient only through `assertOwnedPatient`,
   * which scopes on `erasedAt: null`, so the tombstone is what actually closes
   * the door; anything filed just before it would otherwise survive with the
   * patient's name in its transcript, under a record reported as erased.
   */
  it('erases a visit filed while the cascade was still running', async () => {
    race.beforePatientUpdate = () => seedVisit('late-visit')

    const erased = await erasePatient('patient-1', 'doctor-1')

    expect(erased).toContain('late-visit')
    expect(consultations.get('late-visit')?.transcript).toBeNull()
    expect(consultations.get('late-visit')?.erasedAt).not.toBeNull()
  })
})
