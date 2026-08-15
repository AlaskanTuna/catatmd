import { randomUUID } from 'node:crypto'
import { type DispositionState, NotificationActionSchema } from '@shared/types'
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
  /*
   * The three-way disposition (issue #10). `state` is recorded and the
   * dismissal reason deliberately is not: the reason is clinician free text
   * about a specific patient, so it is clinical content and stays on the
   * consultation, which is the clinical record. Copying it here would put
   * unredacted prose in the table whose purpose is to be widely readable.
   */
  | { action: 'redflag.disposition_set'; metadata: { redFlagId: string; state: DispositionState } }
  | { action: 'gap.disposition_set'; metadata: { gapId: string; state: DispositionState } }
  | { action: 'consultation.approved' }

/**
 * Auth events belong to an actor but to no consultation (issue #14). They are
 * split out so `consultationId` can stay **required** on everything above
 * rather than being loosened to optional across the whole taxonomy, which would
 * let a consultation event be recorded without the consultation it describes.
 */
export type AuthAuditEvent = { action: 'auth.session.created' }

/**
 * Demo Mode's ephemeral analysis (#80). It spends a real LLM call and writes no
 * `Consultation`, so it belongs to an actor and to no consultation for the same
 * structural reason auth events do.
 *
 * It is audited despite persisting nothing. The endpoint cannot tell demo
 * content from real content, so "it is only synthetic" is a property of intent
 * rather than of the system, and an unaudited egress would be a hole in the one
 * property the PHI boundary rests on. The row records **that** an analysis
 * happened, never what was in it: the same labels-only rule as everything above.
 */
export type EphemeralAuditEvent =
  | {
      action: 'consultation.ephemeral_analyzed'
      metadata: {
        detected: readonly string[]
        discardedFieldIds: readonly string[]
        profileId: ProfileId
        versions: AnalysisVersions
      }
    }
  | {
      action: 'consultation.ephemeral_analysis_failed'
      metadata: { reason: AnalysisFailureReason }
    }

/**
 * Short failure categories for `asr.hosted_relay_failed`. A closed set, never
 * the raw error text: on this path an upstream response body is a transcript.
 */
export type AsrRelayFailureReason =
  | 'rejected_audio'
  | 'too_large'
  | 'no_allocation'
  | 'rate_limited'
  | 'unavailable'

/**
 * The hosted-ASR relay (#154). It forwards consultation audio to the ASR
 * provider and persists nothing, so it belongs to an actor and to no
 * consultation for the same structural reason ephemeral analysis does: no
 * `Consultation` exists at relay time. These rows are the server-observed half
 * of a pair; `consultation.asr_hosted_used`, written at creation, remains the
 * client-asserted linkage (docs/trd.md §15).
 *
 * Audited despite persisting nothing, and for the same reason as above: an
 * unaudited audio egress would be a hole in the property the PHI boundary
 * rests on. The rows record **that** audio egressed and for how many billed
 * seconds, never what it contained.
 */
export type AsrAuditEvent =
  | { action: 'asr.hosted_relayed'; metadata: { durationSeconds: number; model: string } }
  | { action: 'asr.hosted_relay_failed'; metadata: { reason: AsrRelayFailureReason } }

export type AuditEventInput =
  | ConsultationAuditEvent
  | AuthAuditEvent
  | EphemeralAuditEvent
  | AsrAuditEvent

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
    | (AuthAuditEvent & { actorId: string })
    | (EphemeralAuditEvent & { actorId: string })
    | (AsrAuditEvent & { actorId: string }),
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

/**
 * The recent notifiable events for one actor, newest first (issue #116).
 *
 * Scoped on `actorId` in the query rather than filtered afterwards, so there is
 * no shape of this function that reads another doctor's events into memory
 * first. `@@index([actorId, createdAt])` already covers the access path.
 *
 * `metadata` is deliberately not selected. It is the one audit column that
 * could ever carry something richer than a label, and a feed rendered in the
 * chrome of every screen is the last place that should be the first consumer of
 * it.
 */
export async function getActorNotifications(actorId: string, limit: number) {
  // "Cleared" is a read cursor, not a delete. `AuditEvent` is append-only and
  // is the tamper-evident record, so clearing the feed moves this mark forward
  // and the rows behind it stay exactly where they were.
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { notificationsClearedAt: true },
  })

  return prisma.auditEvent.findMany({
    where: {
      actorId,
      action: { in: NotificationActionSchema.options },
      ...(actor?.notificationsClearedAt ? { createdAt: { gt: actor.notificationsClearedAt } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, consultationId: true, createdAt: true },
  })
}

/**
 * Moves the actor's feed cursor to now, hiding everything currently in it.
 *
 * Deliberately not an audited event. It changes nothing about the clinical
 * record and nothing about what happened; it is a per-user view preference, and
 * writing an audit row for dismissing a list would add noise to the one table
 * whose value depends on every row mattering.
 */
export async function clearActorNotifications(actorId: string): Promise<void> {
  await prisma.user.update({
    where: { id: actorId },
    data: { notificationsClearedAt: new Date() },
  })
}
