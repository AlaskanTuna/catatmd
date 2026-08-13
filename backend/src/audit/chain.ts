import { createHash } from 'node:crypto'

/**
 * The `prevHash` of the first row in the chain. A fixed sentinel rather than
 * `null`, because Postgres lets any number of `null`s through a unique index:
 * a nullable chain root would silently permit a second chain to start beside
 * the first, which is exactly the tampering this is meant to expose.
 */
export const AUDIT_CHAIN_GENESIS = 'genesis'

/**
 * What enters the hash. IDs, event types and timestamps only (issue #27).
 *
 * `metadata` is deliberately absent. It is the one column that could ever carry
 * something richer than a label, so keeping it out of the hash input means the
 * chain can never become a second copy of anything sensitive. The cost is that
 * a `metadata` rewrite is not detectable; docs/trd.md §15 states that plainly.
 */
export interface AuditChainInput {
  prevHash: string
  id: string
  action: string
  actorId: string | null
  consultationId: string | null
  createdAt: Date
}

export interface AuditChainRow extends AuditChainInput {
  hash: string
}

/**
 * Every hashed field is an id, a member of the `action` enum, or an ISO-8601
 * timestamp, and none of those can contain a pipe. Separating on one therefore
 * means no two different field splits can produce the same digest.
 */
const FIELD_SEPARATOR = '|'

export function computeAuditHash(row: AuditChainInput): string {
  return createHash('sha256')
    .update(
      [
        row.prevHash,
        row.id,
        row.action,
        row.actorId ?? '',
        row.consultationId ?? '',
        row.createdAt.toISOString(),
      ].join(FIELD_SEPARATOR),
    )
    .digest('hex')
}

export type AuditChainFailure =
  /** A row's stored hash disagrees with its contents: the row was edited. */
  | 'hash_mismatch'
  /** A row the chain cannot reach: its predecessor was deleted or rewritten. */
  | 'orphaned'
  /** The chain is intact but ends somewhere other than the head the auditor holds. */
  | 'unexpected_head'

export type AuditChainVerification =
  | { ok: true; verified: number; head: string }
  | { ok: false; verified: number; failedAtId: string | null; reason: AuditChainFailure }

/**
 * Walks the chain from the genesis sentinel and reports the first row that does
 * not hold up.
 *
 * The walk follows `prevHash` links rather than sorting by `createdAt`, so two
 * rows written in the same millisecond cannot be read back in the wrong order
 * and reported as tampering. A false alarm in an integrity check costs nearly
 * as much as a missed one.
 *
 * Pass `knownHead` to detect truncation. Deleting rows from the *end* of an
 * otherwise valid chain leaves a shorter valid chain, so it is only detectable
 * against a head hash recorded earlier: that is the whole of the guarantee, and
 * this parameter is how an auditor uses it.
 */
export function verifyAuditChain(
  rows: readonly AuditChainRow[],
  knownHead?: string,
): AuditChainVerification {
  const byPrevHash = new Map(rows.map((row) => [row.prevHash, row]))
  const unreachable = new Set(rows.map((row) => row.id))

  let head = AUDIT_CHAIN_GENESIS
  let verified = 0
  let next = byPrevHash.get(head)

  while (next !== undefined) {
    if (computeAuditHash(next) !== next.hash) {
      return { ok: false, verified, failedAtId: next.id, reason: 'hash_mismatch' }
    }

    unreachable.delete(next.id)
    head = next.hash
    verified += 1
    next = byPrevHash.get(head)
  }

  if (unreachable.size > 0) {
    const earliest = rows
      .filter((row) => unreachable.has(row.id))
      .reduce((first, row) => (row.createdAt < first.createdAt ? row : first))

    return { ok: false, verified, failedAtId: earliest.id, reason: 'orphaned' }
  }

  if (knownHead !== undefined && head !== knownHead) {
    return { ok: false, verified, failedAtId: null, reason: 'unexpected_head' }
  }

  return { ok: true, verified, head }
}
