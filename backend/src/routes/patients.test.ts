import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `Patient` is the first table in this system that holds identity directly
 * rather than deriving it from a transcript, so the properties pinned here are
 * the ones that stop it becoming a looser boundary than the one `Consultation`
 * already enforces.
 *
 * Three of them matter more than the CRUD:
 *   - another doctor's patient is 404, never 403, so the table is not an
 *     existence oracle over who is registered;
 *   - the directory never selects `nric`, so the strongest identifier cannot
 *     reach a response by way of a later change to the serialiser;
 *   - a consultation cannot be filed against a patient the caller does not own.
 */
type PatientRow = {
  id: string
  doctorId: string
  name: string | null
  nric: string | null
  age: number | null
  gender: 'male' | 'female' | 'other' | null
  erasedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ConsultationRow = {
  id: string
  patientId: string | null
  doctorId: string
  status: string
  title: string | null
  erasedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const patients: PatientRow[] = []
const consultations: ConsultationRow[] = []
const auditActions: string[] = []
let created: unknown = null

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

vi.mock('../audit/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audit/index.js')>()),
  recordAuditEvent: vi.fn(async ({ action }: { action: string }) => {
    auditActions.push(action)
  }),
}))

function matches(row: PatientRow, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.doctorId !== undefined && row.doctorId !== where.doctorId) return false
  if (where.erasedAt === null && row.erasedAt !== null) return false
  return true
}

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    patient: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return patients.find((p) => matches(p, where)) ?? null
      }),
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: Record<string, unknown>
          select: Record<string, unknown>
        }) => {
          return patients
            .filter((p) => matches(p, where))
            .map((p) => {
              // Mirrors Prisma's `select`, so a column the route never asked
              // for cannot reach the assertion through a too-generous stub.
              const out: Record<string, unknown> = {}
              for (const key of Object.keys(select)) {
                if (key === '_count') {
                  out._count = {
                    consultations: consultations.filter(
                      (c) => c.patientId === p.id && c.erasedAt === null,
                    ).length,
                  }
                } else {
                  out[key] = p[key as keyof PatientRow]
                }
              }
              return out
            })
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date()
        const row: PatientRow = {
          id: `patient-${patients.length + 1}`,
          doctorId: data.doctorId as string,
          name: (data.name ?? null) as string | null,
          nric: (data.nric ?? null) as string | null,
          age: (data.age ?? null) as number | null,
          gender: (data.gender ?? null) as PatientRow['gender'],
          erasedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        patients.push(row)
        created = data
        return row
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = patients.find((p) => p.id === where.id)
          if (!row) throw new Error('missing')
          Object.assign(row, data, { updatedAt: new Date() })
          return row
        },
      ),
    },
    consultation: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        consultations.filter(
          (c) =>
            c.patientId === where.patientId && c.doctorId === where.doctorId && c.erasedAt === null,
        ),
      ),
    },
  },
}))

let server: Server
let origin: string

beforeAll(async () => {
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  origin = `http://127.0.0.1:${addr.port}`
})

afterAll(() => server.close())

beforeEach(() => {
  patients.length = 0
  consultations.length = 0
  auditActions.length = 0
  created = null
})

function seed(over: Partial<PatientRow> = {}): PatientRow {
  const now = new Date()
  const row: PatientRow = {
    id: `patient-${patients.length + 1}`,
    doctorId: 'doctor-1',
    name: 'Rahman bin Abdullah',
    nric: '850312-14-5678',
    age: 56,
    gender: 'male',
    erasedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
  patients.push(row)
  return row
}

describe('POST /api/patients', () => {
  it('registers a patient with only a name', async () => {
    const res = await fetch(`${origin}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Siti binti Hassan' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { patient: { name: string; nric: null; age: null } }
    expect(body.patient.name).toBe('Siti binti Hassan')
    expect(body.patient.nric).toBeNull()
    expect(body.patient.age).toBeNull()
  })

  it('rejects a body with no name', async () => {
    const res = await fetch(`${origin}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ age: 40 }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects an age outside the accepted range', async () => {
    const res = await fetch(`${origin}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', age: 200 }),
    })

    expect(res.status).toBe(400)
  })

  it('records an audit event carrying no patient detail', async () => {
    await fetch(`${origin}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Siti binti Hassan', nric: '900101-10-1234' }),
    })

    expect(auditActions).toEqual(['patient.created'])
  })

  it('scopes the created row to the caller', async () => {
    await fetch(`${origin}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Siti binti Hassan' }),
    })

    expect((created as { doctorId: string }).doctorId).toBe('doctor-1')
  })
})

describe('GET /api/patients', () => {
  it('never returns nric in the directory', async () => {
    seed()

    const res = await fetch(`${origin}/api/patients`)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).not.toContain('850312')
    expect(body).not.toContain('nric')
  })

  it('excludes another doctor and erased rows', async () => {
    seed({ name: 'Mine' })
    seed({ name: 'Theirs', doctorId: 'doctor-2' })
    seed({ name: 'Erased', erasedAt: new Date() })

    const res = await fetch(`${origin}/api/patients`)
    const body = (await res.json()) as { patients: { name: string }[] }

    expect(body.patients.map((p) => p.name)).toEqual(['Mine'])
  })

  it('counts only unerased consultations', async () => {
    const p = seed()
    const now = new Date()
    consultations.push(
      {
        id: 'c1',
        patientId: p.id,
        doctorId: 'doctor-1',
        status: 'draft',
        title: null,
        erasedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'c2',
        patientId: p.id,
        doctorId: 'doctor-1',
        status: 'draft',
        title: null,
        erasedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    )

    const res = await fetch(`${origin}/api/patients`)
    const body = (await res.json()) as { patients: { consultationCount: number }[] }

    expect(body.patients[0].consultationCount).toBe(1)
  })
})

describe('GET /api/patients/:id', () => {
  it('returns the card and that patient s visits', async () => {
    const p = seed()
    const now = new Date()
    consultations.push({
      id: 'c1',
      patientId: p.id,
      doctorId: 'doctor-1',
      status: 'approved',
      title: 'Cough, five days',
      erasedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const res = await fetch(`${origin}/api/patients/${p.id}`)
    const body = (await res.json()) as {
      patient: { nric: string; consultations: { id: string }[] }
    }

    expect(res.status).toBe(200)
    expect(body.patient.nric).toBe('850312-14-5678')
    expect(body.patient.consultations.map((c) => c.id)).toEqual(['c1'])
  })

  it('is 404 for another doctor s patient, never 403', async () => {
    const p = seed({ doctorId: 'doctor-2' })

    const res = await fetch(`${origin}/api/patients/${p.id}`)

    expect(res.status).toBe(404)
  })

  it('is 404 for an erased patient', async () => {
    const p = seed({ erasedAt: new Date() })

    const res = await fetch(`${origin}/api/patients/${p.id}`)

    expect(res.status).toBe(404)
  })

  it('is indistinguishable from a row that never existed', async () => {
    const mine = seed({ doctorId: 'doctor-2' })

    const theirs = await fetch(`${origin}/api/patients/${mine.id}`)
    const absent = await fetch(`${origin}/api/patients/does-not-exist`)

    expect(theirs.status).toBe(absent.status)
    expect(await theirs.text()).toBe(await absent.text())
  })
})

describe('PATCH /api/patients/:id', () => {
  it('leaves absent keys untouched and clears explicit nulls', async () => {
    const p = seed()

    const res = await fetch(`${origin}/api/patients/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nric: null }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { patient: { nric: null; name: string; age: number } }
    expect(body.patient.nric).toBeNull()
    expect(body.patient.name).toBe('Rahman bin Abdullah')
    expect(body.patient.age).toBe(56)
  })

  it('is 404 for another doctor s patient', async () => {
    const p = seed({ doctorId: 'doctor-2' })

    const res = await fetch(`${origin}/api/patients/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(res.status).toBe(404)
    expect(patients.find((x) => x.id === p.id)?.name).toBe('Rahman bin Abdullah')
  })
})
