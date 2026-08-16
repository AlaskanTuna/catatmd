import type { Consultation, Prisma } from '@prisma/client'
import {
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
  type SoapNote,
  SoapNoteSchema,
  type Transcript,
  TranscriptSchema,
} from '@shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { analyseNote, buildEvidenceLinks } from '../analysis/index.js'
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
import { assertOwnedConsultation } from '../lib/authz.js'
import { HttpError } from '../lib/http-error.js'
import { getLLMDescriptor, LLMResponseError } from '../lib/llm/index.js'
import { logger, timeStage } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { evaluateRedFlags, mergeRedFlags } from '../redflags/index.js'
import { generateSuggestions } from '../suggestions/index.js'

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

function toDetail(row: Consultation, approvedBy: string | null = null) {
  return ConsultationDetailSchema.parse({
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
    approvedAt: row.approvedAt,
    approvedBy,
    acknowledgedRedFlagIds: row.acknowledgedRedFlagIds ?? [],
    reviewedGapIds: row.reviewedGapIds ?? [],
    redFlagDispositions: dispositionsFor(
      row.redFlagDispositions,
      row.acknowledgedRedFlagIds,
      row.updatedAt,
    ),
    gapDispositions: dispositionsFor(row.gapDispositions, row.reviewedGapIds, row.updatedAt),
  })
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
  if (row.approvedAt === null) return toDetail(row)
  const doctor = await prisma.user.findUnique({
    where: { id: row.doctorId },
    select: { name: true },
  })
  return toDetail(row, doctor?.name ?? null)
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

const CreateBodySchema = z.object({ transcript: TranscriptSchema })

consultationsRouter.post('/', async (req, res) => {
  const parsed = CreateBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'A valid transcript is required.')
  }

  const actor = doctorId(req)
  const created = await prisma.consultation.create({
    data: { doctorId: actor, status: 'draft', transcript: parsed.data.transcript },
  })

  await recordAuditEvent({
    action: 'consultation.created',
    actorId: actor,
    consultationId: created.id,
  })

  // A client-asserted fact, recorded at the first point the transcript source
  // and a consultation id coexist (docs/trd.md §15).
  if (parsed.data.transcript.source === 'asr_hosted') {
    await recordAuditEvent({
      action: 'consultation.asr_hosted_used',
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

  return { analysis, detected, discardedFieldIds: noteResult.discardedFieldIds }
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
    const { analysis, detected, discardedFieldIds } = await runAnalysis(
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
    await recordAuditEvent({
      action: 'consultation.analysis_completed',
      actorId: actor,
      consultationId: consultation.id,
      metadata: {
        detected,
        discardedFieldIds,
        profileId: profile.id,
        versions: {
          provider: llm.provider,
          model: llm.model,
          clinicalContent: getActiveClinicalVersions(profile),
        },
      },
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
    const { analysis, detected, discardedFieldIds } = await runAnalysis(
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
    editedNote: SoapNoteSchema.partial().optional(),
    acknowledgedRedFlagIds: z.array(z.string()).optional(),
    reviewedGapIds: z.array(z.string()).optional(),
    redFlagDispositions: z.array(DispositionInputSchema).optional(),
    gapDispositions: z.array(DispositionInputSchema).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' })

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
  const titleOnly = patch.title !== undefined && Object.keys(patch).length === 1

  if (!titleOnly && consultation.status !== 'awaiting_review') {
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
  if (patch.editedNote !== undefined) {
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
      ...(nextEditedNote === undefined ? {} : { editedNote: nextEditedNote }),
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
