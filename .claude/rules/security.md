---
paths:
  - 'backend/src/deid/**'
  - 'backend/src/lib/llm/**'
  - 'backend/src/redflags/**'
  - 'backend/src/guidelines/**'
  - 'backend/src/routes/**'
  - 'backend/src/middleware/**'
  - 'backend/src/audit/**'
  - 'backend/src/config/**'
  - 'backend/src/app.ts'
  - 'prisma/**'
  - 'frontend/src/lib/**'
  - 'frontend/src/audio/live/**'
  - '.github/workflows/**'
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

- `LLMClient` is the **only text egress point**, and the ASR relay (next section) is the only audio one. Exactly one provider SDK import exists repo-wide: `import OpenAI from 'openai'` in `backend/src/lib/llm/openai-compatible.ts`. A second one anywhere is a critical defect.
- All three providers share one adapter class, `OpenAICompatibleClient`. They differ only by `baseURL` and model, selected in `build()` (`backend/src/lib/llm/index.ts`). Do not fork per-provider client code; add configuration.
- API keys are read only through `env` (`backend/src/config/env.ts`). No `process.env` access for a key anywhere else.
- Production boot guards exist for a reason and must not be relaxed: `LLM_PROVIDER=gemini` throws (free-tier terms permit Google to use submitted content for product improvement and human review), and `LLM_PROVIDER=deepseek` throws (PRC hosting, PDPA 2010 s.129 cross-border transfer).
- **The transcript is untrusted input.** A patient or a dictation can contain text shaped like an instruction. The control is the response schema, not the prompt wording: closed schemas, enums, and no free-text escape hatch. Prompt-level defenses fail silently and do not count as controls.
- Every model response is validated with `request.schema.safeParse` inside the adapter before it reaches a route. Never act on unparsed model output.
- Schema failure messages can embed model output. They are currently contained because the route collapses them into a generic `HttpError(500, 'analysis_failed')` and the logger never writes `err.message`. Keep both ends of that.
- **Request bounds are on the constructor, and belong there** (issue #94). `timeout: 60_000` and `maxRetries: 1` replace SDK defaults of 10 minutes and 2 retries, which compounded to roughly 30 minutes per operation because the SDK retries timeouts. Constructor-level, not per-request, so every call path inherits them. Do not move them to a call site, and do not add a provider that bypasses `OpenAICompatibleClient`. Pinned by `backend/src/lib/llm/openai-compatible.test.ts` (OWASP LLM10 Unbounded Consumption).
- **Not built today:** no `AbortController`, so a client disconnect does not cancel an in-flight provider call. That is a quota control, not a bound on hang time; the timeout above is what bounds the hang.

## ASR Egress

**There are two audio egresses, and they are different shapes.** The hosted relay carries a finished recording through the API to ILMU (#154). Ambient capture streams the consultation from the browser straight to Soniox, under a key the API mints (#268, `docs/trd.md` §20.10). Audio cannot be de-identified, so both are governed by bounds, audit, and per-consultation consent rather than by a gate.

The consent rule is identical on both and is two controls, needing both: a standing device preference in `localStorage` (the engine for the relay, the capture mode for ambient) and a per-consultation tick in plain `useState` that dies with the component (#155, restored by #254 after #228 briefly collapsed the two into one remembered setting). It is client-side only, because the API still enforces no consent signal. On the relay the tick is enforced in `AudioCapture`'s transcribe dispatcher rather than only on the controls, because the engine can change mid-recording and a disabled button cannot catch that; on ambient it is enforced in `AmbientCapture`'s start dispatcher for the same reason. Never fold the tick back into the preference, and never let either dispatcher fall through to another path instead of refusing.

After either path, the transcript text may additionally leave through `LLMClient` as the `draft_turns` operation (`POST /api/asr/draft-turns`, #189). That second egress is text, not audio, so it takes the standard deid gate, and it adds a reconstruction guard (`backend/src/draft-turns/reconstruction.ts`) that re-slices every drafted turn from the input, so the model can label speech but never rewrite it; it carries its own limiter (`draftTurnsRateLimit`) and the `asr.hosted_draft_labelled` / `asr.hosted_draft_failed` audit pair, content never included.

**A third text egress exists and is the one that may propose word changes**: the `transcript_cleanup` operation (`backend/src/transcript-cleanup/`, reached from `POST /api/consultations/:id/transcript-corrections`, #309). It goes deid then `LLMClient` exactly as `draft_turns` does, and `sliceDeidentified` chunks it **after** the gate, never before. What it does not have is a reconstruction guard, because unlike `draft_turns` its whole purpose is to change a word, so the controls are different in kind and all of them live in `backend/src/transcript-cleanup/policy.ts`:

- The model-facing schema carries `original` and `replacement` and nothing else. No `turnIndex`, `start`, `end`, `id` or `source`, so a response cannot assert a position or claim it came from the measured table. Positions are resolved server-side by locating the text, which is also the only approach that survives rehydration.
- An edit is dropped unless its span **overlaps a range the recogniser itself marked uncertain** (`TranscriptTurn.uncertain`, #309). A transcript with no such ranges never reaches a provider at all: the gate is checked before de-identification.
- **A `model` edit is dropped if accepting it would take a red flag away, and the check is differential, not positional.** For each candidate, `applyEditPolicy` runs `evaluateRedFlags` over the transcript that accepting it would produce and refuses any proposal that loses a rule id the transcript raised before. Protecting each fired flag's evidence span is **not** sufficient and was the first design: whether a match becomes a flag depends on text outside the span it matched, since `isNegated` reads 60 characters before it, `isSafetyNetting` 120, and `asserts` and `findDeniedAbility` read the neighbouring turn. A one-word edit turning "Ada" into "Tiada" outside the evidence span silently removes an emergency flag, and every span-based bound admits it. A `source: 'mishear'` proposal is exempt, because the engine already expands the table internally, so a flag matched on a table pair fired because of the corrected reading; `policy.test.ts` pins that as a property rather than an argument.
- **The trigger set is chosen inside `policy.ts`, never passed in.** It was a parameter taking the caller's clinical profile, and that was a hole: `profile.redFlagTriggers` is a filtered slice, the two shipped profiles share one trigger of twelve, and `profileId` arrived in the request body while nothing ties a consultation to the profile it was analysed under. `ALL_REDFLAG_TRIGGERS` is the only safe set, and over-protecting can only drop more model edits. `mergeRedFlags` itself remains untouched.
- Further drops, silent and counted: an ambiguous or absent anchor, a replacement failing the character class, a no-op, a word delta above one, and an oversized anchor.
- `TRANSCRIPT_CLEANUP` gates the whole pass and **defaults to `off`** (`docs/trd.md` §20.9 makes it conditional on a measurement). Its failure never removes the deterministic proposals: the route answers 200 with `cleanup: 'failed'`, because layer 2 ships unconditionally.

### The Relay, Which Carries Audio

- `backend/src/routes/asr.ts` calling `transcribeWithIlmu` (`backend/src/lib/asr/ilmu.ts`) is the only path audio may take **out of the API**; ambient audio never enters it. No other module may call an ASR provider, and a provider SDK import here is a critical defect. **Two guards enforce this rather than review alone** (issue #172): `backend/src/lib/asr/no-stray-fetch.test.ts` pins the per-file inventory of outbound `fetch` calls in `backend/src`, today exactly two, one in `ilmu.ts` carrying audio and one in `soniox.ts` carrying only a key; and `no-stray-provider-sdk.test.ts`'s package inventory now names transcription vendors alongside LLM ones, so an ASR SDK trips the same guard. The relay is native fetch by design, because ILMU publishes no SDK, which is why the call site needed a guard of its own: an SDK inventory structurally cannot see an egress that imports nothing.
- `ILMU_API_KEY` is read only through `env`. Key unset means the route fails closed and visibly: 503 `asr_unavailable`, before any body is buffered and with no upstream call.
- Nothing is persisted and no content is logged on this path. The audio exists in request-scoped memory only, the log line carries allowlisted fields only, and the audit pair (`asr.hosted_relayed` / `asr.hosted_relay_failed`) records billed seconds, a model id, and a closed failure reason, never content. The upstream response body is never read on a failure path, and a redirect is refused rather than followed, because on this route a request body is patient audio and a response body is a transcript.
- Bounds, all of them deliberate: a route-level `express.raw` cap of 25 MB with `inflate: false` (ILMU's own request cap, unforgeable via `Content-Encoding`), the dedicated `hostedAsrRateLimit` (5/min per `clientKey`), a process-wide in-flight gate (`MAX_CONCURRENT_RELAYS`, 503 when full, because the per-key limiter cannot bound memory), a 120 s `AbortSignal.timeout`, and no retries.
- The success audit write happens before the response and unguarded, so a relay the trail did not record is never observable by a client. Pre-flight rejections (401, 415, 400, our own 413 and 429, busy or key-unset 503) write no audit row because the upstream call was never attempted; every post-attempt failure writes `asr.hosted_relay_failed`.
- **Not built today:** no per-actor or global spend cap. The route is a paid egress reachable by any self-service or guest session, bounded per caller by the limiter and per process by the in-flight gate only, which matches the `analyzeRateLimit` posture. State it as a gap rather than implying coverage.

### Ambient Capture, Which Does Not

The browser holds the socket. A WebSocket cannot cross the Vercel rewrite that makes the session cookie first-party (#156), and a direct browser-to-Render socket would lose that cookie, so the audio never reaches our servers at all. **The API does not stop being the policy point.** It decides who may stream, how often, for how long, and what is written down.

- `backend/src/lib/asr/soniox.ts` is the only backend module that may talk to Soniox, and it carries no audio: it mints a temporary key and nothing else. `frontend/src/audio/live/soniox-stream.ts` is the only module in the SPA that may hold a socket. **Three guards enforce this rather than review alone**: `no-stray-fetch.test.ts` pins the backend call at one, `no-stray-provider-sdk.test.ts` scopes `@soniox/` so neither vendor SDK can be imported, and `frontend/src/audio/live/no-stray-websocket.test.ts` pins `new WebSocket(` to that one module. The last is new in kind: it is the first guard covering an egress no server-side check can observe.
- `SONIOX_API_KEY` is read only through `env`. Key unset means both routes fail closed and visibly: 503 `asr_unavailable`, and the capture surface says so and offers press-to-record instead.
- `SONIOX_REGION` is an enum and hostnames are literals in the adapter. Never build a provider hostname from a free-text variable: this value travels to the browser and tells it where to send patient audio. The shared `LIVE_ASR_WEBSOCKET_URL` pattern makes the client refuse any other address even from our own API, and the CSP `connect-src` in `vercel.json` pins the configured host at the platform layer. Redirecting this egress therefore takes a bad response **and** a CSP change.
- The key is bounded twice: `TEMPORARY_KEY_TTL_SECONDS` (30) is how long it may open connections, and `MAX_SESSION_DURATION_SECONDS` (1800) is how long each connection it opened may live. **Measured 06/09/26: one key opens more than one connection**, so the second number bounds a stream and not a caller, and the first is what narrows the window. Do not lengthen either without re-reading `docs/trd.md` §20.10. A server-generated `client_reference_id` is bound to it by the provider and cannot be overridden by whoever holds it, which is what reconciles our audit row against their usage log.
- Nothing is persisted and no content is logged. The audit pair (`asr.live_session_minted` / `asr.live_session_failed`) records a reference id, a model, a region, the session cap and the client's consent assertion, never content. The success write happens before the response and unguarded, so a key the trail did not record is never observable by a client; pre-flight rejections write no row.
- **The provider's `error_message` is structurally unable to leak.** It is omitted from the wire schema in `soniox-stream.ts`, so Zod strips it, and on this path an error body can name a credential. A failure is a value from a closed enum. Never widen that schema to carry vendor text.
- **Not built today:** no global or per-actor spend cap, and the per-session one does not substitute for it because a key can open several sessions; no server-side consent signal, no reconnect (#256, so a dropped socket keeps the settled text and stops), and no Safari verification. State these as gaps rather than implying coverage.

## Clinical Safety Invariants

- **The model may never suppress a deterministic red flag.** `mergeRedFlags` (`backend/src/redflags/evaluate.ts`) is a pure `ruleFlags.concat(modelCandidates)`. Adding a filter, dedupe, sort, or severity comparison to it breaks the safety invariant and the tests in `backend/src/redflags/evaluate.test.ts` that pin it.
- Rule evaluation runs on the raw transcript **before** the LLM calls, never on model output. Keep that ordering in `backend/src/routes/consultations.ts`.
- `makeSuggestionsAndRedFlagsSchema` pins model red flags to `source: z.literal('model')` with `ruleId` omitted, so a model response structurally cannot impersonate a rule hit.
- **Citations are ID-constrained.** `corpusIdsFor()` (`backend/src/guidelines/documents.ts`) feeds `z.enum(corpusIds)`, so a hallucinated or free-text reference fails schema validation before it reaches a route. Never widen `guidelineId` to a plain string.
- `serialiseCorpusForPrompt` sends only `id`, `title`, and `summary` to the model. Do not add `url`, `sourceLicence`, or `verbatimAllowed`.
- A chunk whose licence sets `verbatimAllowed: false` must never carry a `quote`. `GuidelineChunkSchema` enforces this at parse time, so a violation fails before a chunk reaches a route.
- The red-flag engine stays a pure function library: no I/O, no clock, no LLM. `RED_FLAG_LIST_VERSION` and `GUIDELINE_CORPUS_VERSION` are stamped into audit metadata; bump them when the clinical content changes.
- **No output is a diagnosis, and no note self-approves.** Doctor approval is an explicit state transition (`POST /api/consultations/:id/approve`), never a default.

## Authentication And Access Control

OWASP A01:2025 Broken Access Control is still the number one risk, and object-level authorization is where APIs lose it.

- Auth is better-auth on the Prisma adapter (`backend/src/lib/auth.ts`). `BETTER_AUTH_SECRET` is `min(32)` and required; generate with `openssl rand -base64 32`. Never commit one.
- `trustedOrigins` is `[env.CORS_ORIGIN]`. Never add localhost to a production value.
- Cookies are `httpOnly`, `secure` in production, and `sameSite: 'lax'`. `lax` is only correct because the browser reaches the API on the SPA's own origin (below); it was `none` while those were separate origins. Do not widen it back without also undoing that, and note that `none` costs the CSRF protection `SameSite` exists to give, leaving origin trust resting entirely on the single-origin CORS policy plus `trustedOrigins`. Widening `CORS_ORIGIN` to a list, a wildcard, or a reflected origin removes the only remaining control.
- **The browser must reach the API on the SPA's own origin.** `vercel.json` rewrites `/api/*` to Render, which is what makes the session cookie first-party; calling Render directly made it third-party and iOS discarded it, locking every mobile browser out of sign-in (#156). Setting `VITE_API_URL` in the Vercel project, or removing that rewrite, reintroduces the lockout with a green deploy and no error anywhere. Both are guarded in `ci.yml`. `'none'` is now looser than needed and `lax` would restore CSRF protection, but that swap is deliberately not bundled with #156.
- **Every route that accepts an `:id` must resolve it through `assertOwnedConsultation(id, doctorId)`** (`backend/src/lib/authz.ts`). It scopes on `doctorId` and `erasedAt: null`, and returns **404, never 403**, so the API is not an existence oracle. Do not "improve" that to 403.
- New protected routes must sit under a prefix in `PROTECTED_PREFIXES` (`backend/src/app.ts`) or mount `requireSession` explicitly. Authentication is per-prefix, not global; a new top-level prefix is unauthenticated by default.
- There is **no role model and no tenant scoping**. `User` has no `role` column, and `Consultation.doctorId` is the only scoping axis. Any feature needing an admin or clinic boundary needs a schema change and a migration first; do not fake it with a hardcoded email or env var.
- **Not built today:** no email verification (`requireEmailVerification: false`) with open self-service sign-up, and `POST /api/auth/guest` is limited by neither `express-rate-limit` nor better-auth (it is registered ahead of the better-auth catch-all). Treat both as known exposure when adding anything that costs money or writes data.

## HTTP Surface

- Already registered in `backend/src/app.ts` and not to be removed: `trust proxy`, `requestContext`, `helmet()`, `cors({ origin: env.CORS_ORIGIN, credentials: true })`, `express.json({ limit: '1mb' })`, and `errorHandler` last.
- **Zod at every boundary.** Request bodies parse before the first DB call; responses parse before they are sent. Types come from `z.infer`, never hand-written alongside a schema. Shared contracts live in `shared/`; never redeclare one locally.
- Errors leave through `ErrorEnvelopeSchema` shape only. `errorHandler` collapses any non-`HttpError` to a generic 500 and never reads `err.message` or `err.stack`. Do not add a branch that forwards a raw error, a Prisma message, or a stack to the client, in any environment (OWASP A10:2025 Mishandling of Exceptional Conditions).
- **There is no global rate limiter.** Only `POST /api/consultations/:id/analyze` is limited (`analyzeRateLimit`, 10/min, `backend/src/middleware/rate-limit.ts`). Any new route that writes, costs money, or calls the LLM must register its own limiter. Key on `clientKey`, which reads the address `middleware/client-ip.ts` resolved. That module is the only place allowed to decide which forwarding header to believe: `cf-connecting-ip` cannot be forged and wins by default, and `x-forwarded-for` is read only when the peer is in `TRUSTED_PROXY_IPS`, because the API is publicly reachable and a direct caller can otherwise forge it to get a fresh bucket per request. Never re-derive a caller address anywhere else.
- Client-supplied `x-request-id` is echoed only when it matches `SAFE_REQUEST_ID`. Never relax that pattern; it is what stops log-line forgery.
- `TranscriptSchema` has no `.max()` on turn count or text length, so the 1 MB body limit is the only bound. Add explicit caps before accepting any untrusted upload path.
- `GET /api/health` is unauthenticated and returns the configured provider name. Do not add anything else to it.

## Data And Persistence

- All queries go through Prisma, which parameterises by design. **No `$queryRawUnsafe`, no `$executeRawUnsafe`, no template-string SQL.** If `$queryRaw` is genuinely needed, use the tagged-template form and never interpolate user input.
- `DATABASE_URL` is the pooled Supavisor URL for the app; `DIRECT_URL` is for migrations only. Do not swap them.
- PHI lives in `Consultation.transcript`, `Consultation.analysis`, and `Consultation.editedNote` (all `Json?`). Select only what a caller needs; do not widen a response to the whole row for convenience.
- Erasure is a tombstone: `eraseConsultation()` (`backend/src/audit/erasure.ts`) nulls the three PHI columns and sets `erasedAt`. The `AuditEvent.consultationId` relation is `onDelete: Restrict` **because `consultationId` is a hash-chain input**; a cascading delete would break tamper evidence. Do not change it to `Cascade`.
- Every new migration that adds a PHI-bearing column must state which of the three erasure targets it joins, and update `eraseConsultation` if it is a fourth.
- **Built:** tombstone erasure through two routes. `POST /api/consultations/erase` batch-erases the caller's own consultations via `eraseConsultation`, and `POST /api/patients/:id/erase` erases a patient record and cascades to that patient's consultations via `erasePatient` (PR #212). Both null PHI columns and stamp `erasedAt`; neither deletes a row.
- **Built:** the retention period is recorded, per doctor, on `User.retentionYears` and edited through `GET`/`PATCH /api/settings/retention` (#80). `null` means the controller has not adopted a period and **must never be read as the default**: substituting one turns a convention into a decision nobody made. Every write records a `settings.retention_adopted` audit event carrying the value, withdrawal included, so the policy in force on a given date is attributable to an actor. That value is configuration rather than content, which is why it may sit in `metadata` at all.
- **Not built today:** no retention job, no TTL, no backup expiry, and no identity-verified access-request workflow. **Nothing enforces `retentionYears`**; storing the decision and acting on it are separate work.
- **Never invent a retention period** beyond the configurable default the owner has authorised, and **never state a legal position**: the default is a convention the clinic data controller must review, not a statutory requirement, and no code, comment, or doc may cite legislation for it (`docs/dpia.md`, "Open Retention Decision").

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
- **The SPA origin sends its own headers** from the `headers` block in `vercel.json`: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options and COOP. The API is separately covered by `helmet()`. Three entries in that policy are load-bearing and must not be trimmed as unused: `'wasm-unsafe-eval'` in `script-src`, without which the in-browser speech model cannot instantiate; `blob:` in `script-src`, without which ONNX Runtime cannot load its execution backend, which it fetches and then `import()`s from a `URL.createObjectURL` blob (a dynamic import is governed by `script-src`, **not** by `worker-src`, so `worker-src 'self' blob:` starts the worker and the backend load inside it is then blocked); and `microphone=(self)` in `Permissions-Policy`, without which recording is refused before any code runs. `connect-src` must keep `https://*.hf.co`, because HuggingFace redirects model downloads to hosts like `us.aws.cdn.hf.co` that are not under `huggingface.co`; and it must keep `wss://stt-rt.soniox.com`, without which ambient capture cannot open its socket at all. That entry is the exact host for the configured region and must never be widened to a wildcard: it is the platform-layer half of the pair that keeps this egress pointed at one place.
- **Verify a CSP change against the worker, not the UI.** The `blob:` omission above shipped and broke transcription for every cold-cache visitor, because the original check drove the Record tab in a browser whose `transformers-cache` was already warm, so the backend load never took the failing path. Construct the built worker directly and wait for `ready`; see `docs/trd.md` §17 for the snippet.
- **Do not add `Cross-Origin-Embedder-Policy`.** It would require every cross-origin response the speech model fetches to carry CORP, which the HuggingFace CDN does not send, and would break transcription for a header the app gains nothing from today.

## Supply Chain And CI

OWASP promoted Software Supply Chain Failures to A03:2025, and it is this repo's largest genuine gap.

- CI installs with `bun install --frozen-lockfile`. Never loosen that, and always commit `bun.lock` with a dependency change.
- **Pin GitHub Actions to commit SHAs.** `ci.yml` currently uses floating major tags (`actions/checkout@v4`, `oven-sh/setup-bun@v2`); convert them when you next touch the workflow, and add new actions SHA-pinned from the start.
- Before adding a dependency: prefer well-known, actively maintained packages, check open advisories, and avoid versions published in the last few days. Most malicious releases are pulled within hours, so a short cooldown catches them.
- Keep the CI secret surface at one entry (`secrets.VERCEL_TOKEN`). Project and org IDs are identifiers, not credentials, and stay inline.
- **Built:** `bun audit --audit-level=high` runs in `verify` (`ci.yml`), so a high or critical advisory fails every branch until it is resolved. It reads a database that moves on its own, which means **a red `verify` can appear on a branch that changed no dependency**: check `git diff --name-only origin/main -- package.json bun.lock` before assuming the branch caused it (issue #315 was exactly this).
- **Transitive advisories are fixed through the root `overrides` block**, which is why one exists. Bump the entry rather than pinning a workspace dependency, and never let a bump move `@huggingface/transformers` off the version `docs/trd.md` §20.1 measured.
- **Not built today:** no Dependabot or Renovate, no secret scanning, no SAST. The "Confidentiality check" greps engagement terms, not credentials. State this as an open gap rather than implying coverage.
- **Architectural invariants are enforced by source-scanning guard tests.** Six exist, all named `no-stray-*`, so `find backend/src -name 'no-stray-*.test.ts'` is the authority rather than this list:
  - `audit/no-stray-audit-writes.test.ts`: every audit write goes through `recordAuditEvent`
  - `clinical-versions/no-stray-clinical-constants.test.ts`: version constants have one home
  - `deid/no-stray-brand-casts.test.ts`: only `deid/` mints the `Deidentified` brand
  - `routes/no-stray-approval.test.ts`: `approved` is unreachable without an explicit clinician action
  - `lib/llm/no-stray-provider-sdk.test.ts`: one provider SDK repo-wide, LLM and transcription vendors alike
  - `lib/asr/no-stray-fetch.test.ts`: the outbound `fetch` inventory under "ASR Egress"

  One more lives in the SPA, because ambient capture egresses where no backend guard can see it:

  - `frontend/src/audio/live/no-stray-websocket.test.ts`: the `new WebSocket(` inventory

  Follow that shape for any invariant the type system cannot express, and check the open issues rather than this line for which one is worth writing next.

## Changes That Need Explicit Human Sign-Off

Document the reason in the PR and ask before merging:

- Any new path from raw transcript text toward a provider, or any second provider SDK import.
- Any new audio egress, whether it leaves the API or the browser. This clause was read as covering raw audio a fortiori when ambient capture was designed, and the sign-off for Soniox was granted on that reading (`docs/trd.md` §20.10); a third would need its own.
- Adding a host to `connect-src` in `vercel.json`, or a second `new WebSocket(` site in the SPA.
- Exporting `markDeidentified`, adding a `as Deidentified` cast, or making `assertNoIdentifiers` unconditional on anything new.
- Relaxing a production boot guard, or setting `DEID_FAIL_CLOSED=false` outside a unit test.
- Any filtering, ordering, or deduplication inside `mergeRedFlags`.
- Widening `guidelineId` beyond `z.enum(corpusIds)`.
- Turning `assertOwnedConsultation` into a 403, or adding a route with `:id` that skips it.
- Widening `CORS_ORIGIN` beyond a single origin, or adding an origin to `trustedOrigins`.
- Adding a logger field, log level, or debug branch that widens what may be written.
- Changing the configurable retention default, making anything enforce it, or any doc wording that states a legal position for it or calls de-identified data anonymous.

## See Also

These are the deeper references. Read them rather than duplicating them here.

- `AGENTS.md` "Critical Do-Nots" is the canonical statement; this file is the enforceable mechanics behind it.
- `.claude/skills/healthcare-phi-compliance/` before touching `deid/`, `AuditEvent`, or access control.
- `.claude/skills/healthcare-cdss-patterns/` before touching `redflags/` or any clinical scoring.
- `.claude/skills/better-auth-security-best-practices/` before touching auth wiring.
- `.claude/skills/cso/` for a full OWASP and STRIDE audit pass, invoked on demand.
- `docs/trd.md` for implementation detail. Sections 4 and 16 are stale on the audit cascade and on helmet, rate limiting, and CI; trust the code.
- `docs/dpia.md` for the privacy position, the processor and residency table, and the open residual-risk register.
- `.github/PULL_REQUEST_TEMPLATE.md` Clinical-Safety Checklist is mandatory when the diff touches `deid/`, `lib/llm/`, `lib/asr/`, `redflags/`, `guidelines/`, or logging.
