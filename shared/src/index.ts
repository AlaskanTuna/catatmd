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

export const TranscriptSchema = z.object({
  turns: z.array(TranscriptTurnSchema).min(1),
})

// ─── Structured clinical note (SOAP) ─────────────────────────────────────────

export const SoapNoteSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
})

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

// ─── Inferred types ──────────────────────────────────────────────────────────

export type Speaker = z.infer<typeof SpeakerSchema>
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>
export type Transcript = z.infer<typeof TranscriptSchema>
export type SoapNote = z.infer<typeof SoapNoteSchema>
export type InformationGap = z.infer<typeof InformationGapSchema>
export type RedFlag = z.infer<typeof RedFlagSchema>
export type Citation = z.infer<typeof CitationSchema>
export type ClinicalSuggestion = z.infer<typeof ClinicalSuggestionSchema>
export type ConsultationAnalysis = z.infer<typeof ConsultationAnalysisSchema>
export type ConsultationStatus = z.infer<typeof ConsultationStatusSchema>
export type Consultation = z.infer<typeof ConsultationSchema>
