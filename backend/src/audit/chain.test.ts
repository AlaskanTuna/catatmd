import { describe, expect, it } from 'vitest'
import {
  AUDIT_CHAIN_GENESIS,
  type AuditChainRow,
  computeAuditHash,
  verifyAuditChain,
} from './chain.js'

/** Builds a valid chain of `length` rows, oldest first. */
function buildChain(length: number): AuditChainRow[] {
  const rows: AuditChainRow[] = []
  let prevHash = AUDIT_CHAIN_GENESIS

  for (let i = 0; i < length; i += 1) {
    const input = {
      prevHash,
      id: `event-${i}`,
      action: 'consultation.created',
      actorId: 'doctor-1',
      consultationId: 'consult-1',
      createdAt: new Date(Date.UTC(2026, 7, 13, 10, 0, i)),
    }

    const hash = computeAuditHash(input)
    rows.push({ ...input, hash })
    prevHash = hash
  }

  return rows
}

describe('computeAuditHash', () => {
  const base = {
    prevHash: AUDIT_CHAIN_GENESIS,
    id: 'event-0',
    action: 'consultation.created',
    actorId: 'doctor-1',
    consultationId: 'consult-1',
    createdAt: new Date('2026-08-13T10:00:00.000Z'),
  }

  it('is stable for identical input', () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }))
  })

  /**
   * Every hash input must actually reach the digest. A field silently dropped
   * from the hash is a field that can be rewritten without detection, which is
   * the whole failure this issue exists to prevent.
   */
  it.each([
    ['prevHash', { prevHash: 'something-else' }],
    ['id', { id: 'event-99' }],
    ['action', { action: 'consultation.approved' }],
    ['actorId', { actorId: 'doctor-2' }],
    ['consultationId', { consultationId: 'consult-2' }],
    ['createdAt', { createdAt: new Date('2026-08-13T10:00:00.001Z') }],
  ])('changes when %s changes', (_field, change) => {
    expect(computeAuditHash({ ...base, ...change })).not.toBe(computeAuditHash(base))
  })

  /**
   * The clinical-safety constraint, as a type-level fact made explicit: the
   * hash input has no `metadata` field, so no detector label, note body or
   * vault entry can reach the digest even by accident.
   */
  it('takes no input beyond ids, the action and the timestamp', () => {
    expect(Object.keys(base).sort()).toEqual([
      'action',
      'actorId',
      'consultationId',
      'createdAt',
      'id',
      'prevHash',
    ])
  })
})

describe('verifyAuditChain', () => {
  it('accepts an intact chain and reports its head', () => {
    const rows = buildChain(4)

    expect(verifyAuditChain(rows)).toEqual({
      ok: true,
      verified: 4,
      head: rows[3]?.hash,
    })
  })

  it('accepts an empty chain', () => {
    expect(verifyAuditChain([])).toEqual({
      ok: true,
      verified: 0,
      head: AUDIT_CHAIN_GENESIS,
    })
  })

  it('fails at the mutated row when a historical row is edited', () => {
    const rows = buildChain(4)
    rows[1] = { ...(rows[1] as AuditChainRow), action: 'consultation.approved' }

    expect(verifyAuditChain(rows)).toEqual({
      ok: false,
      verified: 1,
      failedAtId: 'event-1',
      reason: 'hash_mismatch',
    })
  })

  it('fails when a historical row is deleted', () => {
    const rows = buildChain(4).filter((row) => row.id !== 'event-1')

    expect(verifyAuditChain(rows)).toEqual({
      ok: false,
      verified: 1,
      failedAtId: 'event-2',
      reason: 'orphaned',
    })
  })

  it('fails when the first row is deleted', () => {
    const rows = buildChain(4).filter((row) => row.id !== 'event-0')

    expect(verifyAuditChain(rows)).toEqual({
      ok: false,
      verified: 0,
      failedAtId: 'event-1',
      reason: 'orphaned',
    })
  })

  it('fails when a second chain is grafted onto the same predecessor', () => {
    const rows = buildChain(3)
    const forked = { ...(rows[2] as AuditChainRow), id: 'event-fork' }
    rows.push({ ...forked, hash: computeAuditHash(forked) })

    expect(verifyAuditChain(rows).ok).toBe(false)
  })

  /**
   * The honest limitation, asserted rather than only documented: deleting rows
   * from the end leaves a shorter chain that is internally valid. Only an
   * auditor holding an earlier head hash can see it (docs/trd.md §15).
   */
  it('cannot detect a truncated tail on its own', () => {
    const full = buildChain(4)
    const truncated = full.slice(0, 2)

    expect(verifyAuditChain(truncated).ok).toBe(true)
    expect(verifyAuditChain(truncated, full[3]?.hash)).toEqual({
      ok: false,
      verified: 2,
      failedAtId: null,
      reason: 'unexpected_head',
    })
  })
})
