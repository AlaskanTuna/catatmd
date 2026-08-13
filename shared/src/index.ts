import { z } from 'zod'

/**
 * Contracts shared by backend and frontend. Zod schemas are the source of
 * truth; types are always inferred, never hand-written alongside them.
 *
 * Scope is deliberately narrow (see AGENTS.md): adult GP consultations for
 * acute cough, sore throat, and other upper respiratory symptoms.
 */

// ─── Transcript ───────────────────────────────────────────────────────────────

export const SpeakerSchema = z.enum(['doctor', 'patient'])

export const TranscriptTurnSchema = z.object({
  speaker: SpeakerSchema,
  text: z.string().min(1),
  /** Seconds from consultation start, when the source provides timing. */
  offsetSeconds: z.number().nonnegative().optional(),
})

/**
 * How the transcript was produced. Client-asserted and unverifiable by the API
 * (both ASR paths run in the browser), so it is an honest provenance record for
 * a cooperating client, never a security control — nothing in the safety
 * architecture rests on it. See docs/trd.md §3.
 *
 * `asr_hosted` is the only path on which audio leaves the doctor's device.
 */
export const TranscriptSourceSchema = z.enum([
  'fixture',
  'paste',
  'upload',
  'asr_local',
  'asr_hosted',
])

export const TranscriptSchema = z.object({
  source: TranscriptSourceSchema,
  turns: z.array(TranscriptTurnSchema).min(1),
})

// ─── Structured clinical note (SOAP) ─────────────────────────────────────────

export const SoapNoteSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
})

// ─── Per-field clinical assertion ────────────────────────────────────────────

/**
 * Six explicit states, so a fact the consultation never established can never
 * be represented as denied. See docs/prd.md §10 (Unknown ≠ Negative) — the
 * absolute half of that rule, measured failing in 5 of 5 runs without it
 * (docs/trd.md §21.1).
 */
export const AssertionStateSchema = z.enum([
  'PRESENT',
  'DENIED',
  'CLINICIAN_OBSERVED',
  'NOT_ASSESSED',
  'UNKNOWN',
  'NOT_APPLICABLE',
])

const EVIDENCE_REQUIRED_STATES: ReadonlySet<z.infer<typeof AssertionStateSchema>> = new Set([
  'PRESENT',
  'DENIED',
])

const ClinicalAssertionShape = z.object({
  state: AssertionStateSchema,
  /** Normalised concept label. Paraphrase permitted. */
  value: z.string().optional(),
  /** Verbatim span from the de-identified transcript. */
  evidence: z.string().optional(),
})

/**
 * What the model is permitted to emit. Deliberately *not* refined.
 *
 * The evidence rule cannot live at the decoding boundary: measured against
 * qwen-flash on 13/08/26, the model emits `{ state: 'DENIED', value: 'no
 * fever' }` with no span. Enforcing the rule in `safeParse` would throw
 * `LLMResponseError` and the doctor would get nothing at all. docs/trd.md §21.4
 * specifies the opposite behaviour — the check runs *after* `safeParse` and
 * downgrades the individual fact to `NOT_ASSESSED`, so one unsupported
 * assertion costs one gap prompt rather than the whole analysis.
 */
export const LlmClinicalAssertionSchema = ClinicalAssertionShape

/**
 * The persisted and API-facing contract, applied *after* the §21.4 evidence
 * check has run. By that point every surviving `PRESENT`/`DENIED` carries a
 * span, so this schema is the loud backstop: a bug that lets an evidence-less
 * `DENIED` through fails here rather than reaching a doctor.
 *
 * `NOT_ASSESSED` is the cheapest path by construction — `{ state:
 * 'NOT_ASSESSED' }` is a complete, valid assertion costing no further tokens,
 * and nothing here implicitly requires a field to be filled.
 *
 * The span requirement binds `state`, not `value` (docs/trd.md §21.4):
 * `value` may carry a normalised concept label. Scoping it to vocabulary
 * instead would force `NOT_ASSESSED` onto legitimate paraphrase.
 */
export const ClinicalAssertionSchema = ClinicalAssertionShape.refine(
  (a) => !EVIDENCE_REQUIRED_STATES.has(a.state) || (a.evidence?.trim().length ?? 0) > 0,
  {
    path: ['evidence'],
    message: 'PRESENT and DENIED each require a verbatim transcript span',
  },
)

/**
 * A fixed key set, not a model-chosen one. docs/prd.md §10 requires that a
 * field the transcript never touches is never defaulted to `DENIED` *or
 * silently omitted* — only a fixed key set can guarantee the second half, and
 * it is what lets gaps be derived deterministically in code (a Tier-2 control)
 * rather than asked of the model.
 *
 * Keys are taken verbatim from the completeness checklist in docs/prd.md §9
 * (CAP-2). docs/trd.md §12 deferred this shape; this is it. One key list feeds
 * both the permissive decoding schema and the strict persistence schema, so
 * the two cannot drift.
 */
const buildClinicalFacts = <T extends z.ZodType>(field: T) =>
  z.object({
    symptoms: z.object({
      cough: field,
      coughDuration: field,
      sputumProduction: field,
      sputumCharacteristics: field,
      haemoptysis: field,
      soreThroat: field,
      fever: field,
      dyspnoea: field,
      chestPain: field,
      swallowingDifficulty: field,
      oralIntake: field,
      onsetAndProgression: field,
    }),
    history: z.object({
      asthma: field,
      copd: field,
      cardiacDisease: field,
      immunosuppression: field,
      smoking: field,
      recentInfectionExposure: field,
      currentMedications: field,
      drugAllergies: field,
    }),
    observations: z.object({
      temperature: field,
      heartRate: field,
      respiratoryRate: field,
      bloodPressure: field,
      oxygenSaturation: field,
    }),
    examination: z.object({
      throat: field,
      tonsillar: field,
      cervicalLymphNodes: field,
      chest: field,
    }),
  })

export const ClinicalFactsSchema = buildClinicalFacts(
  ClinicalAssertionSchema.default({ state: 'NOT_ASSESSED' }),
)

export const LlmClinicalFactsSchema = buildClinicalFacts(
  LlmClinicalAssertionSchema.default({ state: 'NOT_ASSESSED' }),
)

// ─── Malaysian operational block ─────────────────────────────────────────────

/**
 * The payer-enforced record schema — condition → treatment → itemised
 * medication dispensed → MC days → referral (docs/prd.md §1). Two of those
 * fields have no home in SOAP, so a SOAP-only note is incomplete against the
 * contract the clinic signed.
 *
 * Every field here is extraction, never generation. `diagnosis` carries the
 * stricter constraint: it records only an impression the doctor stated, and
 * absent that span it resolves to `NOT_ASSESSED`. The system may not produce a
 * diagnosis the doctor did not say (docs/prd.md §10).
 */
const buildOperationalBlock = <T extends z.ZodType>(field: T) =>
  z.object({
    diagnosis: field,
    medicationsDispensed: z.array(field).default([]),
    mcDays: field,
    referral: field,
    followUp: field,
  })

export const OperationalBlockSchema = buildOperationalBlock(
  ClinicalAssertionSchema.default({ state: 'NOT_ASSESSED' }),
)

export const LlmOperationalBlockSchema = buildOperationalBlock(
  LlmClinicalAssertionSchema.default({ state: 'NOT_ASSESSED' }),
)

// ─── Missing clinical information ────────────────────────────────────────────

export const InformationGapSchema = z.object({
  id: z.string(),
  /** What the doctor did not establish, phrased as a prompt to ask. */
  question: z.string(),
  /** Why it matters for this presentation — shown to justify the prompt. */
  rationale: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
})

// ─── Red flags / escalation triggers ─────────────────────────────────────────

/**
 * `source` is load-bearing. `rule` hits come from the deterministic engine and
 * may never be suppressed or downgraded by the model; `model` hits are
 * candidates the doctor reviews. See AGENTS.md, clinical-safety do-nots.
 */
export const RedFlagSchema = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(['emergency', 'urgent', 'advisory']),
  /** The transcript evidence that triggered it. */
  evidence: z.string(),
  source: z.enum(['rule', 'model']),
  /** Identifier of the rule that fired, when source is `rule`. */
  ruleId: z.string().optional(),
})

// ─── Citations ───────────────────────────────────────────────────────────────

/**
 * The model may only cite guideline IDs supplied to it from the corpus.
 * Free-text references fail validation — hallucinated references are
 * structurally impossible rather than merely unlikely.
 */
export const CitationSchema = z.object({
  guidelineId: z.string(),
  /** Optional verbatim span from the cited guideline. */
  quote: z.string().optional(),
})

export const ClinicalSuggestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  citations: z.array(CitationSchema).min(1),
})

// ─── Analysis envelope ───────────────────────────────────────────────────────

export const ConsultationAnalysisSchema = z.object({
  note: SoapNoteSchema,
  gaps: z.array(InformationGapSchema),
  redFlags: z.array(RedFlagSchema),
  suggestions: z.array(ClinicalSuggestionSchema),
})

// ─── Consultation lifecycle ──────────────────────────────────────────────────

/**
 * `approved` is only reachable through an explicit doctor action. Nothing
 * auto-approves.
 */
export const ConsultationStatusSchema = z.enum([
  'draft',
  'analyzing',
  'awaiting_review',
  'approved',
])

export const ConsultationSchema = z.object({
  id: z.string(),
  status: ConsultationStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  transcript: TranscriptSchema.nullable(),
  analysis: ConsultationAnalysisSchema.nullable(),
})

// ─── LLM response contracts (docs/trd.md §12) ────────────────────────────────

/**
 * Operation 1. The prompt never asks for a diagnosis, differential, or
 * impression — only for the diagnosis the doctor stated, if any.
 */
export const NoteAndGapsResponseSchema = z.object({
  note: SoapNoteSchema,
  clinicalFacts: LlmClinicalFactsSchema,
  operational: LlmOperationalBlockSchema,
  gaps: z.array(InformationGapSchema),
})

/**
 * Operation 2. `corpusIds` is the live list of guideline chunk ids at request
 * time, which narrows `guidelineId` from a free `string` to a decoding
 * constraint: a citation naming an id outside the corpus fails
 * `safeParse` inside the adapter and never reaches the doctor.
 *
 * `outOfScope` is an explicit signal rather than an inference from an empty
 * `suggestions` array — that inference would conflate "out of scope,
 * suggestions suppressed" with "in scope, nothing to suggest" (docs/trd.md §19
 * row 7).
 *
 * Red flags returned here are candidates only: `source` is pinned to `'model'`
 * and `ruleId` is absent, so a model response is structurally incapable of
 * impersonating a deterministic rule hit.
 */
export const makeSuggestionsAndRedFlagsSchema = (corpusIds: readonly [string, ...string[]]) =>
  z.object({
    outOfScope: z.boolean(),
    redFlags: z.array(
      RedFlagSchema.omit({ source: true, ruleId: true }).extend({
        source: z.literal('model'),
      }),
    ),
    suggestions: z.array(
      ClinicalSuggestionSchema.extend({
        citations: z.array(CitationSchema.extend({ guidelineId: z.enum(corpusIds) })).min(1),
      }),
    ),
  })

// ─── API contracts (docs/trd.md §13) ─────────────────────────────────────────

export const ConsultationListItemSchema = ConsultationSchema.pick({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
})

export const ConsultationDetailSchema = ConsultationSchema.extend({
  editedNote: SoapNoteSchema.nullable(),
  approvedAt: z.coerce.date().nullable(),
  acknowledgedRedFlagIds: z.array(z.string()),
  reviewedGapIds: z.array(z.string()),
})

export const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

export const FixtureSchema = z.object({
  id: z.string(),
  label: z.string(),
  transcript: TranscriptSchema,
})

/**
 * `verbatimAllowed` is legally load-bearing, not metadata: MOH NAG 2024 is
 * all-rights-reserved and may be summarised and linked but never quoted, while
 * the two CC-licensed sources may be. A `quote` on a chunk that forbids one is
 * a corpus-authoring defect and fails here (docs/trd.md §11).
 */
export const GuidelineChunkSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    publisher: z.string(),
    year: z.number().int(),
    url: z.string().url(),
    /** Short, non-verbatim summary shown in the UI. */
    summary: z.string(),
    sourceLicence: z.string(),
    verbatimAllowed: z.boolean(),
    quote: z.string().optional(),
  })
  .refine((chunk) => chunk.verbatimAllowed || chunk.quote === undefined, {
    path: ['quote'],
    message: 'quote is not permitted on a chunk whose licence forbids verbatim reuse',
  })

// ─── Inferred types ──────────────────────────────────────────────────────────

export type Speaker = z.infer<typeof SpeakerSchema>
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>
export type Transcript = z.infer<typeof TranscriptSchema>
export type SoapNote = z.infer<typeof SoapNoteSchema>
export type AssertionState = z.infer<typeof AssertionStateSchema>
export type ClinicalAssertion = z.infer<typeof ClinicalAssertionSchema>
export type ClinicalFacts = z.infer<typeof ClinicalFactsSchema>
export type OperationalBlock = z.infer<typeof OperationalBlockSchema>
export type InformationGap = z.infer<typeof InformationGapSchema>
export type RedFlag = z.infer<typeof RedFlagSchema>
export type Citation = z.infer<typeof CitationSchema>
export type ClinicalSuggestion = z.infer<typeof ClinicalSuggestionSchema>
export type ConsultationAnalysis = z.infer<typeof ConsultationAnalysisSchema>
export type ConsultationStatus = z.infer<typeof ConsultationStatusSchema>
export type Consultation = z.infer<typeof ConsultationSchema>
export type NoteAndGapsResponse = z.infer<typeof NoteAndGapsResponseSchema>
export type SuggestionsAndRedFlagsResponse = z.infer<
  ReturnType<typeof makeSuggestionsAndRedFlagsSchema>
>
export type ConsultationListItem = z.infer<typeof ConsultationListItemSchema>
export type ConsultationDetail = z.infer<typeof ConsultationDetailSchema>
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>
export type Fixture = z.infer<typeof FixtureSchema>
export type GuidelineChunk = z.infer<typeof GuidelineChunkSchema>
