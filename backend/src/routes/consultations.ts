import type { Consultation } from '@prisma/client'
import {
  ConsultationDetailSchema,
  ConsultationListItemSchema,
  type InformationGap,
  type SoapNote,
  SoapNoteSchema,
  TranscriptSchema,
} from '@shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { analyseNote } from '../analysis/index.js'
import { type AnalysisFailureReason, getAuditHistory, recordAuditEvent } from '../audit/index.js'
import {
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
function doctorId(req: { doctorId?: string }): string {
  if (!req.doctorId) throw new HttpError(401, 'unauthenticated', 'Authentication required.')
  return req.doctorId
}

/**
 * Maps a persisted row onto the wire contract, validating on the way out — the
 * JSON columns are `Json?` to Prisma, so this is the only place their shape is
 * actually checked.
 */
function toDetail(row: Consultation) {
  return ConsultationDetailSchema.parse({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    transcript: row.transcript ?? null,
    analysis: row.analysis ?? null,
    editedNote: row.editedNote ?? null,
    approvedAt: row.approvedAt,
    acknowledgedRedFlagIds: row.acknowledgedRedFlagIds ?? [],
    reviewedGapIds: row.reviewedGapIds ?? [],
  })
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
    select: { id: true, status: true, createdAt: true, updatedAt: true },
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

  res.status(201).json({ consultation: toDetail(created) })
})

consultationsRouter.get('/:id', async (req, res) => {
  const consultation = await assertOwnedConsultation(req.params.id, doctorId(req))
  res.json({ consultation: toDetail(consultation) })
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
 */
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
    const { text, vault, detected } = await timeStage('deidentification', () =>
      deidentifyTranscript(transcript.data),
    )

    // Labels and a count, never the matched values (GitHub issue #15).
    logger.info('de-identification complete', {
      consultationId: consultation.id,
      detectorLabels: detected,
      detectorCount: detected.length,
    })

    // Runs on the raw transcript, in-process, regardless of model output. It
    // never leaves the API, so it needs no gate.
    const ruleFlags = await timeStage('rules', () =>
      evaluateRedFlags(transcript.data, profile.redFlagTriggers),
    )

    const [noteResult, suggestionResult] = await Promise.all([
      timeStage('note_generation', () => analyseNote(text, text, profile)),
      timeStage('retrieval', () => generateSuggestions(text, profile)),
    ])

    const rehydrate = (value: string) => vault.rehydrate(value)

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
    }

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
        discardedFieldIds: noteResult.discardedFieldIds,
        profileId: profile.id,
        versions: {
          provider: llm.provider,
          model: llm.model,
          clinicalContent: getActiveClinicalVersions(profile),
        },
      },
    })

    res.json({ consultation: toDetail(updated) })
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

const PatchBodySchema = z
  .object({
    editedNote: SoapNoteSchema.partial().optional(),
    acknowledgedRedFlagIds: z.array(z.string()).optional(),
    reviewedGapIds: z.array(z.string()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' })

consultationsRouter.patch('/:id', async (req, res) => {
  const actor = doctorId(req)
  const consultation = await assertOwnedConsultation(req.params.id, actor)

  if (consultation.status !== 'awaiting_review') {
    throw new HttpError(
      409,
      'invalid_state',
      consultation.status === 'approved'
        ? 'An approved consultation is final and cannot be edited.'
        : 'This consultation is not open for review.',
    )
  }

  const parsed = PatchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'No valid changes supplied.')
  }
  const patch = parsed.data

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

  const updated = await prisma.consultation.update({
    where: { id: consultation.id },
    data: {
      ...(nextEditedNote === undefined ? {} : { editedNote: nextEditedNote }),
      ...(patch.acknowledgedRedFlagIds === undefined
        ? {}
        : { acknowledgedRedFlagIds: [...previousFlags, ...newFlags] }),
      ...(patch.reviewedGapIds === undefined
        ? {}
        : { reviewedGapIds: [...previousGaps, ...newGaps] }),
    },
  })

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

  res.json({ consultation: toDetail(updated) })
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

  res.json({ consultation: toDetail(updated) })
})
