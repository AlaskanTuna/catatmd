import { prisma } from '../lib/prisma.js'

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
 */
export interface AnalysisVersions {
  provider: string
  model: string
  redFlagListVersion: string
  guidelineCorpusVersion: string
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
 * Appends one audit row. Append-only by construction: this module exposes no
 * update or delete, and nothing else in the codebase writes `auditEvent`.
 */
export async function recordAuditEvent(
  event: AuditEventInput & { actorId: string; consultationId: string },
): Promise<void> {
  const { action, actorId, consultationId } = event
  const metadata = 'metadata' in event ? event.metadata : undefined

  await prisma.auditEvent.create({
    data: {
      action,
      actorId,
      consultationId,
      metadata: metadata === undefined ? undefined : JSON.parse(JSON.stringify(metadata)),
    },
  })
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
