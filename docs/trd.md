# TRD

> Canonical technical reference. `docs/prd.md` owns requirements; `docs/README.md` owns the reader-facing narrative. This document goes deeper than both — implementers build against it.

---

## 1. Purpose & Relationship To Other Docs

**Audience:** implementers — anyone picking up a module directory and building against a contract.

This document does not restate what `docs/README.md` already carries (the capability table, the PHI-boundary narrative, the provider table, the repo tree, getting-started steps, the commit convention). Where a topic overlaps, this document either goes deeper or omits it entirely — see the duplication table in `docs/plan.md`'s Global Constraints for the row-by-row rule.

`docs/prd.md` owns product requirements, acceptance criteria, and scope. This document owns the contracts that realise them: module boundaries, schemas, data models, API surface, and the security and deployment posture.

### Status Tag Legend

Every section below carries exactly one tag.

| Tag             | Meaning                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| **`Built`**     | Describes code that exists today. Verified line-by-line against the source.             |
| **`Specified`** | Design is decided and canonical, but not yet implemented.                               |
| **`Open`**      | A decision is genuinely unresolved. States what is undecided and what would unblock it. |

The no-invention rule holds throughout: where a fact is not derivable from existing code, a locked decision, or a Gate 1 answer, the section is tagged `Open` rather than given a fabricated answer.

---

## 2. System Context & Component Responsibilities

**Status: `Built`**

Per-module contract, read as "owns / may import / must never import":

| Module                    | Owns                                                                                                                         | May Import                                                                     | Must Never Import                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `shared/`                 | Zod schemas and inferred types (`@shared/types`) — the single source of truth for both sides                                 | Zod only                                                                       | Anything backend- or frontend-specific                                |
| `backend/src/deid/`       | PHI detection, tokenisation, the request-scoped rehydration vault — the only module permitted to mint a `Deidentified` value | `@shared/types`                                                                | Any LLM provider SDK                                                  |
| `backend/src/lib/llm/`    | `LLMClient` port + the OpenAI-compatible adapter — the only egress point to any provider                                     | `openai` SDK, `@shared/types`, `deid/types.js` (type-only, for `Deidentified`) | Nothing outside `lib/llm/` may import an LLM provider SDK directly    |
| `backend/src/redflags/`   | Deterministic escalation-trigger rules engine — currently an intent-stating README only                                      | `@shared/types`                                                                | An LLM provider SDK; must remain a pure function library              |
| `backend/src/guidelines/` | Curated citation corpus — currently an intent-stating README only                                                            | `@shared/types`                                                                | —                                                                     |
| `backend/src/routes/`     | HTTP surface — currently `health.ts` only                                                                                    | `express`, `lib/prisma.js`, `config/env.js`                                    | An LLM provider SDK; PHI must reach `deid/` before any LLM call       |
| `frontend/`               | React SPA — consultation review UI, currently the Vite scaffold only                                                         | `@shared/types`, the backend HTTP API                                          | A provider SDK or the de-identification vault (both are backend-only) |

The load-bearing rule that cuts across the table: **no module outside `backend/src/lib/llm/` may import an LLM provider SDK directly.** This is what makes the provider swappable and is stated as a module constraint, not a convention — see §5 for the compile-time mechanism that backs the PHI half of it.

---

## 3. Shared Contracts (`@shared/types`)

**Status: `Built`**

All schemas live in `shared/src/index.ts`. Types are inferred (`z.infer`), never hand-written.

### Transcript

| Schema                 | Fields                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `SpeakerSchema`        | `enum(['doctor', 'patient'])`                                                         |
| `TranscriptTurnSchema` | `speaker: Speaker`, `text: string().min(1)`, `offsetSeconds?: number().nonnegative()` |
| `TranscriptSchema`     | `turns: TranscriptTurn[]` — `.min(1)`                                                 |

### Clinical Note & Analysis

| Schema                       | Fields                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SoapNoteSchema`             | `subjective`, `objective`, `assessment`, `plan` — all `string`                                                                                              |
| `InformationGapSchema`       | `id: string`, `question: string`, `rationale: string`, `priority: enum(['high','medium','low'])`                                                            |
| `RedFlagSchema`              | `id: string`, `label: string`, `severity: enum(['emergency','urgent','advisory'])`, `evidence: string`, `source: enum(['rule','model'])`, `ruleId?: string` |
| `CitationSchema`             | `guidelineId: string`, `quote?: string`                                                                                                                     |
| `ClinicalSuggestionSchema`   | `id: string`, `text: string`, `citations: Citation[]` — `.min(1)`                                                                                           |
| `ConsultationAnalysisSchema` | `note: SoapNote`, `gaps: InformationGap[]`, `redFlags: RedFlag[]`, `suggestions: ClinicalSuggestion[]`                                                      |

### Consultation Lifecycle

| Schema                     | Fields                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConsultationStatusSchema` | `enum(['draft', 'analyzing', 'awaiting_review', 'approved'])`                                                                                                                  |
| `ConsultationSchema`       | `id: string`, `status: ConsultationStatus`, `createdAt: coerce.date()`, `updatedAt: coerce.date()`, `transcript: Transcript \| null`, `analysis: ConsultationAnalysis \| null` |

`ConsultationSchema` does not carry `doctorId` or `editedNote` — those exist only on the Prisma `Consultation` model (§4). §13's `ConsultationDetailSchema` resolves `editedNote` (and adds `approvedAt`, `acknowledgedRedFlagIds`); `doctorId` does not surface in any proposed API response schema — the authenticated doctor already has it from their own session, so no route needs to echo it back. This omission is part of the §13 proposal, not an unresolved question.

### Load-Bearing Semantics

- **`RedFlag.source`** — `'rule'` hits come from the deterministic engine and are authoritative; they may never be suppressed or downgraded by the model. `'model'` hits are candidates for doctor review only.
- **`RedFlag.ruleId`** — present when `source: 'rule'`; identifies which trigger in the versioned rule list fired. The schema does not enforce this pairing (`ruleId` is unconditionally optional) — it is a convention, not a compile-time guarantee.
- **`ClinicalSuggestion.citations`** — `.min(1)`. A suggestion with zero citations fails validation; the schema forbids an uncited clinical suggestion from ever reaching the doctor.

### Structured Clinical-Information Schema — Proposal

**Open** — `SoapNoteSchema` (above) is four free-text strings and cannot itself express per-field assertion states. `docs/prd.md`'s Safety Constraints requires that a symptom, allergy, medication, history item, vital sign, examination finding, or safety question never asked about must never be represented as denied — that requires distinguishing `NOT_ASSESSED`/`UNKNOWN` from `DENIED`/`PRESENT` at the level of an individual clinical fact, which four opaque note strings cannot do. Whether the schema should grow a structured, per-field clinical-fact representation (with an explicit assertion-state enum) alongside or instead of `SoapNoteSchema`, and what that shape should be, is unresolved — this is a proposal awaiting human ratification, not a decision made here. See the Open Decisions Register, §19, row 10.

---

## 4. Data Model (Prisma)

**Status: `Built`**

Source: `prisma/schema.prisma`. Datasource: Postgres, pooled `DATABASE_URL` (`:6543`, runtime) versus direct `DIRECT_URL` (`:5432`, migrations only).

### Auth Models (better-auth Prisma Adapter)

| Model          | Fields                                                                                                                                                                                              | Indexes        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `User`         | `id`, `name`, `email` (unique), `emailVerified`, `image?`, `createdAt`, `updatedAt`                                                                                                                 | —              |
| `Session`      | `id`, `token` (unique), `expiresAt`, `ipAddress?`, `userAgent?`, `createdAt`, `updatedAt`, `userId` → `User`                                                                                        | `[userId]`     |
| `Account`      | `id`, `accountId`, `providerId`, `accessToken?`, `refreshToken?`, `idToken?`, `accessTokenExpiresAt?`, `refreshTokenExpiresAt?`, `scope?`, `password?`, `createdAt`, `updatedAt`, `userId` → `User` | `[userId]`     |
| `Verification` | `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`                                                                                                                                  | `[identifier]` |

### Clinical Domain

**`ConsultationStatus` enum:** `draft`, `analyzing`, `awaiting_review`, `approved` — matches `ConsultationStatusSchema` exactly.

**`Consultation`**

| Field        | Type                                 | Note                                                                                                                           |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `String @id @default(cuid())`        | —                                                                                                                              |
| `status`     | `ConsultationStatus @default(draft)` | —                                                                                                                              |
| `doctorId`   | `String` → `User`                    | Owning doctor; every read path scopes on this                                                                                  |
| `transcript` | `Json?`                              | Shape validated by `TranscriptSchema` at the application boundary                                                              |
| `analysis`   | `Json?`                              | Shape validated by `ConsultationAnalysisSchema`; regenerated on re-analysis                                                    |
| `editedNote` | `Json?`                              | Doctor's edited copy — kept as a separate column so the AI-generated note and the approved clinical record are never conflated |
| `approvedAt` | `DateTime?`                          | —                                                                                                                              |
| `createdAt`  | `DateTime @default(now())`           | —                                                                                                                              |
| `updatedAt`  | `DateTime @updatedAt`                | —                                                                                                                              |

Index: `@@index([doctorId, status])` — supports the doctor's own consultation-list query scoped by status.

**`AuditEvent`** — append-only.

| Field            | Type                                            | Note                                                                                                |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`             | `String @id @default(cuid())`                   | —                                                                                                   |
| `action`         | `String`                                        | Free-form today; the enumerated taxonomy is `Specified` in §15                                      |
| `metadata`       | `Json?`                                         | Detector **labels** that fired during de-identification (e.g. `["NRIC","NAME"]`) — never the values |
| `actorId`        | `String?` → `User`, `onDelete: SetNull`         | —                                                                                                   |
| `consultationId` | `String?` → `Consultation`, `onDelete: Cascade` | —                                                                                                   |
| `createdAt`      | `DateTime @default(now())`                      | —                                                                                                   |

Indexes: `@@index([consultationId, createdAt])`, `@@index([actorId, createdAt])`.

`analysis` and `editedNote` are separate columns rather than one field so that the model's raw output is never overwritten by the doctor's edits — both remain independently inspectable, which matters both for review-trail integrity and for the "every output editable before approval" safety posture. `AuditEvent.metadata` is restricted to detector labels, never values, because the audit trail must not become a second PHI leak vector — it directly enforces the "no vault entries in logs" clinical-safety do-not.

### Gap: No Data-Retention Or Deletion Path

`Consultation` and `AuditEvent` rows persist indefinitely today — no TTL, archival job, or deletion/access-request endpoint exists. `docs/prd.md`'s Regulatory & Data-Protection Positioning states this is a prerequisite gap before any real patient data reaches the system, and that a DPIA must precede production deployment. Not fixed here; see the Open Decisions Register, §19, row 11.

---

## 5. The PHI Boundary — Type-Level Contract

**Status: `Built`**

Source: `backend/src/deid/types.ts`.

| Construct                 | Shape                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Deidentified`            | `string & { readonly [brand]: 'deidentified' }` — a branded string, `brand` is a module-private `unique symbol`        |
| `markDeidentified(value)` | `(value: string) => Deidentified` — casts a plain string into the branded type                                         |
| `TokenVault`              | `{ readonly entries: ReadonlyMap<string, string>; rehydrate(text: string): string }` — request-scoped, never persisted |
| `DeidentificationResult`  | `{ readonly text: Deidentified; readonly vault: TokenVault; readonly detected: readonly string[] }`                    |

### What The Compiler Enforces Versus What Convention Enforces

**Enforced by the compiler:** `LLMClient.generate()` (§6) types `content` as `Deidentified`. A plain `string` cannot be passed where `Deidentified` is expected without an explicit, visible cast — "raw transcript text reached `generate()`" fails `tsc`, not code review.

**Enforced only by convention, not the compiler:** `markDeidentified` is itself an **exported** function. Nothing in the module or the type system prevents another file from importing `markDeidentified` and calling `markDeidentified(rawString)` to manufacture a `Deidentified` value outside `deid/`, bypassing detection entirely. The header comment in `backend/src/deid/types.ts` states "only `deid/` may call this," but that is an instruction to the developer, not a constraint TypeScript checks. The type system guarantees the _shape_ of what reaches `LLMClient` (a branded string); it does not guarantee _provenance_ (that the brand was only ever minted after real de-identification work ran).

This gap is recorded as a finding, not fixed here — closing it (e.g. an ESLint rule restricting `markDeidentified` imports to `deid/`, or not exporting it and re-deriving the boundary another way) is recorded in the Open Decisions Register, §19, row 1.

---

## 6. LLM Port & Adapter

**Status: `Built`**

Source: `backend/src/lib/llm/{types,openai-compatible,index}.ts`.

### Port (`LLMClient`)

```
interface LLMClient {
  readonly provider: 'qwen' | 'gemini' | 'deepseek'
  readonly model: string
  generate<T>(request: GenerateRequest<T>): Promise<T>
}
```

### `GenerateRequest<T>`

| Field          | Type           | Note                                                     |
| -------------- | -------------- | -------------------------------------------------------- |
| `operation`    | `string`       | Names the call site in logs/traces; never patient data   |
| `system`       | `string`       | System prompt                                            |
| `content`      | `Deidentified` | The only field carrying transcript-derived text — see §5 |
| `schema`       | `z.ZodType<T>` | Validated against on return                              |
| `schemaName`   | `string`       | Name given to the provider's structured-output schema    |
| `temperature?` | `number`       | Defaults to `0.2` at the adapter, not the port           |

### `LLMResponseError`

`extends Error`, carries `operation`. Thrown for all three adapter failure modes below.

### Adapter Mechanism (`OpenAICompatibleClient`)

One adapter class implements `LLMClient` for all three providers — Qwen, Gemini, and DeepSeek each expose OpenAI-compatible chat completions, so provider selection is a constructor parameter (`provider`, `model`, `apiKey`, `baseURL`), not a branch in call logic.

1. Calls `client.chat.completions.create` with `messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.content }]`.
2. Requests structured output via `response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: z.toJSONSchema(request.schema, { target: 'draft-7' }) } }`.
3. `temperature` defaults to `0.2` when `request.temperature` is not supplied.
4. Validates the response with `request.schema.safeParse(parsed)` before returning — a non-conforming response is never returned as partially-trusted data.

### Failure Modes

| Failure                   | Trigger                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Empty response            | `completion.choices[0]?.message.content` is falsy                                                                        |
| Malformed JSON            | `JSON.parse(raw)` throws                                                                                                 |
| Schema-validation failure | `request.schema.safeParse(parsed)` returns `success: false` — the error message includes `z.prettifyError(result.error)` |

All three throw `LLMResponseError` with the operation name attached; there is no partial-success return path.

`getLLMClient()` (`backend/src/lib/llm/index.ts`) builds and caches a singleton client from `env.LLM_PROVIDER`, throwing on first client construction if the matching provider's API key is missing.

---

## 7. Environment Contract

**Status: `Built`**

Source: `backend/src/config/env.ts`. `EnvSchema` is validated against `process.env` at import time; a failing parse logs the Zod error and calls `process.exit(1)` before the app starts.

| Field                | Type / Constraint                                  | Default                                                  |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`           | `enum(['development','test','production'])`        | `development`                                            |
| `PORT`               | `coerce.number().int().positive()`                 | `3001`                                                   |
| `CORS_ORIGIN`        | `string().url()`                                   | `http://localhost:5173`                                  |
| `DATABASE_URL`       | `string().min(1)`                                  | none — required                                          |
| `DIRECT_URL`         | `string().min(1)`                                  | none — required                                          |
| `BETTER_AUTH_SECRET` | `string().min(32)`                                 | none — required                                          |
| `BETTER_AUTH_URL`    | `string().url()`                                   | none — required                                          |
| `LLM_PROVIDER`       | `enum(['qwen','gemini','deepseek'])`               | `qwen`                                                   |
| `QWEN_API_KEY`       | `string().optional()`                              | none                                                     |
| `QWEN_BASE_URL`      | `string().url()`                                   | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `QWEN_MODEL`         | `string()`                                         | `qwen3.7-flash`                                          |
| `GEMINI_API_KEY`     | `string().optional()`                              | none                                                     |
| `GEMINI_MODEL`       | `string()`                                         | `gemini-3.5-flash-lite`                                  |
| `DEEPSEEK_API_KEY`   | `string().optional()`                              | none                                                     |
| `DEEPSEEK_BASE_URL`  | `string().url()`                                   | `https://api.deepseek.com`                               |
| `DEEPSEEK_MODEL`     | `string()`                                         | `deepseek-v4-flash`                                      |
| `DEID_FAIL_CLOSED`   | `enum(['true','false'])`, transformed to `boolean` | `true`                                                   |

### Production Guards (Enforced At Boot)

1. `NODE_ENV === 'production' && LLM_PROVIDER === 'gemini'` → throws. Gemini's free-tier terms permit Google to use submitted content for product improvement and human review, so it must never sit on a path that could carry patient-derived text in production.
2. `NODE_ENV === 'production' && !DEID_FAIL_CLOSED` → throws. Production must run with fail-closed de-identification.

### Gap: No Production Guard For DeepSeek (PRC Hosting)

`backend/src/config/env.ts:43` guards only `LLM_PROVIDER === 'gemini'` in production (guard 1, above). `LLM_PROVIDER=deepseek` boots in production with no equivalent guard. DeepSeek's API is hosted in the PRC, which `docs/README.md` names as a further cross-border question under PDPA 2010 s.129 — this environment contract does not currently enforce anything against it. Recorded as a gap, not fixed here; see the Open Decisions Register, §19, row 9.

### Gap: `DEID_FAIL_CLOSED` Is Not Read At The Egress Point

`DEID_FAIL_CLOSED` is declared in `EnvSchema` and its `true` value is guarded at boot in production (guard 2, above). It is **not** read anywhere in `backend/src/lib/llm/openai-compatible.ts` — `OpenAICompatibleClient` never references `env.DEID_FAIL_CLOSED` or any fail-closed branch. The flag currently constrains what configuration is _accepted_ at startup; it does not yet gate _behaviour_ at the point where a request actually leaves the process. This is recorded as a gap, not tagged `Built`, because there is no enforcement code to verify against. Closing it — what "fail closed" should do at the egress point when de-identification is incomplete or the vault is empty — is `Open`; see the Open Decisions Register, §19, row 2.

---

## 8. HTTP Surface As Built

**Status: `Built`**

Source: `backend/src/app.ts`, `backend/src/routes/health.ts`.

### Middleware Stack (In Order)

1. `compression()`
2. `cors({ origin: env.CORS_ORIGIN, credentials: true })` — a single allowed origin, bound to `CORS_ORIGIN`, with credentials enabled
3. `express.json({ limit: '1mb' })`

### Routes

| Method | Path          | Behaviour                                                                                                                                                                                 |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health` | Runs `SELECT 1` against the database via Prisma. Returns `200 { status: 'ok', provider: env.LLM_PROVIDER }` on success, `503 { status: 'degraded', database: 'unreachable' }` on failure. |

No other routes exist today. There is no authentication middleware, no rate limiting, and no request-body schema validation wired into `app.ts` at this point — those are `Specified` or `Open` in §13–§16, not `Built`.

---

## 9. De-Identification Pipeline

**Status: `Specified`**

`backend/src/deid/` today holds only the type-level boundary (§5). This section specifies the detection, tokenisation, and vault mechanics that satisfy it.

### Detector Inventory

| Detector      | Label     | Matches                                                               | Approach                                                                                                                                                                                                                          |
| ------------- | --------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person Name   | `PATIENT` | The patient's name and any other named individual (family, caregiver) | Pattern-based: capitalised word sequences adjacent to a name cue — honorifics (`Mr`, `Mrs`, `Puan`, `Encik`, `Dr`), Malaysian patronymics (`bin`, `binti`, `a/l`, `a/p`), or immediately after "my name is" / "patient's name is" |
| NRIC          | `NRIC`    | Malaysian NRIC, `YYMMDD-PB-###G`                                      | Regex on the 12-digit hyphenated format                                                                                                                                                                                           |
| Phone         | `PHONE`   | Malaysian mobile/landline numbers                                     | Regex on `01X-XXXXXXX` / `0X-XXXXXXXX`, with or without country code                                                                                                                                                              |
| Address       | `ADDRESS` | Postal address fragments                                              | Regex/keyword: a 5-digit postcode co-located with a street-type keyword (`Jalan`, `Lorong`, `Taman`)                                                                                                                              |
| Date Of Birth | `DOB`     | Explicit birth dates                                                  | Date pattern co-located with a DOB cue ("born on", "DOB", "d.o.b.") — distinguished from other clinical dates in the transcript                                                                                                   |
| Record Number | `MRN`     | Medical/registration record numbers                                   | Alphanumeric pattern co-located with a record cue ("MRN", "IC no", "registration no")                                                                                                                                             |
| Email         | `EMAIL`   | Email addresses                                                       | Standard email regex                                                                                                                                                                                                              |

This inventory satisfies Q7/Q8's honest-limitations posture, not a clinical-grade NER system — see the recall note below.

### Token Format

`[LABEL_N]`, matching the format already fixed in `AGENTS.md` (`[PATIENT_1]`, `[NRIC_1]`). `N` increments per unique value encountered within one request: a second distinct name becomes `[PATIENT_2]`; every repeat of an already-seen value maps to the token already minted for it, so the model sees one consistent handle per person across the whole transcript.

### Vault Lifecycle

- Created once per analyse request, alongside the tokenised text — never a module-level singleton, never attached to a `Consultation` row.
- Populated during detection: `TokenVault.entries` maps each minted token to the original span (§5).
- Consumed exactly once, on the return path, after the LLM response has passed schema validation (§6) — `vault.rehydrate()` is called on every string field in the response payload (SOAP note fields, gap `question`/`rationale`, red-flag `label`/`evidence`, suggestion `text`) before the analysis is persisted or shown, because the model may echo a token back verbatim.
- Never serialised: not written to `Consultation.transcript`/`analysis` (§4), not logged, discarded when the request handler returns.

### Fail-Closed Semantics

The de-identification function is specified to throw, not return a partial result, if any detector step fails internally — a caller must never fall back to sending original text. `.env.example`'s own comment states the intent: "fail-closed: when true, `LLMClient` refuses any payload that did not pass through the de-identification gate." Whether that refusal is actually wired into `OpenAICompatibleClient` is the separate, already-recorded gap in §7 — referenced here, not restated.

### Audit Surface

Each analyse run writes one `consultation.analysis_completed` `AuditEvent` (§15) with `metadata: { detected: string[] }` — the detector labels that fired (e.g. `["PATIENT","NRIC"]`) — never the matched values, per the `AuditEvent.metadata` contract already recorded in §4.

### Recall Limitation

Stated plainly in `docs/prd.md`'s Known Limitations: these detectors are pattern-based and may miss an identifier, particularly a name with no adjacent cue. This is why raw transcripts are still treated as sensitive at rest (Q9, §4).

---

## 10. Red-Flag Rules Engine

**Status: `Specified`**

Read `.claude/skills/healthcare-cdss-patterns/SKILL.md` before implementing this module — its posture is adopted here without modification: a pure function library, zero side effects, zero tolerance for false negatives.

### Trigger Record Shape

```
interface RedFlagTrigger {
  id: string             // stable id; becomes RedFlag.ruleId
  label: string          // becomes RedFlag.label
  severity: 'emergency' | 'urgent' | 'advisory'
  matcher: (transcript: Transcript) => string | null  // matched evidence span, or null
  clinicalSource: string // citation for where this trigger comes from (Q7)
  listVersion: string    // version of the trigger list this entry belongs to
}
```

### Evaluation

- `evaluateRedFlags(transcript: Transcript): RedFlag[]` — a pure function over the transcript directly. It runs in-process and never leaves the API, so it does not need to pass through `deid/` first (§9 exists for the LLM egress path only).
- Runs independently of, and is never gated by, the LLM call — `docs/prd.md`'s Primary Flow step 3 states rules run "regardless of model output."
- Every trigger whose `matcher` returns non-null becomes a `RedFlag` with `source: 'rule'`, `ruleId: trigger.id`, `evidence` set to the matched span.

### Merge Rule — The Zero-Suppression Invariant

- Assembly is a union, never a filter: `finalRedFlags = ruleFlags.concat(modelCandidates)`.
- `modelCandidates` come from the `suggestions_and_red_flags` LLM call (§12), constrained by schema to `source: 'model'` with no `ruleId`.
- Nothing in assembly may drop, downgrade, or reorder a `rule`-sourced entry based on model output — the model call runs after rule evaluation and is never shown the rule engine's results to "reconcile" against, so it cannot suppress them even if instructed to.
- Testable consequence, mirroring the skill's pass criterion: for every trigger in the list, a fixture transcript containing its matching evidence must produce that `RedFlag` on 100% of runs — a single missed trigger is a patient-safety regression, not a quality issue.

### Engine Posture

Pure function library, zero side effects (no I/O, no LLM call, no database access) — consistent with the module-import constraint already recorded in §2 (`redflags/` may import only `@shared/types`).

### What Stays Undecided

The concrete trigger content — the actual list of clinical triggers, their thresholds, and each `clinicalSource` citation — is not specified here. Q7 records that no clinician is available to draft or validate it; inventing specific clinical thresholds without that review would itself violate the no-invention rule this document runs on. Sourcing the initial list from NICE, WHO, Centor/FeverPAIN, and the Malaysian CPG (as `docs/prd.md`'s Known Limitations already names) is implementation work against this contract, not a further TRD design decision.

---

## 11. Guideline Corpus

**Status: `Specified`**

### Chunk Record Shape

```
interface GuidelineChunk {
  id: string        // stable id; the value RedFlag/Citation.guidelineId cites
  title: string
  publisher: string
  year: number
  url: string
  summary: string    // short, non-verbatim summary shown in the UI
  quote?: string      // optional short verbatim excerpt — only once redistribution is confirmed safe, see below
}
```

10–15 chunks (Q6), drawn from NICE acute cough guidance, Centor/FeverPAIN scoring, the Malaysian CPG for URTI, and WHO guidance.

### Candidate Set Reaching The Prompt

The whole corpus (Q16) — every chunk's `id`, `title`, and `summary` — is serialised into the system prompt for the `suggestions_and_red_flags` call (§12). No retrieval step; unjustifiable complexity at 10–15 chunks.

### Schema-Enforced Rejection

`ClinicalSuggestionSchema.citations[].guidelineId` is `z.string()` in the shared schema (§3) — the shared package cannot depend on a backend-only corpus. The request-time schema used for the suggestions call (§12) narrows this field to `z.enum(corpusIds)`, where `corpusIds` is the live list of chunk ids at request time. A citation naming an id outside that set fails `request.schema.safeParse()` inside `OpenAICompatibleClient.generate()` (§6, `Built`) and throws `LLMResponseError` — the suggestion never reaches the doctor. This is a schema-enforced rejection path, not a prompt instruction the model could choose to ignore.

**Open** — exact source selection and the redistribution/licensing stance for verbatim `quote` fields are unresolved (Q6: "licensing needs a human call"). `docs/prd.md`'s Known Limitations already names this; it is repeated here because it directly bounds what the `quote` field may contain. See §19.

---

## 12. LLM Prompt & Response Contracts

**Status: `Specified`**

Two operations per analyse request (Q15 — decomposition by capability, not one call producing the whole `ConsultationAnalysis`). Both run after de-identification (§9) and before the rule engine's output is merged in (§10) — the model never sees the rule engine's hits, so it cannot suppress them by construction, not merely by instruction.

### Operation 1 — `note_and_gaps`

| Field           | Value                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation`     | `"note_and_gaps"`                                                                                                                                                         |
| `system` intent | Produce a SOAP note and information gaps from the de-identified transcript; explicitly instructed never to state or imply a diagnosis (`docs/prd.md`, Safety Constraints) |
| `content`       | The de-identified transcript, serialised as speaker-labelled turns                                                                                                        |
| response schema | Proposed `z.object({ note: SoapNoteSchema, gaps: z.array(InformationGapSchema) })` — a new export, not yet in `shared/src/index.ts`                                       |
| `schemaName`    | `"note_and_gaps"`                                                                                                                                                         |
| `temperature`   | Default `0.2` (§6)                                                                                                                                                        |

**Open** — see §3 and the Open Decisions Register, §19, row 10, for the unresolved question of whether `SoapNoteSchema` should be replaced or supplemented by a structured per-field clinical-information schema with assertion states before this operation is implemented.

### Operation 2 — `suggestions_and_red_flags`

| Field           | Value                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation`     | `"suggestions_and_red_flags"`                                                                                                                                                                                                                                                          |
| `system` intent | Given the same transcript and the full candidate guideline corpus (§11), propose cited clinical suggestions and any additional red-flag candidates; explicitly instructed that these are candidates only and can never override the rule engine (§10)                                  |
| `content`       | The same de-identified transcript as Operation 1                                                                                                                                                                                                                                       |
| response schema | Proposed `z.object({ redFlags: z.array(RedFlagSchema.omit({ source: true, ruleId: true }).extend({ source: z.literal('model') })), suggestions: z.array(ClinicalSuggestionSchema.extend({ citations: z.array(CitationSchema.extend({ guidelineId: z.enum(corpusIds) })).min(1) })) })` |
| `schemaName`    | `"suggestions_and_red_flags"`                                                                                                                                                                                                                                                          |
| `temperature`   | Default `0.2` (§6)                                                                                                                                                                                                                                                                     |

### Scope Notice For Non-URTI Presentations

`docs/prd.md`'s Clinical Scope requires that, for a transcript outside acute cough / sore throat / other upper-respiratory presentations, the system still runs `note_and_gaps` and the rule engine (§10) as normal but does not attempt guideline-cited suggestions — and the review screen must carry a visible scope notice. The `suggestions_and_red_flags` system prompt can instruct the model to return an empty `suggestions` array when the presentation falls outside the corpus's coverage, which is schema-valid — §11's `citations.min(1)` constrains items present in the array, not the array's length.

**Open** — how the review screen decides whether to show the scope notice is unresolved: inferring it from an empty `suggestions` array conflates "out of scope, suggestions suppressed" with "in scope, nothing to suggest," so a dedicated signal (e.g. an `outOfScope: boolean` alongside the analysis) may be needed instead. See §19.

### Retry / Failure Behaviour

No automatic retry inside `LLMClient` (§6, `Built`) — a failure on either call throws `LLMResponseError`, which the `/analyze` route (§13) catches and translates into a reverted `Consultation.status` plus an error response. The doctor's only retry path is manually re-triggering analysis (`docs/prd.md`, Primary Flow step 5), matching CAP-5's "no autonomous action" constraint — nothing retries itself.

### Latency Budget Tension (Open)

`docs/prd.md` CAP-1 binds analysis to a 30-second target for a 3,000-word transcript. This section specifies **two sequential** structured-output calls — the second (`suggestions_and_red_flags`) carries the full 10–15-chunk guideline corpus (§11) in the system prompt, against a free-tier flash model. Nothing in this document reconciles the 30s figure with that two-call cost; no section splits the budget across the two operations. Not resolved here — see the Open Decisions Register, §19, row 8.

---

## 13. API Contracts

**Status: `Specified`**

### New Response Schemas Proposed For `@shared/types`

None of these exist yet — proposing them is this document's mandate under Q17 ("the TRD proposes, the human ratifies").

| Schema                       | Shape                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsultationListItemSchema` | `id`, `status`, `createdAt`, `updatedAt` — no transcript/analysis body, for the consultation-list view (Q2)                                                                                                                                       |
| `ConsultationDetailSchema`   | `ConsultationSchema` (§3) extended with `editedNote: SoapNoteSchema.nullable()`, `approvedAt: z.coerce.date().nullable()`, `acknowledgedRedFlagIds: z.array(z.string())`, `reviewedGapIds: z.array(z.string())` — resolves §3's forward reference |
| `ErrorEnvelopeSchema`        | `z.object({ error: z.object({ code: z.string(), message: z.string() }) })` — uniform across every route                                                                                                                                           |
| `FixtureSchema`              | `id: string`, `label: string`, `transcript: Transcript` — names the shape `GET /api/fixtures` already returns, so no route response is an inline anonymous type                                                                                   |
| `GuidelineChunkSchema`       | Mirrors §11's `GuidelineChunk` interface (`id`, `title`, `publisher`, `year: number`, `url`, `summary`, `quote?`) — new export enabling `GET /api/guidelines`                                                                                     |

### Routes

| Method  | Path                             | Auth    | Body                                                                                               | Response                                              | Notes                                                                                                                                                                                              |
| ------- | -------------------------------- | ------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*`     | `/api/auth/**`                   | —       | better-auth's own                                                                                  | better-auth's own                                     | Mounted, not custom-built — see §14                                                                                                                                                                |
| `GET`   | `/api/health`                    | none    | —                                                                                                  | existing (§8, `Built`)                                | unchanged                                                                                                                                                                                          |
| `GET`   | `/api/fixtures`                  | session | —                                                                                                  | `200 { fixtures: FixtureSchema[] }`                   | bundled synthetic transcripts (Q1, Q5)                                                                                                                                                             |
| `GET`   | `/api/guidelines`                | session | —                                                                                                  | `200 { guidelines: GuidelineChunkSchema[] }`          | the full corpus (§11); resolves `Citation.guidelineId` → title/publisher/year/url for CAP-4's citation-detail view (`docs/prd.md`)                                                                 |
| `GET`   | `/api/consultations`             | session | —                                                                                                  | `200 { consultations: ConsultationListItemSchema[] }` | scoped to `doctorId = session.user.id`                                                                                                                                                             |
| `POST`  | `/api/consultations`             | session | `{ transcript: Transcript }`                                                                       | `201 { consultation: ConsultationDetailSchema }`      | status starts `draft`; turning pasted free text into `Transcript` turns is a frontend concern, out of this contract                                                                                |
| `GET`   | `/api/consultations/:id`         | session | —                                                                                                  | `200 { consultation }` / `404`                        | `404` for both "does not exist" and "not owned" — never gives an unauthorised caller an existence oracle                                                                                           |
| `POST`  | `/api/consultations/:id/analyze` | session | —                                                                                                  | `200 { consultation }` / `409` / `500`                | allowed from `draft` or `awaiting_review` (re-analysis); `409` from `analyzing` or `approved`; on `LLMResponseError`, status reverts to its pre-call value and `500` returns `ErrorEnvelopeSchema` |
| `PATCH` | `/api/consultations/:id`         | session | `{ editedNote?: Partial<SoapNote>, acknowledgedRedFlagIds?: string[], reviewedGapIds?: string[] }` | `200 { consultation }` / `409`                        | only while `awaiting_review`; `409` once `approved`                                                                                                                                                |
| `POST`  | `/api/consultations/:id/approve` | session | —                                                                                                  | `200 { consultation }` / `409`                        | requires `awaiting_review` with `analysis` attached (CAP-5); sets `status: approved`, `approvedAt`, writes `consultation.approved` (§15)                                                           |

### Gap — Red-Flag Acknowledgment And Gap Review Have No Columns Yet

CAP-3's "a red flag can be acknowledged" and CAP-2's "the doctor can... note that it has been reviewed" (both `docs/prd.md`) need persisted state, but the `Built` Prisma schema (§4) has neither column today. Proposed additions: `Consultation.acknowledgedRedFlagIds Json?` (array of `RedFlag.id`) and `Consultation.reviewedGapIds Json?` (array of `InformationGap.id`) — each kept as its own column following the same "AI output stays separate from doctor action" pattern as `editedNote`. This is a schema change awaiting a migration, not a design gap — the shape above is this document's answer, not a further open question.

### State Machine Cross-Check

Matches `docs/prd.md`'s Primary Flow exactly: `draft →(create) draft →(analyze) analyzing →(complete) awaiting_review →(analyze, repeatable) analyzing → awaiting_review →(approve) approved [terminal]`.

---

## 14. Auth Model

**Status: `Specified`**

- better-auth with the Prisma adapter, against the `User` / `Session` / `Account` / `Verification` models already in `prisma/schema.prisma` (§4, `Built`) — no new auth tables.
- Session strategy: better-auth's default cookie session (`httpOnly`, `secure` in production, `sameSite: lax`), per `.claude/skills/better-auth-security-best-practices/SKILL.md`.
- Route protection: an Express middleware resolves the session on every request; all `/api/consultations*` and `/api/fixtures` routes reject with `401` when no valid session is present. `/api/health` and `/api/auth/**` are exempt.
- Ownership scoping: every `Consultation` read or write path calls one helper (e.g. `assertOwnedConsultation(id, doctorId)`) querying `WHERE id = ? AND doctorId = ?`; a mismatch returns `404`, not `403` (§13) — this is also what the Demo Script's ownership-isolation step (`docs/prd.md`) actually observes.
- Sign-up (Q2 — seeded accounts only, no open self-service sign-up): the frontend does not expose a sign-up screen; accounts are provisioned by a seed script.
- CSRF, trusted origins, and rate limiting are cross-cutting with Security Controls — see §16 rather than restating here.

**Open** — whether better-auth's own `/api/auth/sign-up/email` route should additionally be disabled at the framework-config level, or left mounted-but-unused behind the frontend's omission, is unresolved: the exact configuration for that is not confirmed against the installed better-auth version. See §19.

---

## 15. Audit Logging

**Status: `Specified`**

### `AuditEvent.action` Taxonomy

`AuditEvent.action` is a free `String` in the `Built` schema (§4); this table is the enumerated set of values it should be constrained to.

| Action                            | Fires On                                     | `metadata`                                                                |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `consultation.created`            | `POST /api/consultations`                    | —                                                                         |
| `consultation.analysis_started`   | `POST /api/consultations/:id/analyze` begins | —                                                                         |
| `consultation.analysis_completed` | analyse pipeline succeeds                    | `{ detected: string[] }` — detector labels only (§9)                      |
| `consultation.analysis_failed`    | analyse pipeline throws                      | `{ reason: string }` — a short failure category, never the raw error text |
| `consultation.edited`             | `PATCH /api/consultations/:id`               | —                                                                         |
| `redflag.acknowledged`            | doctor acknowledges a red flag               | `{ redFlagId: string }`                                                   |
| `gap.reviewed`                    | doctor marks an information gap reviewed     | `{ gapId: string }`                                                       |
| `consultation.approved`           | `POST /api/consultations/:id/approve`        | —                                                                         |

Every row also carries `actorId` (the authenticated doctor) and `consultationId` — both already `Built` (§4). Together the taxonomy covers every transition in `docs/prd.md`'s Primary Flow: create → analyse (start/complete/fail) → edit/acknowledge → approve.

### Forbidden Content

Per `.claude/skills/healthcare-phi-compliance/SKILL.md`: no `AuditEvent.metadata` value may ever contain a transcript body, note text, gap/suggestion text, or a `TokenVault` entry. `metadata` is typed as `Json?` with no schema constraint today (§4); constraining its shape to a discriminated union keyed by `action` is proposed here but not yet implemented.

---

## 16. Security Controls

**Status: `Specified`** — the table below carries a finer-grained status per control, since some controls are already `Built` and others are proposed; the section-level tag reflects that the security posture as a whole is a design, not yet complete.

| Control            | Status      | Detail                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport          | `Specified` | HTTPS terminated by the hosting platform (Vercel/Render) — Render's Singapore service supplies TLS; not something `backend/src/app.ts` configures itself                                                                                                                                        |
| CORS               | `Built`     | `cors({ origin: env.CORS_ORIGIN, credentials: true })` — single allowed origin (§8)                                                                                                                                                                                                             |
| Security headers   | `Specified` | No `helmet()` or equivalent wired into `app.ts` today. Proposed: `helmet()` with CSP left to its default posture, since the SPA is served separately by Vercel, not by this API                                                                                                                 |
| Rate limiting      | `Specified` | Not present in `app.ts`. Proposed: a per-IP limiter on `POST /api/consultations/:id/analyze` (the expensive, LLM-backed route). better-auth's own endpoints ship rate limiting by default in production per `.claude/skills/better-auth-security-best-practices`                                |
| Input size limits  | `Built`     | `express.json({ limit: '1mb' })` (§8)                                                                                                                                                                                                                                                           |
| Secrets handling   | `Built`     | `EnvSchema` requires `BETTER_AUTH_SECRET.min(32)` (§7); `.env` gitignored, `.env.example` committed with placeholders only (`AGENTS.md`)                                                                                                                                                        |
| Dependency posture | `Open`      | No automated dependency scanning, and no CI workflow at all today — `.github/workflows/ci.yml` was removed (§17). Proposed, pending CI's reinstatement: a workflow running install, `prisma generate`, lint, typecheck, test, and a `bun audit` (or Dependabot/Renovate) step. See §19, row 12. |

The Clinical-Safety Checklist in `.github/PULL_REQUEST_TEMPLATE.md` is the existing compensating control for changes to `deid/`, `lib/llm/`, `redflags/`, and `guidelines/` — it is process, not a runtime control, and is not duplicated here.

---

## 17. Environments & Deployment

**Status: `Specified`** — the Render service definition below is `Built`; migration wiring and the free-tier mitigation remain `Specified`.

### Topology

Frontend → Vercel; backend → Render (Singapore); database → Supabase (Singapore) — locked in `AGENTS.md`, all three in-region by design. Backend hosting is `Built`: see the Render Service Definition below.

### Render Service Definition (`render.yaml`)

**Status: `Built`**

Source: `render.yaml` (repo root).

| Field              | Value                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `type` / `runtime` | `web` / `node`                                                                                                                   |
| `region`           | `singapore`                                                                                                                      |
| `plan`             | `free`                                                                                                                           |
| `buildCommand`     | `bun install && bun run --cwd shared build && bunx prisma generate --schema prisma/schema.prisma && bun run --cwd backend build` |
| `startCommand`     | `bun run --cwd backend start`                                                                                                    |
| `healthCheckPath`  | `/api/health`                                                                                                                    |

`envVars`: `NODE_ENV=production`; `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `QWEN_API_KEY` all `sync: false` (set manually in the Render dashboard, never committed); `BETTER_AUTH_SECRET` uses `generateValue: true`; `LLM_PROVIDER=qwen`; `QWEN_BASE_URL` pinned to the Singapore Model Studio endpoint; `QWEN_MODEL=qwen3.7-flash`; `DEID_FAIL_CLOSED: 'true'`.

`QWEN_MODEL` pins the same untested default flagged in Open #6 below — the value is already committed to the deploy config before the exact model id has been confirmed against a live Model Studio account.

### Pooled Versus Direct URL Split

`DATABASE_URL` (Supavisor pooler, `:6543`, `pgbouncer=true`) is used by the running app; `DIRECT_URL` (`:5432`) is used only by `prisma migrate` — both already `Built` in `EnvSchema` (§7), `.env.example`, and `render.yaml`.

### Migration Flow

Locally: `bun run db:migrate` (`prisma migrate dev`, against `DIRECT_URL`). In production: `render.yaml`'s `buildCommand` does not run `prisma migrate deploy` today. Proposed: add a `preDeployCommand: bunx prisma migrate deploy --schema prisma/schema.prisma` to the existing `render.yaml`, run against `DIRECT_URL`.

### CI

**Status: `Open`** — no CI workflow exists in the repo. `.github/workflows/ci.yml` (previously `Built`, running `bun install --frozen-lockfile`, `prisma generate`, `bun run lint`, `bun run typecheck`, and `bun run test` on every push to `main` and every PR) has been removed. Whether and when to reinstate automated CI, including the dependency-scan step proposed in §16, is unresolved. See the Open Decisions Register, §19, row 12.

### Free-Tier Auto-Pause Mitigation

Supabase free-tier projects auto-pause after roughly a week idle. Proposed mitigation: either a scheduled keep-alive ping (e.g. a cron hitting `GET /api/health` every few days) or upgrading the project to a paid tier — the right choice depends on the blocked org-capacity fact below, so it stays provisional.

**Open** — two infrastructure facts, per Q18, blocked on accounts that do not yet exist:

- **Supabase org capacity.** Whether the target Supabase org has room for another project (the free tier caps at 2 active projects per org, counted across all Owner/Admin members) is unconfirmed.
- **Exact Qwen model id.** `QWEN_MODEL=qwen3.7-flash` in `.env.example` is an untested default; the exact model id available on the Singapore Model Studio endpoint has not been confirmed against a live account.

See §19.

---

## 18. Traceability

**Status: `Specified`**

| Capability    | Realised By                                                                                                                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CAP-1**     | §12 (`note_and_gaps` operation), §3 (`SoapNoteSchema`), §13 (analyse route)                                                                                                                                                                                                                                            |
| **CAP-2**     | §12 (`note_and_gaps` operation — `gaps`), §3 (`InformationGapSchema`), §13 (`PATCH` route — `reviewedGapIds`), §4 (proposed `Consultation.reviewedGapIds`)                                                                                                                                                             |
| **CAP-3**     | §10 (Red-Flag Rules Engine — authoritative), §12 (`suggestions_and_red_flags` — model candidates), §3 (`RedFlagSchema`)                                                                                                                                                                                                |
| **CAP-4**     | §11 (Guideline Corpus), §12 (`suggestions_and_red_flags`), §3 (`ClinicalSuggestionSchema`, `citations.min(1)`), §13 (`GET /api/guidelines`)                                                                                                                                                                            |
| **CAP-5**     | §13 (`PATCH` and `/approve` routes), §4 (`Consultation.editedNote`/`approvedAt`), §15 (Audit Logging)                                                                                                                                                                                                                  |
| Cross-cutting | §2 (module boundaries), §5 (PHI boundary), §6 (LLM adapter), §7 (environment contract), §8 (HTTP surface as built), §9 (de-identification), §14 (auth model), §16 (security controls), §17 (environments & deployment) — these underwrite `docs/prd.md`'s Safety Constraints as a whole rather than any single `CAP-n` |

---

## 19. Open Decisions Register

**Status: `Specified`**

Every `Open` item in this document, collected in one place.

| #   | Question                                                                                                                                                                                                                    | Section | What Would Unblock It                                                                                                                                                                                                    | Owner                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | Should `markDeidentified` stop being exported, or be locked down another way?                                                                                                                                               | §5      | Deciding between an ESLint import-restriction rule, removing the export, or accepting the risk behind the existing PR Clinical-Safety Checklist                                                                          | PL, next `deid/` implementation task                     |
| 2   | What should "fail closed" actually do at the point a request leaves the process?                                                                                                                                            | §7      | Deciding the behaviour when `DEID_FAIL_CLOSED` is true and detection is incomplete or the vault is empty, then wiring it into `OpenAICompatibleClient`                                                                   | PG, next `deid/`/`lib/llm/` implementation task          |
| 3   | Which guideline sources may be quoted verbatim versus summarised only?                                                                                                                                                      | §11     | Human confirmation of the redistribution/licensing stance per source (Q6)                                                                                                                                                | Human (licensing call)                                   |
| 4   | Should better-auth's `/api/auth/sign-up/email` route be disabled at config level?                                                                                                                                           | §14     | Confirming the correct better-auth configuration option against the installed version at implementation time                                                                                                             | PG, auth implementation task                             |
| 5   | Does the target Supabase org have room for another project?                                                                                                                                                                 | §17     | Creating/confirming the Supabase org and counting active projects against the free-tier cap                                                                                                                              | Human (account setup)                                    |
| 6   | What is the exact Qwen model id available on the Singapore Model Studio endpoint?                                                                                                                                           | §17     | Creating the Model Studio account and confirming available model ids against the untested `.env.example` / `render.yaml` default (`qwen3.7-flash`, already committed to the deploy config)                               | Human (account setup)                                    |
| 7   | How does the review screen distinguish "out of scope, suggestions suppressed" from "in scope, nothing to suggest" for the Clinical-Scope notice (`docs/prd.md`)?                                                            | §12     | Deciding whether to add an explicit signal (e.g. `outOfScope: boolean`) to the analysis response, versus inferring it from an empty `suggestions` array                                                                  | PL, next `suggestions_and_red_flags` implementation task |
| 8   | Does the 30s / 3,000-word analysis target (CAP-1, `docs/prd.md`) hold given §12's two sequential LLM calls, the second carrying the full guideline corpus in the system prompt against a free-tier flash model?             | §12     | Human ratification of the number as-is, or a benchmark-driven latency budget split across the two operations                                                                                                             | Human (target ratification)                              |
| 9   | Should `LLM_PROVIDER=deepseek` be guarded in production the same way `gemini` is, given DeepSeek's PRC hosting and the PDPA 2010 s.129 cross-border question `docs/README.md` already names?                                | §7      | Deciding whether to add a production guard in `env.ts`, restrict DeepSeek to benchmarking-only tooling, or accept the risk explicitly                                                                                    | PL, next `config/env.ts` implementation task             |
| 10  | Should `SoapNoteSchema` move from four free-text strings to a structured, per-field clinical-information schema with explicit assertion states, to support the Unknown ≠ Negative rule (`docs/prd.md`, Safety Constraints)? | §3      | Human ratification of the schema redesign — structured fields make Unknown ≠ Negative machine-checkable at the cost of losing the free-text note's simpler read; this is a product trade-off, not an engineering default | Human (schema redesign ratification)                     |
| 11  | What retention period and deletion/access-request mechanism should apply before real patient data is stored, and when should the mandated DPIA be performed?                                                                | §4      | Human decision on a retention period, design of a deletion/access-request path, and scheduling the DPIA ahead of any production deployment                                                                               | Human (retention policy + DPIA)                          |
| 12  | Should automated CI (lint/typecheck/test, previously `.github/workflows/ci.yml`) be reinstated, and on what trigger?                                                                                                        | §17     | Human decision on whether CI is worth the Actions minutes/scope for a prototype evaluated externally, and if so, restoring the workflow definition                                                                       | Human (CI decision)                                      |
