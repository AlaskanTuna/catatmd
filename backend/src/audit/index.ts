import { randomUUID } from 'node:crypto'
import { type DispositionState, type NoteTemplate, NotificationActionSchema } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/index.js'
import type { ActiveClinicalVersions } from '../clinical-versions/index.js'
import { prisma } from '../lib/prisma.js'
import type { SuppressedSuggestionId } from '../suggestions/safety.js'
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
  | { action: 'consultation.asr_live_used' }
  | { action: 'consultation.analysis_started' }
  | {
      action: 'consultation.analysis_completed'
      metadata: {
        /** Detector labels that fired, e.g. ["NRIC","NAME"]. Never the values. */
        detected: readonly string[]
        /** Field ids forced to NOT_ASSESSED by the evidence check. Ids, never content. */
        discardedFieldIds: readonly string[]
        /** Server-generated positions for rejected model suggestions. Never model content or ids. */
        suppressedSuggestionIds: readonly SuppressedSuggestionId[]
        profileId: ProfileId
        versions: AnalysisVersions
      }
    }
  | { action: 'consultation.analysis_failed'; metadata: { reason: AnalysisFailureReason } }
  /*
   * Ambient capture's live fold, which is an LLM egress and so has to be
   * recorded. **Session-scoped, not per cycle**, and that is a deliberate
   * trade rather than an oversight.
   *
   * A twenty-minute consultation at the 12 second cadence is roughly 100
   * cycles. `recordAuditEvent` serialises on a globally unique `prevHash` and
   * retries a head race only `CHAIN_HEAD_ATTEMPTS` times, so 100 chained
   * appends per consultation, with several clinicians recording at once, would
   * exhaust that and fail requests for a reason unrelated to the request.
   *
   * The shipped precedent is the same shape: `asr.live_session_minted` records
   * one key that goes on to open an unbounded number of provider connections
   * carrying the whole consultation's audio. A session-scoped row for a
   * session-scoped egress is the pattern this repo already accepted.
   *
   * The started row is written on the first cycle only, the failed row always.
   */
  | {
      action: 'consultation.live_analysis_started'
      metadata: {
        profileId: ProfileId
        versions: AnalysisVersions
      }
    }
  | { action: 'consultation.live_analysis_failed'; metadata: { reason: AnalysisFailureReason } }
  | { action: 'consultation.edited' }
  | {
      action: 'consultation.template_selected'
      metadata: { template: NoteTemplate }
    }
  /*
   * Its own action rather than folded into `consultation.edited`, because
   * `title` is a PHI-bearing column a doctor writes free text into, and it is
   * the one field that stays editable after approval. A trail that cannot tell
   * "the note was changed" from "the record was renamed after it was signed"
   * loses the distinction precisely where it matters.
   *
   * No metadata. The old and new titles are exactly the free text this must not
   * carry, so the row records that a rename happened, by whom and when, and the
   * value lives only in the column.
   */
  | { action: 'consultation.renamed' }
  | { action: 'consultation.erased' }
  /**
   * The consultation recording (#293), which is PHI of a kind no other event
   * here touches: a voice cannot be de-identified, so these rows are the only
   * server-side record that it existed and when it stopped existing.
   *
   * `bytes` and `retentionHours` are configuration and size, never content.
   * There is deliberately no event for *playing* a recording back beyond the
   * served row: a doctor checking their own consultation repeatedly is the
   * behaviour this feature exists to encourage, not something to make them
   * feel watched for.
   */
  | {
      action: 'consultation.audio_stored'
      metadata: { bytes: number; retentionHours: number }
    }
  | { action: 'consultation.audio_served' }
  | { action: 'consultation.audio_purged' }
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
 * Adopting a retention period, and withdrawing one (#80).
 *
 * Audited for the reason the column exists at all: it records a governance
 * decision rather than a preference, and a bare mutable integer cannot answer
 * "what was the policy on this date, and who set it". `docs/dpia.md` requires
 * the decision to name its rationale and accountable owner; without a trail the
 * accountable owner is only ever whoever set it last.
 *
 * One action rather than two, with the value carried, so withdrawing a period
 * is as legible as adopting one. `adoptedYears: null` is the withdrawal.
 *
 * The value is in `metadata` deliberately. The labels-only rule exists to keep
 * patient data out of the audit trail, and a configured number of years is
 * configuration, not content; `EphemeralAuditEvent` already carries profile ids
 * and versions on the same basis. Without the value the row would say something
 * changed and answer nothing.
 *
 * Nothing enforces the period, so this records a decision that currently has no
 * effect. That is the point: when enforcement does land, a trail that started
 * on the day it shipped would be retroactively useless for everything before it.
 */
export type SettingsAuditEvent = {
  action: 'settings.retention_adopted'
  metadata: { adoptedYears: number | null }
}

/**
 * Registration events belong to a patient rather than a consultation, so they
 * follow the `AuthAuditEvent` precedent and carry no `consultationId` — the
 * alternative would be loosening that field to optional across the whole
 * consultation taxonomy, which is the one thing keeping a clinical event from
 * being recorded without the record it describes.
 *
 * No metadata on any of them. A patient row is entered by a human and every
 * column on it is an identifier, so there is nothing here that could be
 * recorded without putting identity into the table whose purpose is to be
 * widely readable. The row says a registration happened, by whom, and when.
 */
export type PatientAuditEvent =
  | { action: 'patient.created' }
  | { action: 'patient.updated' }
  | { action: 'patient.erased' }

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
        suppressedSuggestionIds: readonly SuppressedSuggestionId[]
        profileId: ProfileId
        versions: AnalysisVersions
      }
    }
  | {
      action: 'consultation.ephemeral_analysis_failed'
      metadata: { reason: AnalysisFailureReason }
    }

/**
 * The retention sweep, which is the first event here with no actor (#293).
 *
 * **That absence is the honest shape, not an oversight.** Every other event
 * records something a person did to a record they can reach. This one records a
 * clock closing a window across every doctor's recordings at once, and
 * attributing it to whoever happened to trigger the sweep would put one
 * doctor's id against the destruction of another's audio. `computeAuditHash`
 * already folds a missing actor in as an empty string, so the chain is
 * unaffected.
 *
 * It exists because the retention period is only a control if something
 * enforces it and the enforcement is visible. `count` is a number of rows,
 * never which ones.
 */
export type SystemAuditEvent = { action: 'audio.swept'; metadata: { count: number } }

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
 * Short failure categories for `asr.live_session_failed`. A closed set for the
 * same reason as the relay's, one step earlier: on this path the upstream
 * response body is a credential rather than a transcript, and neither belongs
 * in a row anyone can read.
 *
 * `rejected` covers every upstream refusal of our own account key, which is a
 * configuration fault rather than the caller's business.
 */
export type LiveSessionFailureReason = 'rejected' | 'rate_limited' | 'unavailable'

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
  /**
   * Ambient capture (#268). The pair below records a **minted session**, not a
   * relayed recording: the audio goes from the browser to the provider without
   * passing through here, so the last server-observable moment is the issuing
   * of the key that opens the stream.
   *
   * `clientReferenceId` is generated by the API and bound to the key by the
   * provider, so it reconciles this row against their usage log; it is an
   * identifier, never content. `consentAsserted` records what the client said,
   * which is all the API can know: the gate is a property of the frontend.
   */
  | {
      action: 'asr.live_session_minted'
      metadata: {
        clientReferenceId: string
        model: string
        region: string
        maxSessionSeconds: number
        consentAsserted: true
      }
    }
  | { action: 'asr.live_session_failed'; metadata: { reason: LiveSessionFailureReason } }
  | {
      action: 'asr.hosted_draft_labelled'
      metadata: { turnCount: number; detected: readonly string[]; model: string }
    }
  | { action: 'asr.hosted_draft_failed'; metadata: { reason: DraftTurnsFailureReason } }

/**
 * Closed failure categories for `asr.hosted_draft_failed`, never raw error
 * text: on this path an error message can embed model output, which is
 * transcript-derived. `llm_failed` covers the provider call and its schema
 * validation; `not_reconstructed` is the verbatim guard rejecting a draft
 * whose turns do not rebuild the input.
 */
export type DraftTurnsFailureReason = 'llm_failed' | 'not_reconstructed'

export type AuditEventInput =
  | ConsultationAuditEvent
  | AuthAuditEvent
  | PatientAuditEvent
  | SettingsAuditEvent
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
    | (PatientAuditEvent & { actorId: string })
    | (SettingsAuditEvent & { actorId: string })
    | (EphemeralAuditEvent & { actorId: string })
    | (AsrAuditEvent & { actorId: string })
    // No `actorId`: see `SystemAuditEvent`. This is the clock acting, not a person.
    | SystemAuditEvent,
): Promise<void> {
  const { action } = event
  // Read the same way `consultationId` is, because the retention sweep carries
  // neither: it is the clock acting rather than a person (see SystemAuditEvent).
  const actorId = 'actorId' in event ? event.actorId : undefined
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
          // `?? null` for the sweep, which has no actor. `computeAuditHash`
          // folds null and undefined to the same empty string, so this changes
          // no existing row's hash.
          actorId: actorId ?? null,
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
