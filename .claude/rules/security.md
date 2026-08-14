---
paths:
  - "backend/src/deid/**"
  - "backend/src/lib/llm/**"
  - "backend/src/redflags/**"
  - "backend/src/guidelines/**"
  - "backend/src/routes/**"
  - "backend/src/middleware/**"
  - "backend/src/audit/**"
  - "backend/src/config/**"
  - "backend/src/app.ts"
  - "prisma/**"
  - "frontend/src/lib/**"
  - ".github/workflows/**"
---

# Security Rules

ai-clinical-assistant handles simulated GP consultation data today, and is built to the standard required to handle real data later. Every rule below names a real file or symbol so it can be checked, not merely agreed with.

**The framing claim that governs everything else:** de-identification is risk reduction, not anonymisation. Tokenised text is still protected health information (`docs/dpia.md`, "Plain-Language De-Identification Statement"). Never write code, comments, or docs implying that de-identified content is safe to treat casually.

## The PHI Boundary

The trust boundary is a **type**, backed by a runtime check. Both halves matter.

- `Deidentified` (`backend/src/deid/types.ts`) is a branded string. `LLMClient.generate` takes `content: Deidentified`, so passing a raw `string` is a compile error.
- The minting function `markDeidentified` (`backend/src/deid/index.ts`) is **deliberately not exported**. Only `deidentify()` can produce the brand. Do not export it, and do not add a second minting path.
- **A `value as Deidentified` cast is a review-blocking defect**, not a style problem. The compiler cannot stop it; that is exactly why the runtime guard exists.
- `assertNoIdentifiers(content, operation)` (`backend/src/deid/index.ts`) is the runtime backstop: it strips minted tokens, re-runs `detect()`, and throws `DeidentificationError` naming **detector labels only, never matched values**. Preserve that property in any change to the message.
- Detectors are `PATIENT`, `NRIC`, `PHONE`, `ADDRESS`, `DOB`, `MRN`, `EMAIL` (`backend/src/deid/detectors.ts`). Adding a detector means adding fixtures in `backend/src/fixtures/` and a case in `backend/src/deid/deid.test.ts`. Lowering `ACCEPT_THRESHOLD` needs a precision test, not just a recall one.
- The vault is request-scoped by construction (`RequestTokenVault`, `backend/src/deid/vault.ts`). It is never persisted, never logged, and never a singleton. `deidentify(text, vault)` accepts a caller-supplied vault: **only ever pass one that dies with the request.** A vault that outlives a request is a cross-patient token-collision bug.
- `DEID_FAIL_CLOSED=false` is for unit tests only. Production throws at boot if it is unset or false (`backend/src/config/env.ts`).

## LLM Egress

Maps to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Improper Output Handling, LLM10 Unbounded Consumption.

- `LLMClient` is the **only** egress point. Exactly one provider SDK import exists repo-wide: `import OpenAI from 'openai'` in `backend/src/lib/llm/openai-compatible.ts`. A second one anywhere is a critical defect.
- All three providers share one adapter class, `OpenAICompatibleClient`. They differ only by `baseURL` and model, selected in `build()` (`backend/src/lib/llm/index.ts`). Do not fork per-provider client code; add configuration.
- API keys are read only through `env` (`backend/src/config/env.ts`). No `process.env` access for a key anywhere else.
- Production boot guards exist for a reason and must not be relaxed: `LLM_PROVIDER=gemini` throws (free-tier terms permit Google to use submitted content for product improvement and human review), and `LLM_PROVIDER=deepseek` throws (PRC hosting, PDPA 2010 s.129 cross-border transfer).
- **The transcript is untrusted input.** A patient or a dictation can contain text shaped like an instruction. The control is the response schema, not the prompt wording: closed schemas, enums, and no free-text escape hatch. Prompt-level defenses fail silently and do not count as controls.
- Every model response is validated with `request.schema.safeParse` inside the adapter before it reaches a route. Never act on unparsed model output.
- Schema failure messages can embed model output. They are currently contained because the route collapses them into a generic `HttpError(500, 'analysis_failed')` and the logger never writes `err.message`. Keep both ends of that.
- **Request bounds are on the constructor, and belong there** (issue #94). `timeout: 60_000` and `maxRetries: 1` replace SDK defaults of 10 minutes and 2 retries, which compounded to roughly 30 minutes per operation because the SDK retries timeouts. Constructor-level, not per-request, so every call path inherits them. Do not move them to a call site, and do not add a provider that bypasses `OpenAICompatibleClient`. Pinned by `backend/src/lib/llm/openai-compatible.test.ts` (OWASP LLM10 Unbounded Consumption).
- **Not built today:** no `AbortController`, so a client disconnect does not cancel an in-flight provider call. That is a quota control, not a bound on hang time; the timeout above is what bounds the hang.

## Clinical Safety Invariants

- **The model may never suppress a deterministic red flag.** `mergeRedFlags` (`backend/src/redflags/evaluate.ts`) is a pure `ruleFlags.concat(modelCandidates)`. Adding a filter, dedupe, sort, or severity comparison to it breaks the safety invariant and the tests in `backend/src/redflags/evaluate.test.ts` that pin it.
- Rule evaluation runs on the raw transcript **before** the LLM calls, never on model output. Keep that ordering in `backend/src/routes/consultations.ts`.
- `makeSuggestionsAndRedFlagsSchema` pins model red flags to `source: z.literal('model')` with `ruleId` omitted, so a model response structurally cannot impersonate a rule hit.
- **Citations are ID-constrained.** `corpusIdsFor()` (`backend/src/guidelines/corpus.ts`) feeds `z.enum(corpusIds)`, so a hallucinated or free-text reference fails schema validation before it reaches a route. Never widen `guidelineId` to a plain string.
- `serialiseCorpusForPrompt` sends only `id`, `title`, and `summary` to the model. Do not add `url`, `sourceLicence`, or `verbatimAllowed`.
- A chunk whose licence sets `verbatimAllowed: false` must never carry a `quote`. The corpus is parsed at import time, so a violation fails at module load.
- The red-flag engine stays a pure function library: no I/O, no clock, no LLM. `RED_FLAG_LIST_VERSION` and `GUIDELINE_CORPUS_VERSION` are stamped into audit metadata; bump them when the clinical content changes.
- **No output is a diagnosis, and no note self-approves.** Doctor approval is an explicit state transition (`POST /api/consultations/:id/approve`), never a default.

## Authentication And Access Control

OWASP A01:2025 Broken Access Control is still the number one risk, and object-level authorization is where APIs lose it.

- Auth is better-auth on the Prisma adapter (`backend/src/lib/auth.ts`). `BETTER_AUTH_SECRET` is `min(32)` and required; generate with `openssl rand -base64 32`. Never commit one.
- `trustedOrigins` is `[env.CORS_ORIGIN]`. Never add localhost to a production value.
- Cookies are `httpOnly`, `secure`, and `sameSite: 'none'` in production. `'none'` is **required**, not sloppy: the SPA and API are on different origins (Vercel and Render). The cost is that `SameSite` provides no CSRF protection here, so origin trust rests entirely on the single-origin CORS policy plus `trustedOrigins`. Widening `CORS_ORIGIN` to a list, a wildcard, or a reflected origin removes the only remaining control.
- **Every route that accepts an `:id` must resolve it through `assertOwnedConsultation(id, doctorId)`** (`backend/src/lib/authz.ts`). It scopes on `doctorId` and `erasedAt: null`, and returns **404, never 403**, so the API is not an existence oracle. Do not "improve" that to 403.
- New protected routes must sit under a prefix in `PROTECTED_PREFIXES` (`backend/src/app.ts`) or mount `requireSession` explicitly. Authentication is per-prefix, not global; a new top-level prefix is unauthenticated by default.
- There is **no role model and no tenant scoping**. `User` has no `role` column, and `Consultation.doctorId` is the only scoping axis. Any feature needing an admin or clinic boundary needs a schema change and a migration first; do not fake it with a hardcoded email or env var.
- **Not built today:** no email verification (`requireEmailVerification: false`) with open self-service sign-up, and `POST /api/auth/guest` is limited by neither `express-rate-limit` nor better-auth (it is registered ahead of the better-auth catch-all). Treat both as known exposure when adding anything that costs money or writes data.

## HTTP Surface

- Already registered in `backend/src/app.ts` and not to be removed: `trust proxy`, `requestContext`, `helmet()`, `cors({ origin: env.CORS_ORIGIN, credentials: true })`, `express.json({ limit: '1mb' })`, and `errorHandler` last.
- **Zod at every boundary.** Request bodies parse before the first DB call; responses parse before they are sent. Types come from `z.infer`, never hand-written alongside a schema. Shared contracts live in `shared/`; never redeclare one locally.
- Errors leave through `ErrorEnvelopeSchema` shape only. `errorHandler` collapses any non-`HttpError` to a generic 500 and never reads `err.message` or `err.stack`. Do not add a branch that forwards a raw error, a Prisma message, or a stack to the client, in any environment (OWASP A10:2025 Mishandling of Exceptional Conditions).
- **There is no global rate limiter.** Only `POST /api/consultations/:id/analyze` is limited (`analyzeRateLimit`, 10/min, `backend/src/middleware/rate-limit.ts`). Any new route that writes, costs money, or calls the LLM must register its own limiter. Key on `clientKey`, which prefers `cf-connecting-ip` over `x-forwarded-for`.
- Client-supplied `x-request-id` is echoed only when it matches `SAFE_REQUEST_ID`. Never relax that pattern; it is what stops log-line forgery.
- `TranscriptSchema` has no `.max()` on turn count or text length, so the 1 MB body limit is the only bound. Add explicit caps before accepting any untrusted upload path.
- `GET /api/health` is unauthenticated and returns the configured provider name. Do not add anything else to it.

## Data And Persistence

- All queries go through Prisma, which parameterises by design. **No `$queryRawUnsafe`, no `$executeRawUnsafe`, no template-string SQL.** If `$queryRaw` is genuinely needed, use the tagged-template form and never interpolate user input.
- `DATABASE_URL` is the pooled Supavisor URL for the app; `DIRECT_URL` is for migrations only. Do not swap them.
- PHI lives in `Consultation.transcript`, `Consultation.analysis`, and `Consultation.editedNote` (all `Json?`). Select only what a caller needs; do not widen a response to the whole row for convenience.
- Erasure is a tombstone: `eraseConsultation()` (`backend/src/audit/erasure.ts`) nulls the three PHI columns and sets `erasedAt`. The `AuditEvent.consultationId` relation is `onDelete: Restrict` **because `consultationId` is a hash-chain input**; a cascading delete would break tamper evidence. Do not change it to `Cascade`.
- Every new migration that adds a PHI-bearing column must state which of the three erasure targets it joins, and update `eraseConsultation` if it is a fourth.
- **Not built today:** no retention job, no TTL, no deletion or access-request endpoint. `eraseConsultation` exists but no router calls it. **Never invent a retention period**; it is an owner-assigned decision that is deliberately open (`docs/dpia.md`, "Open Retention Decision").

## Secrets, Logging, Audit

OWASP A09:2025 Security Logging and Alerting Failures cuts both ways here: too little logging hides incidents, and too much logging is itself the breach.

- `.env` is gitignored and `.env.example` is committed with blank placeholders. Note the gap: `.gitignore` covers `.env`, `.env.local`, and `.env.*.local`, but **not** `.env.production` or `.env.development`. Do not create those filenames.
- Never commit a key, a connection string, or a `BETTER_AUTH_SECRET`. Deployment secrets are `sync: false` in `render.yaml` and set in the dashboard.
- Engagement terms, client names, and commercial figures stay out of tracked files, commits, issues, and PR bodies. CI enforces this in the "Confidentiality check" step.
- **The logger is a positive allowlist**, not a denylist (`backend/src/lib/logger.ts`). Seventeen field names are permitted, each constrained to an enum, an identifier pattern, or a number. **No field accepts free text.** Adding a field means adding a `FIELD_RULES` entry plus a `LogFields` member, and the drift test will fail if you add only one.
- `LOG_LEVEL` is verbosity only. Never add a flag, level, or debug branch that widens what may be written.
- Never log transcript bodies, note contents, gap or suggestion text, vault entries, `err.message`, `err.stack`, or a request body. Log IDs, event types, detector labels, and counts.
- `AuditEvent.metadata` carries detector **labels** only, never values. Audit writes go through `recordAuditEvent`; `backend/src/audit/no-stray-audit-writes.test.ts` fails the build on a direct write.
- The hash chain (`seq`, `prevHash`, `hash`) is tamper-evident, not tamper-proof, and `metadata` is deliberately outside the hash. Do not overstate it in code comments or docs.

## Frontend

- **No `dangerouslySetInnerHTML`, no `eval`, no `new Function`.** There are currently zero occurrences repo-wide; keep it that way.
- `localStorage` is for the theme key only (`frontend/src/lib/theme.tsx`). **No clinical content in `localStorage`, `sessionStorage`, or IndexedDB**, and no TanStack Query persister. The query cache is in-memory and must die on reload.
- Auth is cookie-based. `frontend/src/lib/api.ts` sets `credentials: 'include'` and reads no token. Never introduce an `Authorization` header, and never store a session value in JS-reachable storage.
- Every API response is `safeParse`d before render, failing to `ApiError(status, 'invalid_response')`. Do not render an unvalidated payload optimistically.
- Only `VITE_*` env vars reach the bundle. Anything named `VITE_*` is public: no secret ever gets that prefix.
- **The SPA origin sends its own headers** from the `headers` block in `vercel.json`: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options and COOP. The API is separately covered by `helmet()`. Two entries in that policy are load-bearing and must not be trimmed as unused: `'wasm-unsafe-eval'` in `script-src`, without which the in-browser speech model cannot instantiate, and `microphone=(self)` in `Permissions-Policy`, without which recording is refused before any code runs. `connect-src` must keep `https://*.hf.co`, because HuggingFace redirects model downloads to hosts like `us.aws.cdn.hf.co` that are not under `huggingface.co`.
- **Do not add `Cross-Origin-Embedder-Policy`.** It would require every cross-origin response the speech model fetches to carry CORP, which the HuggingFace CDN does not send, and would break transcription for a header the app gains nothing from today.

## Supply Chain And CI

OWASP promoted Software Supply Chain Failures to A03:2025, and it is this repo's largest genuine gap.

- CI installs with `bun install --frozen-lockfile`. Never loosen that, and always commit `bun.lock` with a dependency change.
- **Pin GitHub Actions to commit SHAs.** `ci.yml` currently uses floating major tags (`actions/checkout@v4`, `oven-sh/setup-bun@v2`); convert them when you next touch the workflow, and add new actions SHA-pinned from the start.
- Before adding a dependency: prefer well-known, actively maintained packages, check open advisories, and avoid versions published in the last few days. Most malicious releases are pulled within hours, so a short cooldown catches them.
- Keep the CI secret surface at one entry (`secrets.VERCEL_TOKEN`). Project and org IDs are identifiers, not credentials, and stay inline.
- **Not built today:** no `bun audit`, no Dependabot or Renovate, no secret scanning, no SAST. The "Confidentiality check" greps engagement terms, not credentials. State this as an open gap rather than implying coverage.
- **Architectural invariants are enforced by source-scanning guard tests.** Three exist: `backend/src/audit/no-stray-audit-writes.test.ts`, `backend/src/clinical-versions/no-stray-clinical-constants.test.ts`, and `backend/src/lib/llm/no-stray-provider-sdk.test.ts`, which pins the single-provider-SDK rule under "LLM Egress" above. Follow that shape for any invariant the type system cannot express, and check the open issues rather than this line for which one is worth writing next.

## Changes That Need Explicit Human Sign-Off

Document the reason in the PR and ask before merging:

- Any new path from raw transcript text toward a provider, or any second provider SDK import.
- Exporting `markDeidentified`, adding a `as Deidentified` cast, or making `assertNoIdentifiers` unconditional on anything new.
- Relaxing a production boot guard, or setting `DEID_FAIL_CLOSED=false` outside a unit test.
- Any filtering, ordering, or deduplication inside `mergeRedFlags`.
- Widening `guidelineId` beyond `z.enum(corpusIds)`.
- Turning `assertOwnedConsultation` into a 403, or adding a route with `:id` that skips it.
- Widening `CORS_ORIGIN` beyond a single origin, or adding an origin to `trustedOrigins`.
- Adding a logger field, log level, or debug branch that widens what may be written.
- Committing a retention period, or any doc wording that calls de-identified data anonymous.

## See Also

These are the deeper references. Read them rather than duplicating them here.

- `AGENTS.md` "Critical Do-Nots" is the canonical statement; this file is the enforceable mechanics behind it.
- `.claude/skills/healthcare-phi-compliance/` before touching `deid/`, `AuditEvent`, or access control.
- `.claude/skills/healthcare-cdss-patterns/` before touching `redflags/` or any clinical scoring.
- `.claude/skills/better-auth-security-best-practices/` before touching auth wiring.
- `.claude/skills/cso/` for a full OWASP and STRIDE audit pass, invoked on demand.
- `docs/trd.md` for implementation detail. Sections 4 and 16 are stale on the audit cascade and on helmet, rate limiting, and CI; trust the code.
- `docs/dpia.md` for the privacy position, the processor and residency table, and the open residual-risk register.
- `.github/PULL_REQUEST_TEMPLATE.md` Clinical-Safety Checklist is mandatory when the diff touches `deid/`, `lib/llm/`, `redflags/`, `guidelines/`, or logging.
