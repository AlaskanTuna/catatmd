import { randomUUID } from 'node:crypto'
import type { ACTIVE_CLINICAL_VERSIONS } from '../clinical-versions/index.js'
import { prisma } from '../lib/prisma.js'
import {
  AUDIT_CHAIN_GENESIS,
  type AuditChainRow,
  computeAuditHash,
  verifyAuditChain,
} from './chain.js'

export {
  AUDIT_CHAIN_GENESIS,
  type AuditChainFailure,
  type AuditChainRow,
  type AuditChainVerification,
  computeAuditHash,
  verifyAuditChain,
} from './chain.js'

/**
 * Short failure categories for `consultation.analysis_failed`. A closed set,
 * never the raw error text — a thrown value on the analyse path routinely
 * carries transcript fragments (docs/trd.md §15).
 */
export type AnalysisFailureReason =
  | 'deidentification_failed'
  | 'llm_response_invalid'
  | 'llm_unavailable'
  | 'internal_error'

/**
 * Which versions of the system produced one analysis (issue #12). Enough to
 * answer "what generated this note?" months later without guessing.
 *
 * `clinicalContent` is typed as the aggregator itself rather than a hand-listed
 * set of fields (issue #16), so adding a versioned artefact cannot leave the
 * stamp behind: the only way to satisfy this type is to write the whole of
 * `ACTIVE_CLINICAL_VERSIONS`.
 */
export interface AnalysisVersions {
  provider: string
  model: string
  clinicalContent: typeof ACTIVE_CLINICAL_VERSIONS
}

/**
 * The `AuditEvent.action` taxonomy from docs/trd.md §15, as a discriminated
 * union rather than a free string.
 *
 * §15 proposes exactly this ("constraining its shape to a discriminated union
 * keyed by `action` is proposed here but not yet implemented"); implementing it
 * is what turns "no metadata value may contain clinical content" from a review
 * convention into a compile error. There is no `metadata` shape in this union
 * that can hold a transcript body, note text, gap or suggestion text, or a
 * vault entry — only identifiers, detector labels, and version stamps.
 */
export type AuditEventInput =
  | { action: 'consultation.created' }
  | { action: 'consultation.asr_hosted_used' }
  | { action: 'consultation.analysis_started' }
  | {
      action: 'consultation.analysis_completed'
      metadata: {
        /** Detector labels that fired, e.g. ["NRIC","NAME"]. Never the values. */
        detected: readonly string[]
        /** Field ids forced to NOT_ASSESSED by the evidence check. Ids, never content. */
        discardedFieldIds: readonly string[]
        versions: AnalysisVersions
      }
    }
  | { action: 'consultation.analysis_failed'; metadata: { reason: AnalysisFailureReason } }
  | { action: 'consultation.edited' }
  | { action: 'redflag.acknowledged'; metadata: { redFlagId: string } }
  | { action: 'gap.reviewed'; metadata: { gapId: string } }
  | { action: 'consultation.approved' }

/**
 * Appends one audit row, linked to the current chain head. Append-only by
 * construction: this module exposes no update or delete, and nothing else in
 * the codebase writes `auditEvent`.
 *
 * `id` and `createdAt` are minted here rather than left to their column
 * defaults, because both are hash inputs and the database would otherwise not
 * produce them until after the hash had to be computed.
 *
 * The transaction is what keeps the head read and the append atomic. The unique
 * constraint on `prevHash` is the backstop: under enough write concurrency two
 * appends can still read the same head, and the constraint turns that into a
 * loud failure rather than a silently forked chain. A deployment with real
 * write concurrency wants a retry here.
 */
export async function recordAuditEvent(
  event: AuditEventInput & { actorId: string; consultationId: string },
): Promise<void> {
  const { action, actorId, consultationId } = event
  const metadata = 'metadata' in event ? event.metadata : undefined

  await prisma.$transaction(async (tx) => {
    const head = await tx.auditEvent.findFirst({
      where: { hash: { not: null } },
      orderBy: { seq: 'desc' },
      select: { hash: true },
    })

    const row = {
      prevHash: head?.hash ?? AUDIT_CHAIN_GENESIS,
      id: randomUUID(),
      action,
      actorId,
      consultationId,
      createdAt: new Date(),
    }

    await tx.auditEvent.create({
      data: {
        ...row,
        hash: computeAuditHash(row),
        metadata: metadata === undefined ? undefined : JSON.parse(JSON.stringify(metadata)),
      },
    })
  })
}

/**
 * Reads the chain and reports the first row that does not hold up.
 *
 * Rows written before this chain existed carry no hash and are skipped: you
 * cannot retrofit integrity onto history you did not record while it happened.
 * Pass the head hash from a previous run as `knownHead` to also catch rows
 * deleted from the end, which an intact-but-shorter chain cannot reveal.
 */
export async function verifyAuditChainFromDatabase(
  knownHead?: string,
): Promise<ReturnType<typeof verifyAuditChain>> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      prevHash: true,
      hash: true,
      action: true,
      actorId: true,
      consultationId: true,
      createdAt: true,
    },
  })

  const chained = rows.flatMap<AuditChainRow>((row) =>
    row.prevHash === null || row.hash === null
      ? []
      : [{ ...row, prevHash: row.prevHash, hash: row.hash }],
  )

  return verifyAuditChain(chained, knownHead)
}

/**
 * The full event history for one consultation, oldest first. Ownership is the
 * caller's responsibility — every route reaching this has already been through
 * `assertOwnedConsultation`.
 */
export async function getAuditHistory(consultationId: string) {
  return prisma.auditEvent.findMany({
    where: { consultationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, action: true, metadata: true, actorId: true, createdAt: true },
  })
}
