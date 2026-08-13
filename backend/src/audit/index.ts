import { randomUUID } from 'node:crypto'
import type { ProfileId } from '../clinical-profiles/index.js'
import type { ActiveClinicalVersions } from '../clinical-versions/index.js'
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
  clinicalContent: ActiveClinicalVersions
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
export type ConsultationAuditEvent =
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
        profileId: ProfileId
        versions: AnalysisVersions
      }
    }
  | { action: 'consultation.analysis_failed'; metadata: { reason: AnalysisFailureReason } }
  | { action: 'consultation.edited' }
  | { action: 'consultation.erased' }
  | { action: 'redflag.acknowledged'; metadata: { redFlagId: string } }
  | { action: 'gap.reviewed'; metadata: { gapId: string } }
  | { action: 'consultation.approved' }

/**
 * Auth events belong to an actor but to no consultation (issue #14). They are
 * split out so `consultationId` can stay **required** on everything above
 * rather than being loosened to optional across the whole taxonomy, which would
 * let a consultation event be recorded without the consultation it describes.
 */
export type AuthAuditEvent = { action: 'auth.session.created' }

export type AuditEventInput = ConsultationAuditEvent | AuthAuditEvent

/**
 * How many times an append may lose the race for the chain head before giving
 * up. Three is enough that exhausting it means something is actually wrong
 * rather than that two requests arrived together.
 */
const CHAIN_HEAD_ATTEMPTS = 3

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002'

function isChainHeadRace(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  )
}

/**
 * Appends one audit row, linked to the current chain head. Append-only by
 * construction: this module exposes no update or delete.
 *
 * **This is the only place in the codebase that may write `auditEvent`**, and
 * `no-stray-audit-writes.test.ts` fails the build if that stops being true. It
 * was a comment before issue #55, and a comment is what let the auth hook write
 * unchained rows for as long as it did.
 *
 * `id` and `createdAt` are minted here rather than left to their column
 * defaults, because both are hash inputs and the database would otherwise not
 * produce them until after the hash had to be computed.
 *
 * The transaction keeps the head read and the append atomic; the unique
 * constraint on `prevHash` is the backstop that turns a lost race into an error
 * rather than a silently forked chain. Losing that race is a normal event now
 * that login writes to the chain and the guest account is shared, so it is
 * retried rather than surfaced.
 */
export async function recordAuditEvent(
  event:
    | (ConsultationAuditEvent & { actorId: string; consultationId: string })
    | (AuthAuditEvent & { actorId: string }),
): Promise<void> {
  const { action, actorId } = event
  const consultationId = 'consultationId' in event ? event.consultationId : undefined
  const metadata = 'metadata' in event ? event.metadata : undefined

  for (let attempt = 1; ; attempt += 1) {
    try {
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
          consultationId: consultationId ?? null,
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

      return
    } catch (error) {
      if (attempt >= CHAIN_HEAD_ATTEMPTS || !isChainHeadRace(error)) throw error
    }
  }
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
