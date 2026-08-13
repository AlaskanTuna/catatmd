import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_CLINICAL_VERSIONS } from '../clinical-versions/index.js'
import { prisma } from '../lib/prisma.js'
import {
  AUDIT_CHAIN_GENESIS,
  type AuditChainRow,
  type AuditEventInput,
  computeAuditHash,
  getAuditHistory,
  recordAuditEvent,
  verifyAuditChain,
} from './index.js'

/**
 * Minimal append-only stand-in for `audit_event`. Behaving like the real table
 * rather than returning a fixed stub is what lets these tests watch a chain
 * build across several writes.
 */
const appended: (AuditChainRow & { metadata?: unknown })[] = []

vi.mock('../lib/prisma.js', () => {
  const auditEvent = {
    create: vi.fn(async ({ data }: { data: AuditChainRow & { metadata?: unknown } }) => {
      appended.push(data)
      return data
    }),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => {
      const head = appended.at(-1)
      return head === undefined ? null : { hash: head.hash }
    }),
  }

  return {
    prisma: {
      auditEvent,
      // The append runs inside a transaction; hand the callback the same mock
      // so assertions can keep reading `prisma.auditEvent.create`.
      $transaction: vi.fn((run: (tx: { auditEvent: typeof auditEvent }) => unknown) =>
        run({ auditEvent }),
      ),
    },
  }
})

beforeEach(() => {
  appended.length = 0
  vi.mocked(prisma.auditEvent.create).mockClear()
  vi.mocked(prisma.auditEvent.findMany).mockClear()
  vi.mocked(prisma.auditEvent.findFirst).mockClear()
})

const write = (event: AuditEventInput) =>
  recordAuditEvent({ ...event, actorId: 'doctor-1', consultationId: 'consult-1' })

function lastWrite() {
  return vi.mocked(prisma.auditEvent.create).mock.calls.at(-1)?.[0] as {
    data: AuditChainRow & { metadata?: unknown }
  }
}

describe('recordAuditEvent', () => {
  it('writes actor and consultation on every row', async () => {
    await write({ action: 'consultation.created' })

    expect(lastWrite().data).toMatchObject({
      action: 'consultation.created',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
    })
  })

  it('omits metadata for actions that carry none', async () => {
    await write({ action: 'consultation.approved' })

    expect(lastWrite().data.metadata).toBeUndefined()
  })

  it('records detector labels, discarded field ids and version stamps on completion', async () => {
    await write({
      action: 'consultation.analysis_completed',
      metadata: {
        detected: ['NRIC', 'NAME'],
        discardedFieldIds: ['fever', 'cough_duration'],
        versions: {
          provider: 'qwen',
          model: 'qwen-flash',
          clinicalContent: ACTIVE_CLINICAL_VERSIONS,
        },
      },
    })

    expect(lastWrite().data.metadata).toEqual({
      detected: ['NRIC', 'NAME'],
      discardedFieldIds: ['fever', 'cough_duration'],
      versions: {
        provider: 'qwen',
        model: 'qwen-flash',
        clinicalContent: ACTIVE_CLINICAL_VERSIONS,
      },
    })
  })

  it('records a failure category, never raw error text', async () => {
    await write({
      action: 'consultation.analysis_failed',
      metadata: { reason: 'llm_response_invalid' },
    })

    expect(lastWrite().data.metadata).toEqual({ reason: 'llm_response_invalid' })
  })

  /**
   * The union is the control: every `metadata` shape in the taxonomy holds
   * identifiers, detector labels or version strings and nothing else. This
   * walks the whole taxonomy and asserts no written value ever resembles
   * clinical prose (issue #12; docs/trd.md §15).
   */
  it('writes no transcript text, note content or vault entry for any action', async () => {
    const everyAction: AuditEventInput[] = [
      { action: 'consultation.created' },
      { action: 'consultation.asr_hosted_used' },
      { action: 'consultation.analysis_started' },
      {
        action: 'consultation.analysis_completed',
        metadata: {
          detected: ['NRIC'],
          discardedFieldIds: ['fever'],
          versions: {
            provider: 'qwen',
            model: 'qwen-flash',
            clinicalContent: ACTIVE_CLINICAL_VERSIONS,
          },
        },
      },
      { action: 'consultation.analysis_failed', metadata: { reason: 'internal_error' } },
      { action: 'consultation.edited' },
      { action: 'redflag.acknowledged', metadata: { redFlagId: 'rf-1' } },
      { action: 'gap.reviewed', metadata: { gapId: 'gap-1' } },
      { action: 'consultation.approved' },
    ]

    for (const event of everyAction) await write(event)

    const written = vi
      .mocked(prisma.auditEvent.create)
      .mock.calls.map((call) => JSON.stringify((call[0] as { data: unknown }).data))
      .join(' ')

    // Vault tokens, and the kind of prose only a transcript or note contains.
    expect(written).not.toMatch(/\[[A-Z]+_\d+\]/)
    expect(written).not.toMatch(/patient|doctor:|complains|reports|prescrib/i)
    // Nothing long enough to be a sentence of clinical text.
    for (const call of vi.mocked(prisma.auditEvent.create).mock.calls) {
      const meta = (call[0] as { data: { metadata?: unknown } }).data.metadata
      for (const value of JSON.stringify(meta ?? {}).match(/"[^"]*"/g) ?? []) {
        expect(value.length).toBeLessThan(40)
      }
    }
  })

  it('exposes no update or delete path', async () => {
    const audit = await import('./index.js')

    expect(Object.keys(audit).filter((k) => /update|delete|remove/i.test(k))).toEqual([])
  })
})

describe('the hash chain (issue #27)', () => {
  it('starts the chain at the genesis sentinel, never at null', async () => {
    await write({ action: 'consultation.created' })

    expect(lastWrite().data.prevHash).toBe(AUDIT_CHAIN_GENESIS)
  })

  it('links every append to the current chain head', async () => {
    await write({ action: 'consultation.created' })
    const first = lastWrite().data.hash

    await write({ action: 'consultation.approved' })

    expect(lastWrite().data.prevHash).toBe(first)
  })

  it('reads the head by append order, so same-millisecond writes cannot tie', async () => {
    await write({ action: 'consultation.created' })

    expect(prisma.auditEvent.findFirst).toHaveBeenCalledWith({
      where: { hash: { not: null } },
      orderBy: { seq: 'desc' },
      select: { hash: true },
    })
  })

  it('writes a hash matching the row it stores', async () => {
    await write({ action: 'consultation.created' })
    const { prevHash, id, action, actorId, consultationId, createdAt, hash } = lastWrite().data

    expect(hash).toBe(
      computeAuditHash({ prevHash, id, action, actorId, consultationId, createdAt }),
    )
  })

  /**
   * `id` and `createdAt` are hash inputs, so leaving them to their column
   * defaults would mean hashing values the database had not produced yet.
   */
  it('mints the id and timestamp rather than leaving them to the database', async () => {
    await write({ action: 'consultation.created' })

    expect(lastWrite().data.id).toEqual(expect.any(String))
    expect(lastWrite().data.createdAt).toBeInstanceOf(Date)
  })

  it('produces a chain that verifies end to end', async () => {
    await write({ action: 'consultation.created' })
    await write({ action: 'consultation.edited' })
    await write({ action: 'consultation.approved' })

    expect(verifyAuditChain(appended)).toMatchObject({ ok: true, verified: 3 })
  })

  it('produces a chain that fails verification once a row is edited', async () => {
    await write({ action: 'consultation.created' })
    await write({ action: 'consultation.edited' })
    await write({ action: 'consultation.approved' })

    const tampered = appended.map((row, index) =>
      index === 1 ? { ...row, action: 'consultation.approved' } : row,
    )

    expect(verifyAuditChain(tampered)).toMatchObject({
      ok: false,
      failedAtId: appended[1]?.id,
      reason: 'hash_mismatch',
    })
  })

  it('keeps metadata out of the hash inputs', async () => {
    await write({ action: 'redflag.acknowledged', metadata: { redFlagId: 'rf-1' } })
    const row = lastWrite().data

    // Recomputing without metadata reproduces the stored hash, so metadata
    // cannot have contributed to it.
    expect(
      computeAuditHash({
        prevHash: row.prevHash,
        id: row.id,
        action: row.action,
        actorId: row.actorId,
        consultationId: row.consultationId,
        createdAt: row.createdAt,
      }),
    ).toBe(row.hash)
  })
})

describe('getAuditHistory', () => {
  it('reads one consultation in chronological order', async () => {
    await getAuditHistory('consult-1')

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: { consultationId: 'consult-1' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, metadata: true, actorId: true, createdAt: true },
    })
  })
})
