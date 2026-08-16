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

/**
 * Bounds on how much text may enter the pipeline in one consultation.
 *
 * Until these existed the 1 MB request-body limit was the only ceiling, which
 * is the wrong instrument: a body that size is roughly 300,000 words, and every
 * one of them would be de-identified, sent to a model priced per token, and
 * scanned again on the way back. The cost of an oversized transcript lands on
 * the LLM bill and the request timeout rather than on the JSON parser, so the
 * bound belongs on the shape rather than on the transport (OWASP LLM10,
 * Unbounded Consumption).
 *
 * Sized well above any real GP consultation and well below anything expensive.
 * The longest transcript measured during development ran about 3,000 words
 * across roughly 120 turns, so a 600-turn ceiling is several times the real
 * ceiling, and a turn longer than 4,000 characters is not a turn.
 */
export const MAX_TRANSCRIPT_TURNS = 600
export const MAX_TURN_CHARACTERS = 4_000

export const TranscriptTurnSchema = z.object({
  speaker: SpeakerSchema,
  text: z.string().min(1).max(MAX_TURN_CHARACTERS),
  /** Seconds from consultation start, when the source provides timing. */
  offsetSeconds: z.number().nonnegative().optional(),
})

/**
 * How the transcript was produced. Client-asserted and unverifiable by the API
 * even now that hosted transcription passes through it, because nothing ties a
 * relayed recording to the consultation later submitted with this field. It is
 * an honest provenance record for a cooperating client, never a security
 * control. See docs/trd.md §3.
 *
 * `asr_hosted` is the only path on which audio leaves the doctor's device: the
 * browser posts the recording to `POST /api/asr/transcriptions`, which relays
 * it to the ASR provider (#154). That egress is server-observed and audited;
 * this field remains the client-asserted linkage recorded at creation.
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
  turns: z.array(TranscriptTurnSchema).min(1).max(MAX_TRANSCRIPT_TURNS),
})

// ─── Hosted ASR ──────────────────────────────────────────────────────────────

/**
 * One hosted-ASR segment, field-for-field with the local worker's
 * `TranscriptSegment` (frontend/src/audio/protocol.ts) so segments from either
 * path feed `segmentsToDraft` unchanged.
 */
export const HostedAsrSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number().nullable(),
})

/**
 * What `POST /api/asr/transcriptions` returns. `segments` is empty on today's
 * path: the provider does not honour `verbose_json` (docs/trd.md §20.3,
 * finding 5), and the frontend's `usable()` gate already falls back to plain
 * prose on an empty array. The field stays so provider-side segments can start
 * flowing without a contract change.
 */
export const HostedAsrResultSchema = z.object({
  text: z.string(),
  /** Billed seconds from the provider's `usage` object, stamped into the audit trail. */
  durationSeconds: z.number(),
  segments: z.array(HostedAsrSegmentSchema),
})

// ─── Hosted draft speaker labels ─────────────────────────────────────────────

/**
 * One drafted turn of a hosted transcript. Deliberately narrower than
 * `TranscriptTurnSchema`: no `offsetSeconds`, because the hosted path carries
 * no timing and a fabricated offset would assert a wrong time in the evidence
 * trace (the same rule `segmentsToDraft` applies to split lines).
 */
export const DraftTurnSchema = z.object({
  speaker: SpeakerSchema,
  text: z.string().min(1).max(MAX_TURN_CHARACTERS),
})

/**
 * Bound on one hosted transcript submitted for turn drafting, reconciled with
 * the drafting call's 16,384-token output ceiling rather than with transport:
 * the output is a verbatim echo of the input, and at a conservative 2.5
 * characters per token for code-switched Malay, 30,000 characters is roughly
 * 12,000 echoed tokens plus per-turn JSON scaffolding, inside the ceiling
 * with margin. A larger cap would accept text whose echo is guaranteed to
 * truncate, paying the full output budget for a certain failure (OWASP
 * LLM10). Still ~1.6x the longest consultation measured during development
 * (~18,000 characters). Exported so the client can skip a call the API would
 * refuse.
 */
export const MAX_DRAFT_TEXT_CHARACTERS = 30_000

/** Body of `POST /api/asr/draft-turns`. */
export const DraftTurnsRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DRAFT_TEXT_CHARACTERS),
})

/**
 * What `POST /api/asr/draft-turns` returns, and also the schema the model's
 * own output is validated against (precedent: `ClinicalFactsResponseSchema`).
 * The turn list is the only content field, and the backend accepts it only
 * when the concatenated turn text reconstructs the input verbatim, so the
 * model can relabel speech but never rewrite it.
 */
export const DraftTurnsResponseSchema = z.object({
  turns: z.array(DraftTurnSchema).min(1).max(MAX_TRANSCRIPT_TURNS),
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
 * What the model is permitted to emit.
 *
 * `value` and `evidence` are **required here but optional in the persisted
 * schema**, and that asymmetry is the whole point. Under strict JSON-Schema
 * decoding an optional property is simply absent from `required`, and the model
 * takes that permission every time: measured against qwen-flash on a 3,085-word
 * consultation, **0 of 18** `PRESENT`/`DENIED` assertions carried a span. The
 * evidence check (docs/trd.md §21.4) then downgraded every one of them, so a
 * thorough consultation produced a note asserting nothing and 23 documentation
 * gaps. The safety property held; the product did not.
 *
 * Requiring the field flipped that to **18 of 18 emitted, 12 of 18 matching
 * verbatim** on the same transcript, with `diagnosis` correctly `PRESENT`.
 *
 * The empty string is permitted so `NOT_ASSESSED` stays the cheapest path
 * (docs/trd.md §3, ratification condition 1): a field the transcript never
 * touched costs `"value":"","evidence":""` and nothing more. The condition
 * forbids a field being implicitly required to be *filled*, which this respects
 * — it requires only that the key be present.
 *
 * It is deliberately **not** refined. Enforcing the span rule at the decoding
 * boundary would throw `LLMResponseError` and leave the doctor with nothing;
 * §21.4 wants the individual fact downgraded instead.
 */
export const LlmClinicalAssertionSchema = z.object({
  state: AssertionStateSchema,
  /**
   * Bounded, like `evidence` below. An unbounded string under strict decoding
   * is the other runaway vector alongside an unbounded array, and a normalised
   * concept label has no business being longer than this.
   */
  value: z.string().max(120),
  /**
   * A span long enough to carry the finding and no longer. The bound does
   * double duty: it caps output tokens, and it pushes the model toward the
   * short single-turn quote that the evidence check can actually match — a
   * span that wanders across speaker turns is exactly the one that fails.
   */
  evidence: z.string().max(400),
})

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
  LlmClinicalAssertionSchema.default({ state: 'NOT_ASSESSED', value: '', evidence: '' }),
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
    /**
     * Bounded deliberately. An unbounded array under strict decoding is a
     * runaway vector: measured against qwen-flash, a single `note_and_gaps`
     * call occasionally failed to terminate, generating 16,384 completion
     * tokens without closing the response. `maxItems` makes the ceiling
     * structural (Tier 1) rather than a token budget to tune — raising
     * `max_tokens` only buys a longer loop.
     *
     * Ten dispensed items is far beyond any single GP consultation.
     *
     * Lowered from twenty on 14/08/26 (GitHub issue #96, docs/trd.md §6).
     * Gemini expands a bounded array into `maxItems` copies of the item schema
     * before measuring it against its own schema budget, so twenty assertion
     * objects pushed `clinical_facts` past that budget and every request
     * failed with a bodiless 400. Measured: the same schema passes at ten and
     * below. The bound is now load-bearing for two unrelated reasons, and
     * raising it back stops Gemini running at all rather than merely widening
     * a ceiling.
     */
    medicationsDispensed: z.array(field).max(10).default([]),
    mcDays: field,
    referral: field,
    followUp: field,
  })

export const OperationalBlockSchema = buildOperationalBlock(
  ClinicalAssertionSchema.default({ state: 'NOT_ASSESSED' }),
)

export const LlmOperationalBlockSchema = buildOperationalBlock(
  LlmClinicalAssertionSchema.default({ state: 'NOT_ASSESSED', value: '', evidence: '' }),
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

/**
 * One established checklist field and the transcript span that evidenced it.
 *
 * `speaker` and `offsetSeconds` are optional and are resolved by locating the
 * span in the transcript rather than asserted by the model. They are omitted
 * when the span cannot be located in exactly one turn, or when the transcript
 * carries no timings (`offsetSeconds` is itself optional on a turn, and a
 * pasted or uploaded transcript has none). Omission means "not resolvable",
 * never "the start of the consultation".
 */
export const EvidenceLinkSchema = z.object({
  /** e.g. `clinicalFacts.symptoms.cough`, `operational.diagnosis`. */
  fieldId: z.string(),
  state: AssertionStateSchema,
  evidence: z.string(),
  speaker: SpeakerSchema.optional(),
  offsetSeconds: z.number().nonnegative().optional(),
})
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>

// ─── Analysis envelope ───────────────────────────────────────────────────────

export const ConsultationAnalysisSchema = z.object({
  note: SoapNoteSchema,
  gaps: z.array(InformationGapSchema),
  redFlags: z.array(RedFlagSchema),
  suggestions: z.array(ClinicalSuggestionSchema),
  /**
   * The reviewed checklist, surfaced rather than discarded.
   *
   * `docs/prd.md` §10 requires that a field the consultation never touched
   * reads as unestablished rather than as absent, and Demo Script step 5 asks
   * an evaluator to see exactly that. Both are unsatisfiable if the facts stay
   * inside the analysis pipeline: a UI cannot render a `NOT_ASSESSED` it was
   * never sent, and "we checked 29 fields" is not a claim a reviewer can
   * verify from four paragraphs of prose.
   *
   * Optional because consultations analysed before 13/08/26 have no facts
   * persisted. A reader must treat absence as "not recorded by this version",
   * never as "nothing was assessed" (which is the exact confusion §10 exists
   * to prevent) and the UI says so in as many words.
   */
  clinicalFacts: ClinicalFactsSchema.optional(),
  operational: OperationalBlockSchema.optional(),
  /**
   * Each established checklist field paired with the verbatim transcript span
   * behind it, so a doctor can check what the system read rather than trusting
   * it (GitHub issue #10, docs/trd.md §19 row 17).
   *
   * **These trace checklist fields, never note sentences.** The note is
   * generated prose from a separate model call (§12) and is not composed from
   * these facts, so no sentence in it has a provenance link and none can be
   * recovered afterwards. Matching note text back to the transcript by
   * similarity would manufacture provenance the system does not have, which in
   * a clinical record is worse than showing none.
   *
   * Every span here already survived the evidence check (§21.4), so a link is
   * a span that was matched against the de-identified transcript rather than
   * one the model asserted.
   *
   * Optional for the same reason as `clinicalFacts`: consultations analysed
   * before this shipped have none, and absence means "not recorded by this
   * version", never "nothing was evidenced".
   */
  evidenceLinks: z.array(EvidenceLinkSchema).optional(),
  /**
   * Whether the consultation fell outside the guideline corpus, carried through
   * to the reader rather than stopping at the pipeline.
   *
   * The model already produces this and `makeSuggestionsAndRedFlagsSchema`
   * documents why it exists: an empty `suggestions` array conflates "out of
   * scope, suggestions suppressed" with "in scope, nothing to suggest"
   * (docs/trd.md §19 row 7). That reasoning only pays off if the distinction
   * survives to the UI, and until now it was dropped when the analysis was
   * assembled, leaving the review screen to hedge with "this **may be** outside
   * the corpus's scope" about something the system already knew.
   *
   * Optional because consultations analysed before this shipped have no value
   * persisted. Absence means "not recorded by this version" and must keep the
   * old hedge, never be read as `false`.
   */
  outOfScope: z.boolean().optional(),
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

/**
 * The record's filing name, or `null` when it has never been named.
 *
 * Bounded, unlike `TranscriptSchema`, whose missing `.max()` is named as a gap
 * in `.claude/rules/security.md`. 120 characters is a filing label with room to
 * spare, and past that a title stops being scannable, which is the whole reason
 * it exists.
 *
 * Trimmed to `null` rather than kept as an empty string, so "cleared" and
 * "never named" are one state instead of two that render identically and sort
 * differently.
 */
export const ConsultationTitleSchema = z
  .string()
  .max(120)
  .transform((value) => value.trim())
  .refine((value) => value.length <= 120)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()

export const ConsultationSchema = z.object({
  id: z.string(),
  status: ConsultationStatusSchema,
  title: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  transcript: TranscriptSchema.nullable(),
  analysis: ConsultationAnalysisSchema.nullable(),
})

// ─── LLM response contracts (docs/trd.md §12) ────────────────────────────────

/**
 * Operation 1a. The 34-assertion checklist (29 clinical fields plus the five
 * operational ones) and nothing else. The prompt never asks for a diagnosis,
 * differential, or impression, only for the diagnosis the doctor stated.
 *
 * Split out from `note_and_gaps` on 13/08/26 (docs/trd.md §19 row 19). One
 * combined response averaged 3,337 completion tokens and ranged over 533 of
 * them, and it is that variance rather than the mean that pushed runs past the
 * provider's reliable ceiling and past CAP-1's 30s budget: 2 of 8 measured runs
 * exceeded it, the worst at 36.1s. Asking for the fixed checklist on its own
 * makes the response nearly constant-size, measured at 2,652 to 2,779 tokens
 * (a spread of 127), because every key is known in advance and only the spans
 * vary.
 */
export const ClinicalFactsResponseSchema = z.object({
  clinicalFacts: LlmClinicalFactsSchema,
  operational: LlmOperationalBlockSchema,
})

/**
 * Operation 1b. The generated-prose half, run concurrently with 1a against the
 * same transcript. It carries no dependency on the facts call: the note is
 * written from the transcript rather than composed from the assertions
 * (docs/trd.md §12), so ordering the two would only cost wall-clock.
 */
export const NoteAndGapsResponseSchema = z.object({
  note: SoapNoteSchema,
  /**
   * Bounded for the same reason as `medicationsDispensed`. The checklist holds
   * 29 fields, so more than 30 gaps cannot correspond to anything real, and an
   * unbounded array is where a strict-decoding loop escapes.
   */
  gaps: z.array(InformationGapSchema).max(30),
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

/*
 * `title` is the one clinical field this projection carries, and the widening
 * is deliberate rather than incidental.
 *
 * The list was PHI-free: id, status and two timestamps. A title changes that,
 * because a doctor renaming a record will use whatever makes it findable and
 * that is frequently a patient's name. The derived title carries no transcript
 * text by construction (`backend/src/analysis/title.ts`), but a renamed one is
 * free text and is treated as PHI everywhere it matters: erased with the other
 * three columns, never logged, never sent to a provider.
 */
export const ConsultationListItemSchema = ConsultationSchema.pick({
  id: true,
  status: true,
  title: true,
  createdAt: true,
  updatedAt: true,
})

/**
 * The events worth telling a doctor about after the fact (issue #116).
 *
 * A deliberate subset of the audit taxonomy, not all of it. `AuditEvent` records
 * everything that happened, including starts, edits and per-finding
 * dispositions; a feed of that is a log, and a log nobody reads is worse than no
 * feed. These four are the ones with an outcome: work finished, work failed, a
 * record was signed, a record was erased.
 *
 * Everything a notification carries is already constrained to an id and a member
 * of this enum, because the audit row it comes from is. There is no free-text
 * field to leak clinical content into, and that is a property of the substrate
 * rather than a rule this feature has to remember to follow.
 */
export const NotificationActionSchema = z.enum([
  'consultation.analysis_completed',
  'consultation.analysis_failed',
  'consultation.approved',
  'consultation.erased',
])

/**
 * `NotificationItem`, not `Notification`, because the DOM already has a
 * `Notification` global for the Web Notifications API. A shared type shadowing
 * it in browser code is a footgun for whoever later reaches for the real one.
 */
export const NotificationItemSchema = z.object({
  id: z.string(),
  action: NotificationActionSchema,
  /** Absent only on a row written before consultations carried the link. */
  consultationId: z.string().nullable(),
  createdAt: z.coerce.date(),
})

/** How many notifications one request returns. */
export const NOTIFICATION_FEED_LIMIT = 20

/**
 * The demo account's target state, shared so the seed script and the in-app
 * restore cannot drift (issue #123).
 *
 * It lives here rather than in `prisma/seed-demo.ts` because two things now
 * rebuild the demo: that script, and Settings for the guest account. If they
 * disagreed, the account restored from the UI would not be the account the
 * script produces, and only one of them would match what a demo was rehearsed
 * against.
 */
export const DEMO_PLAN = [
  { fixtureId: 'urti-gap-heavy', target: 'awaiting_review' },
  { fixtureId: 'urti-hard-red-flag', target: 'awaiting_review' },
  { fixtureId: 'urti-diagnosis-not-assessed', target: 'awaiting_review' },
  { fixtureId: 'urti-identifier-dense-routine', target: 'approved' },
  { fixtureId: 'urti-hard-uncertain', target: 'draft' },
] as const satisfies readonly { fixtureId: string; target: ConsultationStatus }[]

/**
 * How many consultations one erase request may carry.
 *
 * The handler erases sequentially rather than concurrently, because every
 * erasure appends to the audit hash chain and `AuditEvent.prevHash` is unique
 * precisely so two concurrent appends cannot silently fork it. A batch is
 * therefore a serial run of transactions, and this bound is what keeps its
 * duration predictable.
 *
 * `GET /api/consultations` is unpaginated, so a doctor holding more than this
 * many cannot clear them in a single gesture. That is a known edge of the
 * missing pagination rather than of erasure, and it fails loudly at validation
 * instead of silently erasing a prefix of the selection.
 */
export const ERASE_BATCH_LIMIT = 100

export const EraseConsultationsInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(ERASE_BATCH_LIMIT),
})

/**
 * Partial success is a real outcome here, so it is in the contract rather than
 * collapsed into a status code. An id lands in `failed` when the ownership gate
 * refuses it, which covers both "not this doctor's" and "already erased" and
 * deliberately does not distinguish them, for the same reason
 * `assertOwnedConsultation` returns 404 rather than 403.
 */
export const EraseConsultationsResultSchema = z.object({
  erased: z.array(z.string()),
  failed: z.array(z.string()),
})

/**
 * What a doctor decided about a red flag or a gap.
 *
 * Three states rather than a boolean, because "I have seen this and it is
 * handled" and "this does not apply to this patient" are different clinical
 * judgements and collapsing them loses the one a reviewer would want to read.
 *
 * **A disposition never changes the finding it refers to.** The red flag stays
 * in `analysis` exactly as the rules engine and model produced it; this records
 * a decision *about* it. That is what preserves the invariant on the
 * `acknowledgedRedFlagIds` column, that a flag is never removed or downgraded,
 * while still letting a doctor say a flag does not apply.
 */
export const DispositionStateSchema = z.enum(['acknowledged', 'dismissed', 'not_applicable'])
export type DispositionState = z.infer<typeof DispositionStateSchema>

/**
 * `reason` is required on `dismissed` and forbidden elsewhere.
 *
 * Dismissing is the only one of the three that discards a safety signal on the
 * doctor's own authority, so it is the one that has to be defensible later.
 * Acknowledging and marking not-applicable are self-explanatory and a mandatory
 * free-text box on either would train people to type "n/a" until the field
 * means nothing.
 */
const DispositionShape = z.object({
  id: z.string(),
  state: DispositionStateSchema,
  reason: z.string().trim().min(1).max(500).optional(),
  decidedAt: z.coerce.date(),
})

export const DispositionSchema = DispositionShape.refine(
  (value) =>
    value.state === 'dismissed' ? value.reason !== undefined : value.reason === undefined,
  {
    message: 'A dismissal requires a reason, and only a dismissal may carry one.',
    path: ['reason'],
  },
)
export type Disposition = z.infer<typeof DispositionSchema>

/** The client proposes a decision; the server stamps when it was made. */
export const DispositionInputSchema = DispositionShape.omit({ decidedAt: true }).refine(
  (value) =>
    value.state === 'dismissed' ? value.reason !== undefined : value.reason === undefined,
  {
    message: 'A dismissal requires a reason, and only a dismissal may carry one.',
    path: ['reason'],
  },
)
export type DispositionInput = z.infer<typeof DispositionInputSchema>

export const ConsultationDetailSchema = ConsultationSchema.extend({
  editedNote: SoapNoteSchema.nullable(),
  approvedAt: z.coerce.date().nullable(),
  /**
   * The clinician who approved, by name, and `null` until one has.
   *
   * Stated by the server rather than inferred by the client from the session.
   * Today a consultation is only ever visible to the account that owns it, so
   * the viewer and the approver are provably the same person and the client
   * could shortcut this. That equivalence is an access-control property, not a
   * fact about the document: the moment a clinic or admin boundary exists, a
   * note would start being attributed to whoever opened it. An approval is the
   * transition that makes the record someone's, so who performed it belongs in
   * the payload.
   *
   * A name is not an identifier. A production deployment needs an MMC
   * registration number, which the schema does not carry today.
   */
  approvedBy: z.string().nullable(),
  acknowledgedRedFlagIds: z.array(z.string()),
  reviewedGapIds: z.array(z.string()),
  /**
   * What the doctor decided about each red flag and each gap (issue #10, AC4).
   *
   * Kept alongside `acknowledgedRedFlagIds` rather than replacing it, because
   * consultations reviewed before this shipped carry only the boolean form.
   * Those rows project forward as `acknowledged`, which is what they meant, and
   * no data migration is needed to read them.
   */
  redFlagDispositions: z.array(DispositionSchema),
  gapDispositions: z.array(DispositionSchema),
})

// ─── CatatAI copilot ─────────────────────────────────────────────────────────

/**
 * The review-screen copilot's wire contract (GitHub issue #169).
 *
 * **The copilot proposes; the doctor disposes.** Every schema below is shaped
 * around that single rule. A model turn may only ever emit prose, citations,
 * and *proposals*; nothing here can express a completed write. Applying a
 * proposal is a separate authenticated request the doctor initiates by
 * clicking Approve, which is why `CopilotProposal` carries no `applied` field
 * for the model to set and no id it can forge.
 *
 * That structure is also this feature's anti-injection control, and it is
 * doing more work here than elsewhere. The rest of the system defends against
 * a transcript shaped like an instruction by giving the model a closed
 * response schema with no free-text escape hatch (`.claude/rules/security.md`,
 * "LLM Egress"). A copilot answering in prose cannot have one. What replaces
 * it is that prose has no side effects: the worst a successful injection can
 * do is put wrong words in a chat bubble, because every consequential action
 * requires a human click on a surface the model does not control.
 */
export const CopilotRoleSchema = z.enum(['doctor', 'copilot'])

export const CopilotTurnSchema = z.object({
  role: CopilotRoleSchema,
  content: z.string(),
})

/**
 * Bounded for the same reason `medicationsDispensed` is (docs/trd.md §21.3):
 * an unbounded history is a runaway prompt, and the digest already carries the
 * consultation state, so old turns are conversational context rather than the
 * record. The oldest turns are dropped, never summarised, because a summary of
 * clinical dialogue is another generation nobody reviewed.
 */
export const COPILOT_HISTORY_MAX = 20

export const CopilotRequestSchema = z.object({
  message: z.string().min(1).max(2_000),
  history: z.array(CopilotTurnSchema).max(COPILOT_HISTORY_MAX).default([]),
})

/**
 * What the copilot may ask to change, and nothing else.
 *
 * **The one absence that is not negotiable: no proposal approves a note.**
 * Sign-off is the doctor's explicit state transition and may never originate
 * from a model (`AGENTS.md`, Critical Do-Nots). There is no tool, and no
 * permission dialog would make one acceptable.
 *
 * Dispositions, including dismissal, *are* proposable, and the reasoning is
 * worth stating because it looks at first like the suppression path the rules
 * engine exists to close. It is not. A disposition records a decision *about* a
 * flag; it never removes, downgrades or hides it, and `mergeRedFlags` stays a
 * pure concat regardless. The flag is on the record either way, which is the
 * invariant. What a dismissal adds is the doctor's stated reason for setting it
 * aside, and that reason is deliberately **not** part of this schema: the model
 * may open the dialog, but the justification for discarding a safety signal is
 * typed by the doctor and travels on `CopilotApplyRequest`. A model-authored
 * reason would be the system writing its own excuse.
 *
 * `rationale` here is a different thing entirely: it is the copilot explaining
 * to the doctor why it is proposing this, shown on the card, and never stored.
 */
export const CopilotProposalSchema = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('edit_note_section'),
    section: z.enum(['subjective', 'objective', 'assessment', 'plan']),
    /** The replacement text in full, never a patch: a diff the doctor cannot
     *  read in a chat bubble is not something they can meaningfully approve. */
    text: z.string().min(1).max(4_000),
    rationale: z.string().min(1).max(400),
  }),
  z.object({
    tool: z.literal('set_red_flag_disposition'),
    redFlagId: z.string().min(1),
    state: DispositionStateSchema,
    rationale: z.string().min(1).max(400),
  }),
  z.object({
    tool: z.literal('set_gap_disposition'),
    gapId: z.string().min(1),
    state: DispositionStateSchema,
    rationale: z.string().min(1).max(400),
  }),
])

/**
 * **There is deliberately no copilot apply endpoint.**
 *
 * When the doctor presses Approve on a proposal, the client turns it into an
 * ordinary `PATCH /api/consultations/:id` body and sends it down the same route
 * their manual edits already use. A dedicated copilot write route was the
 * obvious design and is the worse one, for three reasons:
 *
 * - It would be a **second write path** to the clinical record, needing its own
 *   ownership check, its own validation and its own audit calls, all of which
 *   already exist and are tested once.
 * - "The proposal grants no capability the doctor did not already have" stops
 *   being an argument and becomes a fact: it is byte-for-byte the request the
 *   doctor's own keyboard produces.
 * - The dismissal-reason rule needs no restatement. `DispositionInputSchema`
 *   already requires a reason on `dismissed` and forbids one elsewhere, so the
 *   doctor's typed justification is validated by the same refinement that
 *   guards the checkbox on screen.
 *
 * **Known gap, stated rather than skipped.** Because the write is
 * indistinguishable from a manual edit, the audit trail records
 * `consultation.edited` without recording that CatatAI proposed it. Provenance
 * of a copilot-originated change is worth having and is filed separately; it is
 * not silently absent.
 */

/**
 * Server-sent events, in order:
 * `tool* -> token* -> proposal* -> done`, with `error` possible at any point.
 *
 * `tool` exists so the panel can show what the copilot is reading while it
 * reads it, then collapse once prose starts. It carries the tool's name and
 * nothing it returned: what a read tool returns is consultation content, and
 * streaming that to a log-adjacent surface is how transcript bodies end up
 * somewhere `AGENTS.md` forbids them.
 */
export const makeCopilotEventSchema = (corpusIds: readonly [string, ...string[]]) =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('tool'), name: z.string(), label: z.string() }),
    z.object({ type: z.literal('token'), text: z.string() }),
    z.object({ type: z.literal('proposal'), proposal: CopilotProposalSchema }),
    z.object({
      type: z.literal('done'),
      messageId: z.string(),
      /** Same constraint as every other citation path: an id from the supplied
       *  corpus or nothing. Free text fails here rather than reaching a doctor. */
      citations: z.array(z.object({ guidelineId: z.enum(corpusIds) })),
    }),
    z.object({ type: z.literal('error'), message: z.string() }),
  ])

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
export type HostedAsrSegment = z.infer<typeof HostedAsrSegmentSchema>
export type HostedAsrResult = z.infer<typeof HostedAsrResultSchema>
export type DraftTurn = z.infer<typeof DraftTurnSchema>
export type DraftTurnsRequest = z.infer<typeof DraftTurnsRequestSchema>
export type DraftTurnsResponse = z.infer<typeof DraftTurnsResponseSchema>
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
export type ClinicalFactsResponse = z.infer<typeof ClinicalFactsResponseSchema>
export type NoteAndGapsResponse = z.infer<typeof NoteAndGapsResponseSchema>
export type SuggestionsAndRedFlagsResponse = z.infer<
  ReturnType<typeof makeSuggestionsAndRedFlagsSchema>
>
export type ConsultationListItem = z.infer<typeof ConsultationListItemSchema>
export type ConsultationDetail = z.infer<typeof ConsultationDetailSchema>
export type NotificationAction = z.infer<typeof NotificationActionSchema>
export type NotificationItem = z.infer<typeof NotificationItemSchema>
export type EraseConsultationsInput = z.infer<typeof EraseConsultationsInputSchema>
export type EraseConsultationsResult = z.infer<typeof EraseConsultationsResultSchema>
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>
export type Fixture = z.infer<typeof FixtureSchema>
export type GuidelineChunk = z.infer<typeof GuidelineChunkSchema>
export type CopilotRole = z.infer<typeof CopilotRoleSchema>
export type CopilotTurn = z.infer<typeof CopilotTurnSchema>
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>
export type CopilotProposal = z.infer<typeof CopilotProposalSchema>
export type CopilotEvent = z.infer<ReturnType<typeof makeCopilotEventSchema>>
