import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { type AuditEventInput, getAuditHistory, recordAuditEvent } from './index.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: { auditEvent: { create: vi.fn(), findMany: vi.fn(() => []) } },
}))

beforeEach(() => {
  vi.mocked(prisma.auditEvent.create).mockClear()
  vi.mocked(prisma.auditEvent.findMany).mockClear()
})

const write = (event: AuditEventInput) =>
  recordAuditEvent({ ...event, actorId: 'doctor-1', consultationId: 'consult-1' })

function lastWrite() {
  return vi.mocked(prisma.auditEvent.create).mock.calls.at(-1)?.[0] as {
    data: { action: string; actorId: string; consultationId: string; metadata?: unknown }
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
          redFlagListVersion: '2026-08-13',
          guidelineCorpusVersion: '2026-08-13',
        },
      },
    })

    expect(lastWrite().data.metadata).toEqual({
      detected: ['NRIC', 'NAME'],
      discardedFieldIds: ['fever', 'cough_duration'],
      versions: {
        provider: 'qwen',
        model: 'qwen-flash',
        redFlagListVersion: '2026-08-13',
        guidelineCorpusVersion: '2026-08-13',
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
            redFlagListVersion: 'v1',
            guidelineCorpusVersion: 'v1',
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
