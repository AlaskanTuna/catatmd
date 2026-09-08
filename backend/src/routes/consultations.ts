import type { Consultation, Prisma } from '@prisma/client'
import {
  CaptureModeSchema,
  type ConsultationAnalysis,
  ConsultationAnalysisSchema,
  ConsultationDetailSchema,
  ConsultationListItemSchema,
  ConsultationTitleSchema,
  type Disposition,
  type DispositionInput,
  DispositionInputSchema,
  ERASE_BATCH_LIMIT,
  EraseConsultationsInputSchema,
  type InformationGap,
  LiveAnalysisResponseSchema,
  LiveAnalysisStateSchema,
  LiveFlagsResponseSchema,
  MAX_LIVE_DELTA_CHARACTERS,
  MAX_LIVE_DELTA_TURNS,
  type MedicalRecordNote,
  MedicalRecordNoteSchema,
  NoteTemplateSchema,
  type SoapNote,
  SoapNoteSchema,
  type Transcript,
  TranscriptSchema,
  toSoapNote,
} from '@shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { analyseNote, buildEvidenceLinks } from '../analysis/index.js'
import { analyseLiveWindow, foldFacts, foldOperational } from '../analysis/live.js'
import { deriveConsultationTitle } from '../analysis/title.js'
import { eraseConsultation } from '../audit/erasure.js'
import { type AnalysisFailureReason, getAuditHistory, recordAuditEvent } from '../audit/index.js'
import {
  type ClinicalProfile,
  DEFAULT_PROFILE_ID,
  getClinicalProfile,
  ProfileIdSchema,
} from '../clinical-profiles/index.js'
import { getActiveClinicalVersions } from '../clinical-versions/index.js'
import { DeidentificationError, deidentifyTranscript } from '../deid/index.js'
import { deriveGaps } from '../gaps/index.js'
import { assertOwnedConsultation, assertOwnedPatient } from '../lib/authz.js'
import { HttpError } from '../lib/http-error.js'
import { getLLMDescriptor, LLMResponseError } from '../lib/llm/index.js'
import { logger, timeStage } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { evaluateRedFlags, mergeRedFlags } from '../redflags/index.js'
import { generateSuggestions } from '../suggestions/index.js'
import type { SuppressedSuggestionId } from '../suggestions/safety.js'

export const consultationsRouter = Router()

/** `req.doctorId` is set by `requireSession`, which guards every route here. */
/** Exported for the copilot route, which is scoped to a consultation too. */
export function doctorId(req: { doctorId?: string }): string {
  if (!req.doctorId) throw new HttpError(401, 'unauthenticated', 'Authentication required.')
  return req.doctorId
}

/**
 * Maps a persisted row onto the wire contract, validating on the way out — the
 * JSON columns are `Json?` to Prisma, so this is the only place their shape is
 * actually checked.
 */
/**
 * Reads dispositions, projecting a pre-#10 row forward rather than migrating it.
 *
 * A consultation reviewed before dispositions existed carries only a list of
 * ids, and every id in it meant "acknowledged". Deriving that on read is
 * lossless and leaves the stored data untouched, which is preferable to a
 * backfill that rewrites clinical review history to fit a newer shape.
 *
 * `decidedAt` is unknowable for those rows. `updatedAt` is the closest honest
 * answer: the decision happened at or before the row was last written.
 */
function dispositionsFor(
  stored: Prisma.JsonValue | null,
  legacyIds: Prisma.JsonValue | null,
  fallbackAt: Date,
) {
  if (stored !== null && stored !== undefined) return stored
  return ((legacyIds as string[] | null) ?? []).map((id) => ({
    id,
    state: 'acknowledged' as const,
    decidedAt: fallbackAt,
  }))
}

function persistedProfileId(analysis: Prisma.JsonValue | null) {
  if (analysis === null || typeof analysis !== 'object' || Array.isArray(analysis)) return undefined

  const parsed = ProfileIdSchema.safeParse((analysis as Record<string, unknown>).profileId)
  return parsed.success ? parsed.data : undefined
}

function toDetail(
  row: Consultation,
  approvedBy: string | null = null,
  patient: { id: string; name: string | null } | null = null,
) {
  const detail = ConsultationDetailSchema.parse({
    id: row.id,
    status: row.status,
    // `?? null` for the same reason the JSON columns below carry it: a row
    // built before this column existed, or by a caller that did not select it,
    // arrives as `undefined`, and the contract distinguishes "no title" from
    // "field absent" only by rejecting the second.
    title: row.title ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    transcript: row.transcript ?? null,
    analysis: row.analysis ?? null,
    editedNote: row.editedNote ?? null,
    editedMedicalRecordNote: row.editedMedicalRecordNote ?? null,
    noteTemplate: row.noteTemplate ?? 'soap',
    captureMode: row.captureMode ?? 'manual',
    approvedAt: row.approvedAt,
    approvedBy,
    patient,
    acknowledgedRedFlagIds: row.acknowledgedRedFlagIds ?? [],
    reviewedGapIds: row.reviewedGapIds ?? [],
    redFlagDispositions: dispositionsFor(
      row.redFlagDispositions,
      row.acknowledgedRedFlagIds,
      row.updatedAt,
    ),
    gapDispositions: dispositionsFor(row.gapDispositions, row.reviewedGapIds, row.updatedAt),
  })

  /*
   * `profileId` predates the shared detail schema and lives inside the
   * analysis JSON rather than as a column. Preserve this one validated key so
   * CatatAI can select the same corpus as the analysis; legacy analyses keep
   * the schema's ordinary shape and therefore use its default profile.
   */
  const profileId = persistedProfileId(row.analysis)
  if (profileId === undefined || detail.analysis === null) return detail

  return {
    ...detail,
    analysis: { ...detail.analysis, profileId },
  }
}

/**
 * Attaches the approving clinician's name (issue #26).
 *
 * Resolved from `doctorId` rather than from the approval audit event, because
 * `assertOwnedConsultation` scopes every read and write on that column, so the
 * owner is the only account that can reach the approve transition at all. If a
 * clinic or admin boundary is ever added, that stops being true and the actor
 * on the `consultation.approved` event becomes the authority instead. The
 * `AuditEvent` row already records it, so the fix is a join, not a migration.
 *
 * Costs a query only on approved consultations; there is nothing to name until
 * the transition has happened.
 */
/** Exported so the copilot route projects a consultation exactly as GET does. */
export async function toDetailWithApprover(row: Consultation) {
  /*
   * Resolved on every read, not only after approval, because a doctor reading
   * an unapproved note needs to know whose note it is just as much — arguably
   * more, since that is the point at which they can still act on it.
   *
   * An erased patient resolves to null rather than to a tombstoned name: the
   * filing link survives for the audit chain, but nothing identifying should
   * come back through a screen after erasure.
   */
  const patient = row.patientId
    ? await prisma.patient.findFirst({
        where: { id: row.patientId, erasedAt: null },
        select: { id: true, name: true },
      })
    : null

  if (row.approvedAt === null) return toDetail(row, null, patient)

  const doctor = await prisma.user.findUnique({
    where: { id: row.doctorId },
    select: { name: true },
  })
  return toDetail(row, doctor?.name ?? null, patient)
}

/**
 * Must stay byte-identical to the serialisation inside `deidentifyTranscript`,
 * so evidence offsets computed against the raw text line up with the
 * de-identified text the model saw. Duplicated rather than imported because
 * `deid/` does not export it — see the note in the handover.
 */
/**
 * Deterministic gaps first, model gaps additive — the same rule the red-flag
 * engine follows. `deriveGaps` reads the structured facts, so its output is
 * reproducible; the model may only add to it, never remove an entry.
 */
function mergeGaps(derived: InformationGap[], modelGaps: InformationGap[]): InformationGap[] {
  const seen = new Set(derived.map((gap) => gap.id))
  return [...derived, ...modelGaps.filter((gap) => !seen.has(gap.id))]
}

/**
 * Rehydrates every `value` and `evidence` string anywhere in an assertion tree.
 *
 * Recursive rather than a per-field map, for two reasons. The structure is not
 * uniform: `ClinicalFacts` nests assertions two levels under four groups, while
 * `OperationalBlock` is flat except for `medicationsDispensed`, which is an
 * array of them. And a hard-coded field list would silently stop covering a
 * field the moment the 29-key checklist grows, which is the same failure the
 * clinical-version guard exists to prevent.
 *
 * `evidence` in particular is a verbatim span from the *de-identified*
 * transcript by construction, so it carries `[PATIENT_1]`-style tokens
 * essentially always rather than occasionally.
 */
function rehydrateAssertions<T>(node: T, rehydrate: (value: string) => string): T {
  if (Array.isArray(node)) {
    return node.map((item) => rehydrateAssertions(item, rehydrate)) as T
  }
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) =>
        (key === 'value' || key === 'evidence') && typeof value === 'string'
          ? [key, rehydrate(value)]
          : [key, rehydrateAssertions(value, rehydrate)],
      ),
    ) as T
  }
  return node
}

function classifyFailure(error: unknown): AnalysisFailureReason {
  if (error instanceof DeidentificationError) return 'deidentification_failed'
  if (error instanceof LLMResponseError) return 'llm_response_invalid'
  return 'internal_error'
}

// ─── Routes (docs/trd.md §13) ────────────────────────────────────────────────

consultationsRouter.get('/', async (req, res) => {
  const rows = await prisma.consultation.findMany({
    where: { doctorId: doctorId(req), erasedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, title: true, createdAt: true, updatedAt: true },
  })

  res.json({ consultations: rows.map((row) => ConsultationListItemSchema.parse(row)) })
})

/*
 * `patientId` is optional and stays optional. Four of the five capture modes —
 * paste, upload, fixture, and an ad-hoc recording — begin without a registered
 * patient, and requiring one would push that work outside the system rather
 * than into it. Only the queue path carries an id.
 */
/*
 * The transcript is optional, because a consultation is now created *before*
 * it is captured: the doctor opens the patient, the record exists, and the
 * capture panel writes into it. Requiring one here forced the old two-screen
 * flow, where a transcript was assembled somewhere else and the record only
 * came into being once it was complete.
 *
 * A consultation with no transcript is a real, reachable state and is exactly
 * what the capture panel renders against — not an incomplete row.
 */
const CreateBodySchema = z.object({
  transcript: TranscriptSchema.optional(),
  patientId: z.string().nullish(),
})

consultationsRouter.post('/', async (req, res) => {
  const parsed = CreateBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'A valid transcript is required.')
  }

  const actor = doctorId(req)

  /*
   * Filed against a patient only after that patient is proven to be this
   * doctor's. Writing the id straight through would let a caller attach a
   * consultation to someone else's patient row, which is the ownership boundary
   * failing in the one direction a read-side check never catches.
   */
  if (parsed.data.patientId) {
    await assertOwnedPatient(parsed.data.patientId, actor)
  }

  const created = await prisma.consultation.create({
    data: {
      doctorId: actor,
      status: 'draft',
      transcript: parsed.data.transcript ?? undefined,
      patientId: parsed.data.patientId ?? null,
    },
  })

  await recordAuditEvent({
    action: 'consultation.created',
    actorId: actor,
    consultationId: created.id,
  })

  // A client-asserted fact, recorded at the first point the transcript source
  // and a consultation id coexist (docs/trd.md §15).
  if (parsed.data.transcript?.source === 'asr_hosted') {
    await recordAuditEvent({
      action: 'consultation.asr_hosted_used',
      actorId: actor,
      consultationId: created.id,
    })
  }

  // Ambient capture streams past the API entirely (#268), so this row is the
  // only place a consultation is tied to that egress at all. The server-side
  // half is `asr.live_session_minted`, which belongs to an actor and knows no
  // consultation id, exactly as the relay's does.
  if (parsed.data.transcript?.source === 'asr_live') {
    await recordAuditEvent({
      action: 'consultation.asr_live_used',
      actorId: actor,
      consultationId: created.id,
    })
  }

  res.status(201).json({ consultation: await toDetailWithApprover(created) })
})

consultationsRouter.get('/:id', async (req, res) => {
  const consultation = await assertOwnedConsultation(req.params.id, doctorId(req))
  res.json({ consultation: await toDetailWithApprover(consultation) })
})

/**
 * Full audit history for one consultation, oldest first.
 *
 * NOT in docs/trd.md §13's route table — added because issue #12's acceptance
 * criterion "the full event history for a consultation is retrievable in
 * chronological order" has no route behind it otherwise. Flagged for TRD
 * ratification rather than assumed; delete it if §13 is meant to stay closed.
 *
 * Returns only what the taxonomy permits: action, actor, timestamp, and
 * metadata that is structurally incapable of holding clinical content.
 */
consultationsRouter.get('/:id/history', async (req, res) => {
  await assertOwnedConsultation(req.params.id, doctorId(req))
  res.json({ events: await getAuditHistory(req.params.id) })
})

/**
 * The analyse pipeline. Ordering here is a safety property, not a preference:
 * de-identify first, run the deterministic rules on the raw transcript
 * in-process, send only de-identified content to the model, then merge as a
 * union so a model response can never suppress a rule hit.
 *
 * Shared by the stored route below and the ephemeral one (#80) so the two
 * cannot drift. Demo Mode's claim is that it narrates the real pipeline, and
 * that claim is only worth making while there is literally one pipeline.
 *
 * It persists nothing and writes no audit row: both are the caller's job,
 * because that is exactly where the two routes legitimately differ.
 */
async function runAnalysis(
  transcript: Transcript,
  profile: ClinicalProfile,
  consultationId?: string,
): Promise<{
  analysis: ConsultationAnalysis
  detected: readonly string[]
  discardedFieldIds: readonly string[]
  suppressedSuggestionIds: readonly SuppressedSuggestionId[]
}> {
  const { text, vault, detected } = await timeStage('deidentification', () =>
    deidentifyTranscript(transcript),
  )

  // Labels and a count, never the matched values (GitHub issue #15).
  logger.info('de-identification complete', {
    ...(consultationId === undefined ? {} : { consultationId }),
    detectorLabels: detected,
    detectorCount: detected.length,
  })

  // Runs on the raw transcript, in-process, regardless of model output. It
  // never leaves the API, so it needs no gate.
  const ruleFlags = await timeStage('rules', () =>
    evaluateRedFlags(transcript, profile.redFlagTriggers),
  )

  const [noteResult, suggestionResult] = await Promise.all([
    timeStage('note_generation', () => analyseNote(text, text, profile)),
    timeStage('retrieval', () => generateSuggestions(text, profile)),
  ])

  const rehydrate = (value: string) => vault.rehydrate(value)

  /**
   * Attributes a span to the turn it came from, for the evidence trace (#10).
   *
   * Resolved by locating the rehydrated span rather than asked of the model,
   * so a link is only ever attributed to a turn that demonstrably contains it.
   * A span matching zero turns, or more than one, resolves to nothing: a
   * confidently wrong attribution on a clinical record is worse than an absent
   * one, and "which of these two turns" is not a question this can answer.
   */
  const attribute = (span: string) => {
    const needle = span.replace(/\s+/g, ' ').trim().toLowerCase()
    if (needle.length === 0) return {}
    const hits = transcript.turns.filter((turn) =>
      turn.text.replace(/\s+/g, ' ').toLowerCase().includes(needle),
    )
    const turn = hits.length === 1 ? hits[0] : undefined
    if (turn === undefined) return {}
    return {
      speaker: turn.speaker,
      ...(turn.offsetSeconds === undefined ? {} : { offsetSeconds: turn.offsetSeconds }),
    }
  }

  const analysis = {
    note: {
      subjective: rehydrate(noteResult.note.subjective),
      objective: rehydrate(noteResult.note.objective),
      assessment: rehydrate(noteResult.note.assessment),
      plan: rehydrate(noteResult.note.plan),
    },
    medicalRecordNote: {
      presentingComplaint: rehydrate(noteResult.medicalRecordNote.presentingComplaint),
      historyOfPresentingComplaint: rehydrate(
        noteResult.medicalRecordNote.historyOfPresentingComplaint,
      ),
      pastMedicalHistory: rehydrate(noteResult.medicalRecordNote.pastMedicalHistory),
      socialHistory: rehydrate(noteResult.medicalRecordNote.socialHistory),
      familyHistory: rehydrate(noteResult.medicalRecordNote.familyHistory),
      objective: rehydrate(noteResult.medicalRecordNote.objective),
      assessment: rehydrate(noteResult.medicalRecordNote.assessment),
      plan: rehydrate(noteResult.medicalRecordNote.plan),
    },
    profileId: profile.id,
    gaps: mergeGaps(
      deriveGaps(noteResult.clinicalFacts, noteResult.operational, profile.gapChecklist),
      noteResult.gaps,
    ).map((gap) => ({
      ...gap,
      question: rehydrate(gap.question),
      rationale: rehydrate(gap.rationale),
    })),
    redFlags: mergeRedFlags(ruleFlags, suggestionResult.redFlags).map((flag) => ({
      ...flag,
      label: rehydrate(flag.label),
      evidence: rehydrate(flag.evidence),
    })),
    // The reviewed checklist, surfaced rather than discarded. Without these
    // the UI cannot render a `NOT_ASSESSED` it was never sent, and docs/prd.md
    // §10's "unestablished, never absent" requirement has nothing to display
    // (Demo Script step 5).
    clinicalFacts: rehydrateAssertions(noteResult.clinicalFacts, rehydrate),
    operational: rehydrateAssertions(noteResult.operational, rehydrate),
    suggestions: suggestionResult.suggestions.map((suggestion) => ({
      ...suggestion,
      text: rehydrate(suggestion.text),
    })),
    // Carried rather than dropped. An empty `suggestions` array cannot tell the
    // reader whether the corpus had nothing to say or was never consulted, which
    // is the conflation this flag exists to prevent (docs/trd.md §19 row 7).
    outOfScope: suggestionResult.outOfScope,
    // Built from the post-evidence-check facts, so every link is a span that
    // survived §21.4 rather than one the model asserted. Checklist fields only:
    // the note is independent prose and has no traceable provenance (#10).
    evidenceLinks: buildEvidenceLinks(noteResult.clinicalFacts, noteResult.operational).map(
      (link) => {
        const evidence = rehydrate(link.evidence)
        return { ...link, evidence, ...attribute(evidence) }
      },
    ),
  }

  return {
    analysis,
    detected,
    discardedFieldIds: noteResult.discardedFieldIds,
    suppressedSuggestionIds: suggestionResult.suppressedSuggestionIds ?? [],
  }
}

consultationsRouter.post('/:id/analyze', async (req, res) => {
  const actor = doctorId(req)
  const consultation = await assertOwnedConsultation(req.params.id, actor)

  if (consultation.status === 'analyzing' || consultation.status === 'approved') {
    throw new HttpError(
      409,
      'invalid_state',
      `Analysis cannot start while the consultation is ${consultation.status}.`,
    )
  }

  const transcript = TranscriptSchema.safeParse(consultation.transcript)
  if (!transcript.success) {
    throw new HttpError(409, 'invalid_state', 'This consultation has no usable transcript.')
  }

  const profileBody = z
    .object({ profileId: ProfileIdSchema.optional() })
    .default({})
    .safeParse(req.body)
  if (!profileBody.success) {
    throw new HttpError(400, 'invalid_body', 'A valid clinical profile is required.')
  }
  const profile = getClinicalProfile(profileBody.data.profileId ?? DEFAULT_PROFILE_ID)

  const previousStatus = consultation.status
  await prisma.consultation.update({
    where: { id: consultation.id },
    data: { status: 'analyzing' },
  })
  await recordAuditEvent({
    action: 'consultation.analysis_started',
    actorId: actor,
    consultationId: consultation.id,
  })

  try {
    const { analysis, detected, discardedFieldIds, suppressedSuggestionIds } = await runAnalysis(
      transcript.data,
      profile,
      consultation.id,
    )

    /*
     * The derived title is written once and never overwritten.
     *
     * A doctor who has renamed a record has said what they want it filed as,
     * and re-analysis must not take that back. Re-analysis also regenerates
     * `analysis` wholesale, so a title that tracked it would change under the
     * doctor for reasons they did not ask for. First run names it; after that
     * the name is theirs.
     *
     * **`updateMany` with `title: null` in the where clause, rather than the
     * `consultation.title` this handler read minutes ago.** A record is
     * renameable in every state it appears in, `analyzing` included, and
     * analysis can take a couple of minutes, so a doctor renaming a row while
     * it analyses is a reachable sequence rather than a theoretical one. Testing
     * the stale read would let the derived name overwrite the one they just
     * chose. Postgres evaluates this predicate at write time, so the doctor
     * wins whenever they got there first.
     */
    const derivedTitle =
      analysis.clinicalFacts === undefined ? null : deriveConsultationTitle(analysis.clinicalFacts)

    if (derivedTitle !== null) {
      await prisma.consultation.updateMany({
        where: { id: consultation.id, title: null },
        data: { title: derivedTitle },
      })
    }

    // Reads back whatever the statement above settled on, so the response
    // carries the winning title rather than the one this request proposed.
    const updated = await timeStage('persistence', () =>
      prisma.consultation.update({
        where: { id: consultation.id },
        data: { status: 'awaiting_review', analysis },
      }),
    )

    const llm = getLLMDescriptor()
    const completionMetadata = {
      detected,
      discardedFieldIds,
      suppressedSuggestionIds,
      profileId: profile.id,
      versions: {
        provider: llm.provider,
        model: llm.model,
        clinicalContent: getActiveClinicalVersions(profile),
      },
    }
    await recordAuditEvent({
      action: 'consultation.analysis_completed',
      actorId: actor,
      consultationId: consultation.id,
      metadata: completionMetadata,
    })

    res.json({ consultation: await toDetailWithApprover(updated) })
  } catch (error) {
    // The doctor's only retry path is triggering analysis again — nothing
    // retries autonomously (docs/prd.md CAP-5).
    await prisma.consultation.update({
      where: { id: consultation.id },
      data: { status: previousStatus },
    })
    await recordAuditEvent({
      action: 'consultation.analysis_failed',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { reason: classifyFailure(error) },
    })

    throw new HttpError(500, 'analysis_failed', 'Analysis could not be completed.')
  }
})

/**
 * Bounds on a transcript that arrives in the request body (#80).
 *
 * Every other clinical route analyses a transcript the caller already stored,
 * so the create route bounded it. This one takes it directly, and
 * `TranscriptSchema` has `.min(1)` on turns and no upper bound at all, which
 * would leave `express.json({ limit: '1mb' })` as the only thing between a
 * guest session and an arbitrarily large prompt.
 *
 * Sized well above a real consultation rather than tightly: the longest
 * fixture is a few thousand characters, so these bound abuse without being
 * reachable by clinical use.
 */
const MAX_TURNS = 300
const MAX_TURN_CHARS = 4_000
const MAX_TRANSCRIPT_CHARS = 60_000

const EphemeralBodySchema = z.object({
  transcript: TranscriptSchema.superRefine((transcript, ctx) => {
    if (transcript.turns.length > MAX_TURNS) {
      ctx.addIssue({ code: 'custom', message: `A transcript may have at most ${MAX_TURNS} turns.` })
    }
    if (transcript.turns.some((turn) => turn.text.length > MAX_TURN_CHARS)) {
      ctx.addIssue({
        code: 'custom',
        message: `A turn may be at most ${MAX_TURN_CHARS} characters.`,
      })
    }
    const total = transcript.turns.reduce((sum, turn) => sum + turn.text.length, 0)
    if (total > MAX_TRANSCRIPT_CHARS) {
      ctx.addIssue({
        code: 'custom',
        message: `A transcript may be at most ${MAX_TRANSCRIPT_CHARS} characters.`,
      })
    }
  }),
  profileId: ProfileIdSchema.optional(),
})

/**
 * Demo Mode's ephemeral analysis (#80), authorised by the owner on 14/08/26.
 *
 * It runs the same pipeline as the stored route above and writes **no
 * `Consultation`**, which is the whole point: Demo Mode has to be
 * self-contained and wiped the moment it is exited, and if nothing is
 * persisted there is nothing to wipe. That sidesteps the retention decision in
 * docs/trd.md §19 rather than pre-empting it, and it avoids adding an erasure
 * endpoint to serve a demo, which would route around a control that exists for
 * audit integrity.
 *
 * **It is audited even though it persists nothing.** The endpoint cannot
 * distinguish demo content from real content, so "it is only synthetic" is a
 * property of intent rather than of the system, and an unaudited LLM egress
 * would be a hole in the property the whole PHI boundary rests on. The row
 * carries an actor and no consultation, which the hash chain already supports.
 *
 * No `:id`, so `assertOwnedConsultation` has nothing to scope. Authentication
 * still applies: `/api/consultations` is in `PROTECTED_PREFIXES`, so
 * `requireSession` runs before this. A tidier-looking `/api/analyze` would have
 * been unauthenticated by default.
 */
consultationsRouter.post('/analyze-ephemeral', async (req, res) => {
  const actor = doctorId(req)

  const body = EphemeralBodySchema.safeParse(req.body)
  if (!body.success) {
    throw new HttpError(400, 'invalid_body', 'A valid transcript is required.')
  }

  const profile = getClinicalProfile(body.data.profileId ?? DEFAULT_PROFILE_ID)

  try {
    const { analysis, detected, discardedFieldIds, suppressedSuggestionIds } = await runAnalysis(
      body.data.transcript,
      profile,
    )

    const llm = getLLMDescriptor()
    await recordAuditEvent({
      action: 'consultation.ephemeral_analyzed',
      actorId: actor,
      metadata: {
        detected,
        discardedFieldIds,
        suppressedSuggestionIds,
        profileId: profile.id,
        versions: {
          provider: llm.provider,
          model: llm.model,
          clinicalContent: getActiveClinicalVersions(profile),
        },
      },
    })

    res.json({ analysis: ConsultationAnalysisSchema.parse(analysis) })
  } catch (error) {
    await recordAuditEvent({
      action: 'consultation.ephemeral_analysis_failed',
      actorId: actor,
      metadata: { reason: classifyFailure(error) },
    })

    throw new HttpError(500, 'analysis_failed', 'Analysis could not be completed.')
  }
})

/**
 * One window of a running ambient consultation (#219).
 *
 * Bounded for a window rather than a whole consultation, which is only
 * affordable because a cycle never carries the running transcript: docs/trd.md
 * §20.8 adopts the fold over re-extraction, and `LiveAnalysisStateSchema` has
 * no field a growing transcript could travel in.
 */
const LiveDeltaSchema = TranscriptSchema.superRefine((delta, ctx) => {
  if (delta.turns.length > MAX_LIVE_DELTA_TURNS) {
    ctx.addIssue({
      code: 'custom',
      message: `A live window may have at most ${MAX_LIVE_DELTA_TURNS} turns.`,
    })
  }
  const total = delta.turns.reduce((sum, turn) => sum + turn.text.length, 0)
  if (total > MAX_LIVE_DELTA_CHARACTERS) {
    ctx.addIssue({
      code: 'custom',
      message: `A live window may be at most ${MAX_LIVE_DELTA_CHARACTERS} characters.`,
    })
  }
})

const LiveFlagsBodySchema = z.object({
  delta: LiveDeltaSchema,
  profileId: ProfileIdSchema.optional(),
})

/**
 * The deterministic live pane: rules over one window, in-process, no model.
 *
 * **It writes nothing and audits nothing**, and both are deliberate. Nothing
 * egresses and no state changes, so there is no act to record; the precedent is
 * `GET /api/asr/live-sessions/config`, which writes no row for the same reason.
 * The authoritative run is still `evaluateRedFlags` over the whole stored
 * transcript at Finish, which is persisted and audited. This pass is additive
 * and advisory: it can raise a flag earlier than Finish would, and it can never
 * remove one.
 *
 * `labelsReviewed` is forced to `false` rather than read from the body, and
 * that is a hardening rather than a formality. On a live path nobody has
 * reviewed a speaker label yet, and the field can only ever *weaken* the
 * engine: `asserts()` (`redflags/triggers.ts`) enables the question-denial
 * suppression only when it is `true`. A client asserting `true` here could
 * therefore suppress a real trigger, so the value is not the client's to send.
 */
consultationsRouter.post('/:id/live-flags', async (req, res) => {
  const actor = doctorId(req)
  await assertOwnedConsultation(req.params.id, actor)

  const body = LiveFlagsBodySchema.safeParse(req.body)
  if (!body.success) {
    throw new HttpError(400, 'invalid_body', 'A valid live transcript window is required.')
  }

  const profile = getClinicalProfile(body.data.profileId ?? DEFAULT_PROFILE_ID)

  const redFlags = evaluateRedFlags(
    /*
     * Both fields are the server's, not the caller's, and for the same reason:
     * each is a lever that can only ever *weaken* the engine on a window the
     * client composed entirely.
     *
     * `labelsReviewed` gates the question-denial suppression in `asserts()`.
     * `source` gates `isRecorded` in `redflags/mishears.ts`, so a client
     * sending anything else silently loses the measured Malay confusables
     * ("patuk berdarah", "sempuk") that exist for exactly this transcript
     * source. This route is only ever reached from ambient capture.
     */
    { ...body.data.delta, source: 'asr_live', labelsReviewed: false },
    profile.redFlagTriggers,
  )

  res.json(LiveFlagsResponseSchema.parse({ redFlags }))
})

const LiveAnalysisBodySchema = z.object({
  delta: LiveDeltaSchema,
  /** The previous cycle's result, handed straight back. `null` opens a session. */
  previous: LiveAnalysisStateSchema.nullable(),
  profileId: ProfileIdSchema.optional(),
})

/**
 * The model-backed live panes: the patient card and the missing-information
 * checklist, folded one window at a time (#219).
 *
 * **The ordering is `runAnalysis`'s, and for the same reason.** De-identify
 * first, then reach the model with de-identified content only. This route is an
 * ordinary LLM egress through `LLMClient` and gets no dispensation for being
 * live: a window of transcript is exactly as identifying as a whole one.
 *
 * **It persists nothing.** No `Consultation` column is written and `status` is
 * untouched, so a live cycle cannot move a record's lifecycle or leave a draft
 * behind. Precedent: `POST /analyze-ephemeral`, which runs the same pipeline
 * and writes no row.
 *
 * The authoritative analysis is still the one at Finish. This pass may only
 * fill the two panes ahead of it.
 */
consultationsRouter.post('/:id/live-analysis', async (req, res) => {
  const actor = doctorId(req)
  const consultation = await assertOwnedConsultation(req.params.id, actor)

  const body = LiveAnalysisBodySchema.safeParse(req.body)
  if (!body.success) {
    throw new HttpError(400, 'invalid_body', 'A valid live transcript window is required.')
  }

  const { delta, previous } = body.data
  const profile = getClinicalProfile(body.data.profileId ?? DEFAULT_PROFILE_ID)

  try {
    const { text, vault, detected } = deidentifyTranscript(delta)

    // Labels and a count, never the matched values (GitHub issue #15).
    logger.info('de-identification complete', {
      consultationId: consultation.id,
      detectorLabels: detected,
      detectorCount: detected.length,
    })

    /*
     * Written once per consultation, before the egress it records, and the
     * decision is the server's rather than the caller's.
     *
     * The first version gated this on `previous === null`, which meant a client
     * that fabricated a previous state on its opening request could spend the
     * whole model budget with no `live_analysis_started` row against the
     * consultation. That is not the shape of the precedent it cited:
     * `asr.live_session_minted` is written unconditionally at the only moment
     * issuance can happen, which is what makes "an egress the trail did not
     * record is never observable by a client" true there.
     *
     * Session-scoping is still right, for the chain-contention reason in
     * `audit/index.ts`. Reading the session boundary off the request body was
     * not. One indexed lookup on `[consultationId, createdAt]`, on the
     * model-backed route only, which its own limiter caps at 20/min.
     */
    const opened = await prisma.auditEvent.findFirst({
      where: {
        consultationId: consultation.id,
        action: 'consultation.live_analysis_started',
      },
      select: { id: true },
    })

    if (opened === null) {
      const llm = getLLMDescriptor()
      await recordAuditEvent({
        action: 'consultation.live_analysis_started',
        actorId: actor,
        consultationId: consultation.id,
        metadata: {
          profileId: profile.id,
          versions: {
            provider: llm.provider,
            model: llm.model,
            clinicalContent: getActiveClinicalVersions(profile),
          },
        },
      })
    }

    const checked = await analyseLiveWindow(text, text, profile)
    const rehydrate = (value: string) => vault.rehydrate(value)

    /*
     * Rehydrated before the fold, so the previous cycle's plain values and this
     * one's are the same kind of string. Folding tokenised text into rehydrated
     * text would leave `[PATIENT_1]` on screen the moment a field carried over.
     */
    const clinicalFacts = foldFacts(
      previous?.clinicalFacts ?? null,
      rehydrateAssertions(checked.clinicalFacts, rehydrate),
    )
    // Not `foldFacts`: this block holds the clinical conclusion, where holding
    // an established value is the unsafe direction. See `foldOperational`.
    const operational = foldOperational(
      previous?.operational ?? null,
      rehydrateAssertions(checked.operational, rehydrate),
    )

    // Deterministic, over the merged facts. The model is never asked what is
    // missing; see `deriveGaps` and docs/trd.md §20.8.1.
    const gaps = deriveGaps(clinicalFacts, operational, profile.gapChecklist).map((gap) => ({
      ...gap,
      question: rehydrate(gap.question),
      rationale: rehydrate(gap.rationale),
    }))

    res.json(
      LiveAnalysisResponseSchema.parse({
        state: { cycle: (previous?.cycle ?? 0) + 1, clinicalFacts, operational },
        gaps,
        discardedFieldIds: checked.discardedFieldIds,
      }),
    )
  } catch (error) {
    await recordAuditEvent({
      action: 'consultation.live_analysis_failed',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { reason: classifyFailure(error) },
    })

    if (error instanceof DeidentificationError) {
      throw new HttpError(500, 'deid_failed', 'De-identification could not be completed.')
    }
    throw new HttpError(500, 'analysis_failed', 'Live analysis could not be completed.')
  }
})

const PatchBodySchema = z
  .object({
    /*
     * Renaming stays available after approval, and that is a decision rather
     * than an oversight.
     *
     * `approved` is terminal and no clinical content may change after it. A
     * filing label is not clinical content: it is how the record is found
     * later, and an approved consultation is precisely the one somebody will
     * need to find. Locking it would make the archive unsearchable at exactly
     * the moment it starts being an archive. The note, the flags and the
     * dispositions remain immutable, and every rename writes an audit event, so
     * the change is attributable.
     */
    title: ConsultationTitleSchema.optional(),
    /*
     * Captured into the record after it exists, which is what lets the capture
     * panel live on the consultation screen rather than on a page of its own.
     *
     * Gated to `draft` below, and deliberately not folded into the
     * `awaiting_review` gate the clinical fields use: those two states protect
     * opposite things. A transcript may only be set *before* anything has been
     * derived from it, because every finding, gap and evidence span is anchored
     * to it — replacing it afterwards would leave an analysis attributed to
     * words nobody said.
     */
    transcript: TranscriptSchema.optional(),
    editedNote: SoapNoteSchema.partial().optional(),
    editedMedicalRecordNote: MedicalRecordNoteSchema.partial().optional(),
    noteTemplate: NoteTemplateSchema.optional(),
    captureMode: CaptureModeSchema.optional(),
    acknowledgedRedFlagIds: z.array(z.string()).optional(),
    reviewedGapIds: z.array(z.string()).optional(),
    redFlagDispositions: z.array(DispositionInputSchema).optional(),
    gapDispositions: z.array(DispositionInputSchema).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' })
  /*
   * Capture is patched on its own, because it returns early below. Accepting a
   * transcript alongside a clinical field would take the capture branch and
   * silently drop the rest, which is worse than refusing the request.
   */
  .refine((body) => body.transcript === undefined || Object.keys(body).length === 1, {
    message: 'transcript must be patched on its own',
  })
  .refine((body) => body.editedNote === undefined || body.editedMedicalRecordNote === undefined, {
    message: 'supply one note edit representation at a time',
  })

/**
 * Applies decisions onto the stored set, last decision per id winning.
 *
 * A doctor revising a judgement is legitimate, so this is not append-only the
 * way `acknowledgedRedFlagIds` is. The invariant that column protects is
 * untouched by that: the red flag itself still lives in `analysis` and is never
 * removed or downgraded here, and every change writes an `AuditEvent`, so the
 * history of a reversal survives even though only the current state is stored.
 */
function applyDispositions(
  stored: Prisma.JsonValue | null,
  incoming: DispositionInput[],
  decidedAt: Date,
) {
  const next = new Map(
    ((stored as Disposition[] | null) ?? []).map((entry) => [entry.id, entry] as const),
  )
  for (const decision of incoming) {
    next.set(decision.id, { ...decision, decidedAt })
  }
  return [...next.values()]
}

consultationsRouter.patch('/:id', async (req, res) => {
  const actor = doctorId(req)
  const consultation = await assertOwnedConsultation(req.params.id, actor)

  const parsed = PatchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'No valid changes supplied.')
  }
  const patch = parsed.data

  /*
   * The state gate applies to clinical content, and a filing name is not
   * clinical content.
   *
   * A rename carries no note text, no finding and no disposition, so nothing it
   * can change is part of the record `approved` freezes. Letting it through is
   * what keeps an archive searchable, since the consultations somebody needs to
   * find later are exactly the signed ones. Any patch touching anything else
   * still meets the original gate unchanged, and a mixed patch is judged by the
   * clinical half rather than excused by the title.
   */
  const presentationOnly = Object.keys(patch).every(
    (key) => key === 'title' || key === 'noteTemplate' || key === 'captureMode',
  )

  if (patch.captureMode !== undefined && consultation.transcript !== null) {
    throw new HttpError(409, 'invalid_state', 'Capture Mode is locked after transcript capture.')
  }

  /*
   * Capture has the opposite gate to every other field: a transcript may only
   * be set while the record is still `draft`, because everything downstream is
   * anchored to it. It is checked before the clinical gate rather than beside
   * it, so a transcript patch is never excused by a state that exists to
   * protect derived content.
   */
  if (patch.transcript !== undefined) {
    if (consultation.status !== 'draft') {
      throw new HttpError(
        409,
        'invalid_state',
        'The transcript can only be set before the consultation is analysed.',
      )
    }
    const captured = await prisma.consultation.update({
      where: { id: consultation.id },
      data: { transcript: patch.transcript },
    })
    await recordAuditEvent({
      action: 'consultation.edited',
      actorId: actor,
      consultationId: consultation.id,
    })
    /*
     * Recorded here as well as on create, because capture moved: a hosted
     * transcript now usually arrives by this route rather than with the row.
     * Losing the fact on the path that became the common one would have made
     * the audit trail quietly stop answering which consultations used a hosted
     * relay (docs/trd.md §15).
     */
    if (patch.transcript.source === 'asr_hosted') {
      await recordAuditEvent({
        action: 'consultation.asr_hosted_used',
        actorId: actor,
        consultationId: consultation.id,
      })
    }
    if (patch.transcript.source === 'asr_live') {
      await recordAuditEvent({
        action: 'consultation.asr_live_used',
        actorId: actor,
        consultationId: consultation.id,
      })
    }
    res.json({ consultation: await toDetailWithApprover(captured) })
    return
  }

  if (!presentationOnly && consultation.status !== 'awaiting_review') {
    throw new HttpError(
      409,
      'invalid_state',
      consultation.status === 'approved'
        ? 'An approved consultation is final and cannot be edited.'
        : 'This consultation is not open for review.',
    )
  }

  /**
   * The PATCH body is a `Partial<SoapNote>`, but `editedNote` on the wire is a
   * complete `SoapNote` — so a partial edit has to land on a complete base.
   * That base is the doctor's existing copy, or the AI's note the first time
   * they touch it. Merging onto `{}` instead would persist a half-note that
   * fails validation on the way back out.
   *
   * `analysis.note` is only ever *read* here. The AI's original output is
   * never written to, so the two stay independently inspectable.
   */
  let nextEditedNote: SoapNote | undefined
  let nextEditedMedicalRecordNote: MedicalRecordNote | undefined
  if (patch.editedMedicalRecordNote !== undefined) {
    const base =
      consultation.editedMedicalRecordNote ??
      (consultation.analysis as { medicalRecordNote?: unknown } | null)?.medicalRecordNote ??
      null
    const merged = MedicalRecordNoteSchema.safeParse({
      ...(base as Record<string, unknown> | null),
      ...patch.editedMedicalRecordNote,
    })
    if (!merged.success) {
      throw new HttpError(
        409,
        'invalid_state',
        'This consultation has no categorized note to edit yet.',
      )
    }
    nextEditedMedicalRecordNote = merged.data
    nextEditedNote = toSoapNote(merged.data)
  }
  if (patch.editedNote !== undefined) {
    const storedAnalysis = ConsultationAnalysisSchema.safeParse(consultation.analysis)
    if (storedAnalysis.success && storedAnalysis.data.medicalRecordNote !== undefined) {
      throw new HttpError(409, 'invalid_state', 'This categorized note must be edited by category.')
    }
    const base =
      consultation.editedNote ?? (consultation.analysis as { note?: unknown } | null)?.note ?? null
    const merged = SoapNoteSchema.safeParse({
      ...(base as Record<string, unknown> | null),
      ...patch.editedNote,
    })
    if (!merged.success) {
      throw new HttpError(409, 'invalid_state', 'This consultation has no note to edit yet.')
    }
    nextEditedNote = merged.data
  }

  // Acknowledgment is additive: a red flag can be acknowledged, never removed,
  // and the AI's own output in `analysis` is never overwritten by an edit.
  const previousFlags = new Set((consultation.acknowledgedRedFlagIds as string[] | null) ?? [])
  const previousGaps = new Set((consultation.reviewedGapIds as string[] | null) ?? [])
  const newFlags = (patch.acknowledgedRedFlagIds ?? []).filter((id) => !previousFlags.has(id))
  const newGaps = (patch.reviewedGapIds ?? []).filter((id) => !previousGaps.has(id))

  /*
   * A decision is only an event when it changes something. Re-sending the same
   * state on an unrelated patch would otherwise fill the audit trail with
   * restatements and bury the reversals, which are the entries anyone reading
   * this back actually cares about.
   */
  const decidedAt = new Date()
  const priorFlagState = new Map(
    ((consultation.redFlagDispositions as Disposition[] | null) ?? []).map(
      (entry) => [entry.id, entry] as const,
    ),
  )
  const priorGapState = new Map(
    ((consultation.gapDispositions as Disposition[] | null) ?? []).map(
      (entry) => [entry.id, entry] as const,
    ),
  )
  const changed = (prior: Map<string, Disposition>, decision: DispositionInput) => {
    const before = prior.get(decision.id)
    return before?.state !== decision.state || before?.reason !== decision.reason
  }
  const flagDecisions = (patch.redFlagDispositions ?? []).filter((d) => changed(priorFlagState, d))
  const gapDecisions = (patch.gapDispositions ?? []).filter((d) => changed(priorGapState, d))

  const updated = await prisma.consultation.update({
    where: { id: consultation.id },
    data: {
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.noteTemplate === undefined ? {} : { noteTemplate: patch.noteTemplate }),
      ...(patch.captureMode === undefined ? {} : { captureMode: patch.captureMode }),
      ...(nextEditedNote === undefined ? {} : { editedNote: nextEditedNote }),
      ...(nextEditedMedicalRecordNote === undefined
        ? {}
        : { editedMedicalRecordNote: nextEditedMedicalRecordNote }),
      ...(patch.acknowledgedRedFlagIds === undefined
        ? {}
        : { acknowledgedRedFlagIds: [...previousFlags, ...newFlags] }),
      ...(patch.reviewedGapIds === undefined
        ? {}
        : { reviewedGapIds: [...previousGaps, ...newGaps] }),
      ...(patch.redFlagDispositions === undefined
        ? {}
        : {
            redFlagDispositions: applyDispositions(
              consultation.redFlagDispositions,
              patch.redFlagDispositions,
              decidedAt,
            ),
          }),
      ...(patch.gapDispositions === undefined
        ? {}
        : {
            gapDispositions: applyDispositions(
              consultation.gapDispositions,
              patch.gapDispositions,
              decidedAt,
            ),
          }),
    },
  })

  if (patch.title !== undefined) {
    await recordAuditEvent({
      action: 'consultation.renamed',
      actorId: actor,
      consultationId: consultation.id,
    })
  }
  if (patch.editedNote !== undefined) {
    await recordAuditEvent({
      action: 'consultation.edited',
      actorId: actor,
      consultationId: consultation.id,
    })
  }
  if (patch.editedMedicalRecordNote !== undefined) {
    await recordAuditEvent({
      action: 'consultation.edited',
      actorId: actor,
      consultationId: consultation.id,
    })
  }
  if (patch.noteTemplate !== undefined) {
    await recordAuditEvent({
      action: 'consultation.template_selected',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { template: patch.noteTemplate },
    })
  }
  for (const redFlagId of newFlags) {
    await recordAuditEvent({
      action: 'redflag.acknowledged',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { redFlagId },
    })
  }
  for (const gapId of newGaps) {
    await recordAuditEvent({
      action: 'gap.reviewed',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { gapId },
    })
  }

  /*
   * The decision is audited; the reason text is not.
   *
   * A dismissal reason is clinician free text about a specific patient, so it
   * is clinical content and falls under the same rule as note bodies and
   * transcripts: ids and event types only. It is stored once, on the
   * consultation, which is the clinical record and the right home for it.
   * Copying it into `AuditEvent` would put unredacted clinical prose in a
   * second table whose whole purpose is to be widely readable for verification.
   */
  for (const decision of flagDecisions) {
    await recordAuditEvent({
      action: 'redflag.disposition_set',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { redFlagId: decision.id, state: decision.state },
    })
  }
  for (const decision of gapDecisions) {
    await recordAuditEvent({
      action: 'gap.disposition_set',
      actorId: actor,
      consultationId: consultation.id,
      metadata: { gapId: decision.id, state: decision.state },
    })
  }

  res.json({ consultation: await toDetailWithApprover(updated) })
})

consultationsRouter.post('/:id/approve', async (req, res) => {
  const actor = doctorId(req)
  const consultation = await assertOwnedConsultation(req.params.id, actor)

  if (consultation.status !== 'awaiting_review') {
    throw new HttpError(
      409,
      'invalid_state',
      consultation.status === 'approved'
        ? 'This consultation is already approved.'
        : 'Only a consultation awaiting review can be approved.',
    )
  }

  // CAP-5: approval is an explicit transition over reviewed AI output. There is
  // nothing to take responsibility for without an analysis attached.
  if (consultation.analysis === null) {
    throw new HttpError(409, 'invalid_state', 'This consultation has no analysis to approve.')
  }

  const updated = await prisma.consultation.update({
    where: { id: consultation.id },
    data: { status: 'approved', approvedAt: new Date() },
  })

  await recordAuditEvent({
    action: 'consultation.approved',
    actorId: actor,
    consultationId: consultation.id,
  })

  res.json({ consultation: await toDetailWithApprover(updated) })
})

/**
 * Erases a selection of consultations (issue #114).
 *
 * **This is a tombstone, not a delete, and the distinction is load-bearing.**
 * `eraseConsultation` nulls the three PHI columns and stamps `erasedAt`; the
 * row itself stays, because `AuditEvent.consultationId` is `onDelete: Restrict`
 * and is a hash-chain input. Removing the row would orphan every audit event
 * that references it and break tamper evidence, which is the one property the
 * chain exists to provide. `.claude/rules/security.md` states that as a
 * do-not-change; this route is the caller it was waiting for, not a relaxation
 * of it.
 *
 * Any status may be erased, approved included. The DPIA frames erasure as
 * serving a data-subject right, and that right does not stop applying because a
 * doctor signed the note, so the weight of erasing an approved record is
 * carried by the confirmation in the UI, which counts them, rather than by a
 * block here.
 *
 * A collection-level POST rather than `DELETE /:id`, because one gesture should
 * cost one rate-limit token rather than N, and because the ordering below has
 * to be decided server-side.
 */
consultationsRouter.post('/erase', async (req, res) => {
  const parsed = EraseConsultationsInputSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_body',
      `Supply between 1 and ${ERASE_BATCH_LIMIT} consultation ids to erase.`,
    )
  }

  const actor = doctorId(req)
  const erased: string[] = []
  const failed: string[] = []

  // Sequential, deliberately. Each erasure appends an audit row, and `prevHash`
  // is unique so that two concurrent appends cannot fork the chain;
  // `recordAuditEvent` retries a head race only three times, so a `Promise.all`
  // over a selection this size would exhaust that and fail rows for a reason
  // that has nothing to do with the request.
  for (const id of parsed.data.ids) {
    try {
      await eraseConsultation(id, actor)
      erased.push(id)
    } catch (error) {
      // The ownership gate's 404 is the expected miss: not this doctor's, or
      // already erased. Neither justifies abandoning the rest of the batch.
      // Anything else is a real fault and must not be flattened into a tidy
      // per-id failure that the client would render as a routine skip.
      if (!(error instanceof HttpError && error.status === 404)) throw error
      failed.push(id)
    }
  }

  res.json({ erased, failed })
})
