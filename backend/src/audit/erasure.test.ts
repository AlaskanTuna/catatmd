import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseConsultation } from './erasure.js'
import { type AuditChainRow, recordAuditEvent, verifyAuditChainFromDatabase } from './index.js'

type ConsultationRow = {
  id: string
  doctorId: string
  transcript: unknown
  analysis: unknown
  editedNote: unknown
  erasedAt: Date | null
}

const consultations = new Map<string, ConsultationRow>()
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
      consultation: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; doctorId: string; erasedAt: null } }) => {
            const row = consultations.get(where.id)
            return row?.doctorId === where.doctorId && row.erasedAt === where.erasedAt
              ? { ...row }
              : null
          },
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
  appended.length = 0
  consultations.set('consult-1', {
    id: 'consult-1',
    doctorId: 'doctor-1',
    transcript: { turns: [{ speaker: 'patient', text: 'I am Ahmad with a cough' }] },
    analysis: { note: { subjective: 'Ahmad reports cough' } },
    editedNote: { subjective: 'Doctor note about Ahmad' },
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
      erasedAt: expect.any(Date),
    })
    expect(appended.at(-1)).toMatchObject({
      action: 'consultation.erased',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
    })
    await expect(verifyAuditChainFromDatabase()).resolves.toMatchObject({ ok: true, verified: 3 })
  })
})
