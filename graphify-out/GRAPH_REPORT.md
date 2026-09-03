# Graph Report - ai-clinical-assistant  (2026-09-04)

## Corpus Check
- 247 files · ~261,883 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1844 nodes · 2947 edges · 140 communities (126 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `85a2b21d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Root Project Configuration
- Backend Dependencies
- Code Formatting Rules
- Clinical Data Models
- Frontend Build Tools
- LLM Integration Services
- Backend API Dependencies
- Development Tooling
- Shared Package Configuration
- TypeScript Compiler Settings
- Frontend UI Dependencies
- Linting Rules
- Frontend TypeScript Config
- Backend TypeScript Config
- Frontend Scripts
- Server Initialization
- Shared TypeScript Config
- Project Documentation
- Frontend Entry Point
- CI Workflow
- lint-staged
- scripts
- 9. De-Identification Pipeline
- 10. Red-Flag Rules Engine
- 12. LLM Prompt & Response Contracts
- 3. Shared Contracts (`@shared/types`)
- 21. LLM Guardrail Architecture
- vercel.json
- 6. LLM Port & Adapter
- 13. API Contracts
- 20. Browser-Side ASR Contract
- 11. Guideline Corpus
- 4. Data Model (Prisma)
- 7. Environment Contract
- 15. Audit Logging
- 8. HTTP Surface As Built
- 5. Market Fit
- index.test.ts
- 9. Capabilities & Acceptance Criteria
- 11. Regulatory Posture
- 12. Known Limitations
- 14. Demo Script
- 1. Domain Background
- 13. Success Metrics
- 6. Scope
- makeSuggestionsAndRedFlagsSchema
- 3. Aim & Objectives
- env.test.ts
- shared/tsconfig.typecheck.json
- consultations.test.ts
- backend/tsconfig.typecheck.json
- request-context.ts
- env.test.ts
- backend/tsconfig.typecheck.json
- ConsultationList.tsx
- 22. Observability & Privacy-Safe Logging
- scripts
- Button.tsx
- evidence.test.ts
- env.test.ts
- ConsultationDetailSchema
- no-stray-audit-writes.test.ts
- env.test.ts
- ConsultationDetailSchema
- Button.tsx
- makeSuggestionsAndRedFlagsSchema
- workspaces
- Guidelines.tsx
- env.ts
- env.test.ts
- react
- react-dom
- tailwind-merge
- prisma.ts
- typescript
- no-stray-approval.test.ts
- no-stray-provider-sdk.test.ts
- 23. Clinic EHR Integration Interface
- Button.tsx
- evidence.test.ts
- notifications.ts
- notifications.test.ts
- CursorGlow
- consultations.ts
- transcript-bounds.test.ts
- 3. Aim & Objectives
- env.test.ts
- 3. Aim & Objectives
- react-dom
- env.ts
- tailwind-merge
- @huggingface/transformers
- @webgpu/types
- tailwind-merge
- @types/react-dom
- 23. Clinic EHR Integration Interface
- @tanstack/react-query
- notifications.test.ts
- suggestions/index.ts
- 4. Data Model (Prisma)
- CursorGlow
- confusables.ts
- reconstruction.ts
- Button.tsx
- WorkerResponse
- derive.test.ts
- safety.test.ts
- AudioCapture.tsx
- protocol.ts
- lucide-react
- toDetail
- ClinicalFactsSchema
- evidence.ts
- react-markdown
- toPatient
- @fontsource-variable/work-sans
- @huggingface/transformers
- lucide-react
- lucide-react
- react-dom
- react-dom
- 4. Data Model (Prisma)
- Landing.tsx
- .close
- app.ts
- FakeMediaRecorder
- FakeOfflineAudioContext

## God Nodes (most connected - your core abstractions)
1. `cn()` - 63 edges
2. `TRD` - 26 edges
3. `api` - 23 edges
4. `scripts` - 21 edges
5. `Button()` - 19 edges
6. `20. ASR Contract — On-Device Default, Hosted By Exception` - 19 edges
7. `evaluateRedFlags()` - 17 edges
8. `compilerOptions` - 16 edges
9. `PRD` - 16 edges
10. `recordAuditEvent()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `AudioCapture()` --indirect_call--> `draftTurns()`  [INFERRED]
  frontend/src/audio/AudioCapture.tsx → backend/src/draft-turns/index.ts
- `transcribeWithIlmu()` --indirect_call--> `field()`  [INFERRED]
  backend/src/lib/asr/ilmu.ts → frontend/src/ui/RenameField.test.tsx
- `applyEvidenceCheck()` --references--> `ClinicalFactsSchema`  [EXTRACTED]
  backend/src/analysis/evidence.ts → shared/src/index.ts
- `applyEvidenceCheck()` --references--> `OperationalBlockSchema`  [EXTRACTED]
  backend/src/analysis/evidence.ts → shared/src/index.ts
- `facts()` --references--> `ClinicalFactsSchema`  [EXTRACTED]
  backend/src/analysis/title.test.ts → shared/src/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PHI Boundary Components** — backend_src_deid, backend_src_lib_llm [EXTRACTED 1.00]

## Communities (140 total, 14 thin omitted)

### Community 0 - "Root Project Configuration"
Cohesion: 0.10
Nodes (21): scripts, build, db:migrate, db:migrate:deploy, db:seed, db:seed:demo, db:status, db:studio (+13 more)

### Community 1 - "Backend Dependencies"
Cohesion: 0.04
Nodes (48): dependencies, better-auth, compression, cors, dotenv, express, express-rate-limit, helmet (+40 more)

### Community 2 - "Code Formatting Rules"
Cohesion: 0.05
Nodes (40): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+32 more)

### Community 3 - "Clinical Data Models"
Cohesion: 0.02
Nodes (84): AssertionState, AssertionStateSchema, Citation, ClinicalAssertion, ClinicalAssertionShape, ClinicalFacts, ClinicalFactsResponse, ClinicalSuggestion (+76 more)

### Community 4 - "Frontend Build Tools"
Cohesion: 0.09
Nodes (23): @fontsource-variable/outfit, devDependencies, @fontsource-variable/outfit, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/react, @types/react-dom (+15 more)

### Community 5 - "LLM Integration Services"
Cohesion: 0.23
Nodes (10): assertNoIdentifiers(), Deidentified, OpenAICompatibleClient, GenerateRequest, LLMClient, LLMProvider, LLMResponseError, StreamChunk (+2 more)

### Community 6 - "Backend API Dependencies"
Cohesion: 0.05
Nodes (31): AudioCapture(), belowHardwareFloor(), estimateRemaining(), Phase, FakeAudioContext, FakeMediaRecorder, FakeOfflineAudioContext, FakeWorker (+23 more)

### Community 7 - "Development Tooling"
Cohesion: 0.11
Nodes (19): @biomejs/biome, @commitlint/cli, @commitlint/config-conventional, concurrently, husky, lint-staged, devDependencies, @biomejs/biome (+11 more)

### Community 8 - "Shared Package Configuration"
Cohesion: 0.09
Nodes (21): dependencies, zod, devDependencies, typescript, vitest, exports, typescript, vitest (+13 more)

### Community 9 - "TypeScript Compiler Settings"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noImplicitOverride (+9 more)

### Community 10 - "Frontend UI Dependencies"
Cohesion: 0.10
Nodes (21): clsx, @fontsource-variable/inter, @fontsource-variable/source-serif-4, dependencies, clsx, @fontsource-variable/inter, @fontsource-variable/source-serif-4, react (+13 more)

### Community 11 - "Linting Rules"
Cohesion: 0.09
Nodes (34): FIXTURES, fullText(), FIXTURE_RUBRICS, FixtureRubric, auditEvent, captured, FIXTURE, store (+26 more)

### Community 12 - "Frontend TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, jsx, lib, noEmit, types, extends, include, ES2023 (+6 more)

### Community 13 - "Backend TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, types, exclude, extends, include, node (+4 more)

### Community 14 - "Frontend Scripts"
Cohesion: 0.11
Nodes (17): 14. Auth Model, 16. Security Controls, 18. Traceability, 19. Open Decisions Register, 1. Purpose & Relationship To Other Docs, 2. System Context & Component Responsibilities, 4. Data Model (Prisma), 5. The PHI Boundary — Type-Level Contract (+9 more)

### Community 15 - "Server Initialization"
Cohesion: 0.11
Nodes (19): createApp(), PROTECTED_PREFIXES, clientIp(), leftmostForwardedFor(), resolveClientIp(), load(), trustedProxies, analyzeRateLimit (+11 more)

### Community 16 - "Shared TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, composite, declaration, outDir, rootDir, exclude, extends, include (+3 more)

### Community 18 - "Frontend Entry Point"
Cohesion: 0.22
Nodes (9): App(), readStored(), systemPrefersDark(), ThemeContext, ThemeContextValue, ThemePreference, ThemeProvider(), queryClient (+1 more)

### Community 23 - "CI Workflow"
Cohesion: 0.15
Nodes (13): 17. Environments & Deployment, A Third Instance: A Worktree's `.env` Is A Copy, Not A Link, CI, Configuration That Lives Outside The Repository, Free-Tier Auto-Pause Mitigation, Free-Tier Seats And Collaborator Access, Migration Flow, Pooled Versus Direct URL Split (+5 more)

### Community 25 - "lint-staged"
Cohesion: 0.14
Nodes (13): 10. Safety Constraints, 15. Proposal Source Map, 2. Problem Statement, 3. Aim & Objectives, 4. Who It Is For, 7. Product Principles, 8. Primary Flow, Aim (+5 more)

### Community 26 - "scripts"
Cohesion: 0.33
Nodes (6): 9. Capabilities & Acceptance Criteria, CAP-1 — Generate A Structured Clinical Note, CAP-2 — Identify Missing Documentation, CAP-3 — Detect Predefined Red Flags And Escalation Triggers, CAP-4 — Provide Clinical Suggestions With Cited References, CAP-5 — Doctor Reviews, Edits, And Approves Before Saving

### Community 27 - "9. De-Identification Pipeline"
Cohesion: 0.22
Nodes (9): 9. De-Identification Pipeline, Audit Surface, Detector Inventory, Detector Shape — `pattern + score + context`, Fail-Closed Semantics, Recall Limitation, Token Format, Vault Lifecycle (+1 more)

### Community 28 - "10. Red-Flag Rules Engine"
Cohesion: 0.29
Nodes (7): 10. Red-Flag Rules Engine, Engine Posture, Evaluation, Merge Rule — The Zero-Suppression Invariant, Trigger Record Shape, What Stays Undecided, Whose Words Assert The Symptom (Issue #70)

### Community 29 - "12. LLM Prompt & Response Contracts"
Cohesion: 0.22
Nodes (9): 12. LLM Prompt & Response Contracts, Gap Assembly — Deterministic First, Model Strictly Additive, Latency Budget (Resolved 13/08/26), Operation 1 — `clinical_facts` + `note_and_gaps`, Operation 2 — `suggestions_and_red_flags`, Retry / Failure Behaviour, Scope Notice For Non-URTI Presentations, Verified On The Shipped Pipeline (+1 more)

### Community 30 - "3. Shared Contracts (`@shared/types`)"
Cohesion: 0.22
Nodes (9): 3. Shared Contracts (`@shared/types`), Clinical Note & Analysis, Consultation Lifecycle, Load-Bearing Semantics, Malaysian Operational Block, Ratification Conditions (Research-Imposed), Structured Clinical-Information Schema — Ratified 13/08/26, Transcript (+1 more)

### Community 31 - "21. LLM Guardrail Architecture"
Cohesion: 0.22
Nodes (9): 21.1 Measured Finding — Fabricated Clinical Negatives, 21.2 Provider Constraint — Strict Structured Output Is Not Universal, 21.3 Control Tiers, 21.4 Evidence-Bound Assertion — The Primary Control, 21.5 Transcript As Untrusted Input, 21.6 Independent Corroboration Of The §21.1 Mechanism, 21.7 What Stays Open, 21. LLM Guardrail Architecture (+1 more)

### Community 32 - "vercel.json"
Cohesion: 0.20
Nodes (9): buildCommand, framework, git, deploymentEnabled, headers, installCommand, outputDirectory, rewrites (+1 more)

### Community 33 - "6. LLM Port & Adapter"
Cohesion: 0.20
Nodes (10): 6. LLM Port & Adapter, Adapter Mechanism (`OpenAICompatibleClient`), Failure Modes, `GenerateRequest<T>`, `LLMResponseError`, Measured Limit: Gemini Cannot Complete The Pipeline, Port (`LLMClient`), Request Bounds (+2 more)

### Community 34 - "13. API Contracts"
Cohesion: 0.40
Nodes (5): 13. API Contracts, Gap — Red-Flag Acknowledgment And Gap Review Have No Columns Yet, Response Schemas In `@shared/types`, Routes, State Machine Cross-Check

### Community 35 - "20. Browser-Side ASR Contract"
Cohesion: 0.17
Nodes (12): 20.1 Measured Finding — Model Selection For Malaysian Code-Switched Speech, 20. ASR Contract — On-Device Default, Hosted By Exception, Batch, Not Streaming, For V1, Bounding The Wait: The Worker Speaks, Silence Is Terminated, Consent UX — A Live Tension, Not A Solved Problem, Deciding Whether To Offer Audio — The Two-Stage Capability Probe, Interaction With Existing Contracts, The `ASRClient` Port (+4 more)

### Community 36 - "11. Guideline Corpus"
Cohesion: 0.33
Nodes (6): 11. Guideline Corpus, Candidate Set Reaching The Prompt, Chunk Record Shape, One Source Per Chunk — A Safety Requirement, Not A Style Rule, Schema-Enforced Rejection, Source Selection — Resolved 13/08/26 (§19 Row 3, Closed)

### Community 37 - "4. Data Model (Prisma)"
Cohesion: 0.06
Nodes (25): api, ApiError, AuditEvent, AuditEventSchema, ConsultationEnvelope, ErasePatientEnvelope, FixturesEnvelope, GuidelinesEnvelope (+17 more)

### Community 38 - "7. Environment Contract"
Cohesion: 0.40
Nodes (5): 7. Environment Contract, `DEID_FAIL_CLOSED` At The Egress Point — Closed 13/08/26, Frontend Environment (`VITE_*`), Production Guard For DeepSeek (PRC Hosting) — Closed 13/08/26, Production Guards (Enforced At Boot)

### Community 39 - "15. Audit Logging"
Cohesion: 0.20
Nodes (10): 15. Audit Logging, `AuditEvent.action` Taxonomy, Clinical Content Versioning, Clinical Workflow Profiles, Consultation Erasure Tombstones, Forbidden Content, Losing the Race for the Chain Head, One Writer, Enforced (issue #55) (+2 more)

### Community 40 - "8. HTTP Surface As Built"
Cohesion: 0.08
Nodes (36): ADDRESS_CONTEXT, ADDRESS_PATTERN, caseInsensitiveLiteral(), CUE_PATTERNS, cuePattern(), DATE_NEAR_CUE, detectAddress(), detectNames() (+28 more)

### Community 41 - "5. Market Fit"
Cohesion: 0.25
Nodes (8): 5. Market Fit, Commercial Path — Stated As Estimate, Not Finding, Ground Already Occupied — Not Claimed As Novel, Positioning, The Claim Path — Built, Deliberately Not Shipped, The Commercial Thesis, The Scribe Function Is Already Commoditised Here, What Is Table Stakes Versus What Is Differentiating

### Community 42 - "index.test.ts"
Cohesion: 0.40
Nodes (5): 11. Regulatory Posture, Data Protection, Intended Purpose Statement, The Architecture Is The Compliance Strategy, The Concession, Volunteered

### Community 43 - "9. Capabilities & Acceptance Criteria"
Cohesion: 0.40
Nodes (5): 12. Known Limitations, Audio And ASR, Clinical And Evidential, Language, Product And Delivery

### Community 44 - "11. Regulatory Posture"
Cohesion: 0.40
Nodes (5): 14. Demo Script, Close, Fixture Content, Guardrail Reel (~60 Seconds), Happy Path

### Community 45 - "12. Known Limitations"
Cohesion: 0.40
Nodes (5): 1. Domain Background, The Load-Bearing Gap In This Picture, The Setting, What The Note Actually Is, Who Reads The Note

### Community 46 - "14. Demo Script"
Cohesion: 0.50
Nodes (4): 13. Success Metrics, Evaluation Reported In The Proposal, Future Production Metrics, MVP Success

### Community 47 - "1. Domain Background"
Cohesion: 0.50
Nodes (4): 6. Scope, In Scope, Out Of Scope, Out-Of-Scope Presentations At Runtime

### Community 48 - "13. Success Metrics"
Cohesion: 0.09
Nodes (26): appended, write(), AuditChainFailure, AuditChainInput, AuditChainRow, AuditChainVerification, computeAuditHash(), buildChain() (+18 more)

### Community 49 - "6. Scope"
Cohesion: 0.18
Nodes (13): containsDiagnosticProse(), DIAGNOSTIC_PHRASING, DiagnosticGuardResult, stripDiagnosticProse(), analyseNote(), buildEvidenceLinks(), EvidenceLink, linkFor() (+5 more)

### Community 50 - "makeSuggestionsAndRedFlagsSchema"
Cohesion: 0.08
Nodes (19): CatatAI(), CONSULTATION, ToolRuns(), FOLLOW_UP_QUESTIONS, OPENING_QUESTIONS, pickRandom(), COMPONENTS, Markdown() (+11 more)

### Community 51 - "3. Aim & Objectives"
Cohesion: 0.09
Nodes (23): InputMeter(), cn(), NoteEditor(), SECTIONS, ConsultationRow(), formatConsultationDate(), STATUS, Dropover() (+15 more)

### Community 52 - "env.test.ts"
Cohesion: 0.08
Nodes (28): AudioSettings, CaptureMode, DEFAULT_AUDIO_SETTINGS, loadAudioSettings(), saveAudioSettings(), toConstraints(), TranscriptionEngine, AudioSettingsDialog() (+20 more)

### Community 53 - "shared/tsconfig.typecheck.json"
Cohesion: 0.07
Nodes (27): ALLOWED_FIELDS, currentRequestId(), DETECTOR_LABELS, ERROR_CLASSES, HTTP_METHODS, labelSet, LEVELS, LLM_OPERATIONS (+19 more)

### Community 54 - "consultations.test.ts"
Cohesion: 0.12
Nodes (25): eraseConsultation(), erasePatient(), appended, ConsultationRow, consultations, PatientRow, patients, race (+17 more)

### Community 55 - "backend/tsconfig.typecheck.json"
Cohesion: 0.18
Nodes (13): AsrRelayFailureReason, extensionFor(), getAsrDescriptor(), IlmuRelayError, IlmuWireSchema, REASON_BY_STATUS, audio, relayError() (+5 more)

### Community 56 - "request-context.ts"
Cohesion: 0.15
Nodes (10): useTheme(), requestRetention(), reseed(), RetentionEnvelope, RetentionSection(), Settings(), ChromeCluster(), NotificationPanel() (+2 more)

### Community 57 - "env.test.ts"
Cohesion: 0.15
Nodes (17): CopilotChunk, keepPartial(), ReasoningFilter, rehydrateArgs(), runCopilotTurn(), buildCopilotSystemPrompt(), serialiseCorpus(), drip() (+9 more)

### Community 58 - "backend/tsconfig.typecheck.json"
Cohesion: 0.15
Nodes (18): ADULT_ACUTE_UNCOMPLICATED_UTI_PROFILE_VERSION, ADULT_ACUTE_URTI_PROFILE_VERSION, CLINICAL_PROFILES, ClinicalProfile, PROFILE_IDS, ProfileIdSchema, ACTIVE_PROFILE_VERSIONS, getActiveClinicalVersions() (+10 more)

### Community 59 - "ConsultationList.tsx"
Cohesion: 0.23
Nodes (6): mergeRedFlags(), TRIGGER_FIXTURES, ruleIds(), URTI, REDFLAG_TRIGGERS, RedFlagTrigger

### Community 60 - "22. Observability & Privacy-Safe Logging"
Cohesion: 0.10
Nodes (19): dependencies, @shared/types, devDependencies, tsx, @types/node, typescript, vitest, @shared/types (+11 more)

### Community 61 - "scripts"
Cohesion: 0.09
Nodes (20): GAP_PRIORITY, GapCard(), RedFlagCard(), SEVERITY, STATE_LABEL, SuggestionCard(), unquote(), byId() (+12 more)

### Community 62 - "Button.tsx"
Cohesion: 0.13
Nodes (16): chunks, consultation(), signed(), stream, hasPhantomClickInstruction(), CONTROL_REQUESTS, EDIT_REQUESTS, main() (+8 more)

### Community 63 - "evidence.test.ts"
Cohesion: 0.14
Nodes (14): DraftTurnsFailureReason, DeidentificationError, draftChunk(), draftTurns(), DraftTurnsError, mapWithLimit(), mergeAdjacent(), canonWord() (+6 more)

### Community 64 - "env.test.ts"
Cohesion: 0.14
Nodes (15): DemoTourContext, DemoTourProvider(), DemoTourValue, FallbackReason, pickConsultations(), resolveStepRoute(), runEphemeral(), ScoredAnalysis (+7 more)

### Community 65 - "ConsultationDetailSchema"
Cohesion: 0.14
Nodes (13): emptyOperational(), request(), ClinicalAssertionSchema, ClinicalFactsResponseSchema, ConsultationListItemSchema, DraftTurnsRequestSchema, DraftTurnsResponseSchema, ErrorEnvelopeSchema (+5 more)

### Community 66 - "no-stray-audit-writes.test.ts"
Cohesion: 0.19
Nodes (15): Args, checkIntegrity(), GroundTruthFile, Integrity, main(), MIME_BY_EXTENSION, normalise(), parseArgs() (+7 more)

### Community 67 - "env.test.ts"
Cohesion: 0.13
Nodes (14): compilerOptions, noEmit, types, exclude, extends, include, node, ../tsconfig.json (+6 more)

### Community 68 - "ConsultationDetailSchema"
Cohesion: 0.13
Nodes (11): ChecklistPanel(), ChecklistRow(), GROUPS, humanise(), notAssessed, OPERATIONAL, timestamp(), AssertionStateBadge() (+3 more)

### Community 69 - "Button.tsx"
Cohesion: 0.10
Nodes (27): corpusIds, evaluateRedFlags(), CONFUSABLES, expandMishears(), Expansion, isRecorded(), originalSpan(), ruleIds() (+19 more)

### Community 70 - "makeSuggestionsAndRedFlagsSchema"
Cohesion: 0.20
Nodes (9): dependencies, @prisma/client, engines, node, @prisma/client, license, name, private (+1 more)

### Community 71 - "workspaces"
Cohesion: 0.20
Nodes (10): ProfileId, ALL_GAP_CHECKLIST, GAP_CHECKLIST, GAP_CHECKLIST_VERSION, GapChecklistEntry, URTI_PROFILES, UTI_GAP_CHECKLIST, UTI_PROFILES (+2 more)

### Community 72 - "Guidelines.tsx"
Cohesion: 0.30
Nodes (9): decisionFor(), renderChecklist(), renderDigest(), renderGaps(), renderNote(), renderRedFlags(), renderSuggestions(), renderTranscript() (+1 more)

### Community 73 - "env.ts"
Cohesion: 0.21
Nodes (9): EnvSchema, parsed, auth, Express, Request, requireSession(), authRouter, main() (+1 more)

### Community 74 - "env.test.ts"
Cohesion: 0.50
Nodes (3): CLAIMS, Landing(), LIMITS

### Community 76 - "react-dom"
Cohesion: 0.24
Nodes (10): labelsIn(), detect(), deidentify(), deidentifyTranscript(), markDeidentified(), serialiseTranscript(), sliceDeidentified(), DeidentificationResult (+2 more)

### Community 77 - "tailwind-merge"
Cohesion: 0.22
Nodes (7): auditState, post(), postAudio(), sessionState, testEnv, upstream, webmBytes()

### Community 78 - "prisma.ts"
Cohesion: 0.18
Nodes (11): 20.2 Draft Speaker Labels: Measured, Gated, Not Diarisation, Limits, Measured, 14/08/26, Measured, 15/08/26, Revised 15/08/26: Sentence Units And Content Scores, The Apply Gate Is The Safety Control, The Fallback Contract, The Offsets Contract (+3 more)

### Community 79 - "typescript"
Cohesion: 0.18
Nodes (10): license, name, private, scripts, build, dev, preview, test (+2 more)

### Community 80 - "no-stray-approval.test.ts"
Cohesion: 0.12
Nodes (20): count(), ConsultationList(), ERASE_NOUN, EraseDialog(), VIEW_OPTIONS, formatGender(), PatientDetail(), ErasablePatient (+12 more)

### Community 81 - "no-stray-provider-sdk.test.ts"
Cohesion: 0.33
Nodes (9): isComment(), isProviderSdk(), packageName(), PROVIDER_PACKAGES, PROVIDER_SCOPES, providerImports(), REPO_ROOT, SCANNED_TREES (+1 more)

### Community 82 - "23. Clinic EHR Integration Interface"
Cohesion: 0.22
Nodes (8): AI_NOTE, analysed(), ANALYSIS, auditEvent, audits, call(), store, TRANSCRIPT

### Community 83 - "Button.tsx"
Cohesion: 0.24
Nodes (6): groupByPublisher(), Guidelines(), matches(), Select(), SelectOption, OPTIONS

### Community 84 - "evidence.test.ts"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, noEmit, exclude, extends, include, src/**/* (+1 more)

### Community 85 - "notifications.ts"
Cohesion: 0.31
Nodes (8): EXTENSIONS, FORBIDDEN, REGEX_MAY_FOLLOW, REPO_ROOT, SKIPPED, sourceFiles(), SRC, stripComments()

### Community 86 - "notifications.test.ts"
Cohesion: 0.36
Nodes (7): CLINICAL_IDS, isExempt(), REPO_ROOT, SCANNED_TREES, sourceFiles(), VERSIONED_DATA_FILES, violations()

### Community 87 - "CursorGlow"
Cohesion: 0.32
Nodes (6): brandCasts(), EXPECTED_CASTS, namesBrand(), REPO_ROOT, SCANNED_TREES, sourceFiles()

### Community 88 - "consultations.ts"
Cohesion: 0.18
Nodes (7): ChoiceCard(), formatLastSeen(), formatMeta(), StartConsultationDialog(), Harness(), PATIENTS, VISIT_FILTERS

### Community 89 - "transcript-bounds.test.ts"
Cohesion: 0.32
Nodes (5): ErrorClass, classify(), errorHandler(), DeidentificationError, LLMResponseError

### Community 90 - "3. Aim & Objectives"
Cohesion: 0.36
Nodes (4): withRequestContext(), normaliseRoute(), requestContext(), captured

### Community 91 - "env.test.ts"
Cohesion: 0.36
Nodes (7): approvalWrites(), EXPECTED, isComment(), isExempt(), REPO_ROOT, SCANNED_TREES, sourceFiles()

### Community 92 - "3. Aim & Objectives"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, exclude, extends, include, src/**/*, ./tsconfig.json

### Community 93 - "react-dom"
Cohesion: 0.25
Nodes (8): 25.1 The Reported Failure And What Was Actually There, 25.2 Why It Was Invisible To The Suite, 25.3 Method, 25.4 Four Revisions Were Trialled And All Four Rejected, 25.5 The Phantom-Click Diagnostic, 25.6 Evaluation Durability, 25.7 What Stays Open, 25. Review Copilot Tool-Call Behaviour

### Community 94 - "env.ts"
Cohesion: 0.36
Nodes (7): getClinicalProfile(), corpusIdsFor(), generateSuggestions(), capturedRequest(), emptyResponse, { generate }, { text: content }

### Community 95 - "tailwind-merge"
Cohesion: 0.25
Nodes (7): lint-staged, AGENTS.md, biome.json, CLAUDE.md, commitlint.config.js, {docs,.github}/**/*.{md,yml,yaml}, {shared,backend,frontend,evals}/**/*.{ts,tsx,js,json}

### Community 96 - "@huggingface/transformers"
Cohesion: 0.33
Nodes (4): EXPECTED_FETCH_CALLS, fetchCalls(), isFetchCall(), REPO_ROOT

### Community 97 - "@webgpu/types"
Cohesion: 0.29
Nodes (7): 20.5 Hosted Draft Turns: Server-Side Split And Label, Chunking, And Why The Pass Needed It, Failure Taxonomy And Fallback, Gaps, Stated Honestly, Labels Remain Guesses, Mechanism, Why

### Community 98 - "tailwind-merge"
Cohesion: 0.29
Nodes (7): Download Size, Measured 15/08/26, Model, Delivery, And Runtime — Resolved 13/08/26 (§19 Row 13, Closed), Per-Module Dtype On WebGPU (Issue #144), Session And Speed, Same Machine And Recording, The Quantised Decoder Needs Graph Optimisation Disabled, Timestamp Integrity On The Reference Recording, Token A/B, Stated With The Honesty §20.1 Demands

### Community 99 - "@types/react-dom"
Cohesion: 0.29
Nodes (6): Adding A Case, Cost And Data, Evals, Running It, What It Grades, Why This Is Not `tests/`

### Community 100 - "23. Clinic EHR Integration Interface"
Cohesion: 0.14
Nodes (12): ApproveBar(), ago(), NotificationRow(), relative, SHAPE, UNITS, Button(), ButtonProps (+4 more)

### Community 101 - "@tanstack/react-query"
Cohesion: 0.47
Nodes (4): formatReport(), Measurement, measurements, record()

### Community 103 - "suggestions/index.ts"
Cohesion: 0.33
Nodes (3): healthRouter, envMock, health()

### Community 104 - "4. Data Model (Prisma)"
Cohesion: 0.33
Nodes (6): 22. Observability & Privacy-Safe Logging, Deliberate Omissions, Residual Risk, The Finding That Shaped The Design, What Is Recorded, Why It Is Structural, Not Conventional

### Community 105 - "CursorGlow"
Cohesion: 0.33
Nodes (6): 23. Clinic EHR Integration Interface, Approved-Note Export Contract, Authentication And Transport, Candidate Standards Assessment, Direction And Trigger, PHI Boundary Under A Real Integration

### Community 106 - "confusables.ts"
Cohesion: 0.25
Nodes (5): getLLMDescriptor(), asrRouter, FAILURE_RESPONSES, parseAudioBody(), rawAudio

### Community 107 - "reconstruction.ts"
Cohesion: 0.22
Nodes (5): auditActions, ConsultationRow, consultations, PatientRow, patients

### Community 109 - "WorkerResponse"
Cohesion: 0.40
Nodes (5): 20.4 The Consent Gate (Resolves §19 Row 18), Client Behaviour, What Is Rendered, What The Copy Claims, And Why It Claims No More, Why The Structure Carries The Rule, Not The Wording

### Community 110 - "derive.test.ts"
Cohesion: 0.40
Nodes (5): 24. Frontend Rendering Constraints, Glass Inside Glass Is Always Flat, Public Build Inputs, The Two Constraints DESIGN.md Already Names, Verifying A Glass Change

### Community 111 - "safety.test.ts"
Cohesion: 0.20
Nodes (10): DemoStepBar(), useDemoTour(), HelpButton(), Spotlight(), AppShell(), LiveDataWarning(), alphaAt(), CursorGlow() (+2 more)

### Community 112 - "AudioCapture.tsx"
Cohesion: 0.40
Nodes (5): workspaces, backend, evals, frontend, shared

### Community 113 - "protocol.ts"
Cohesion: 0.50
Nodes (4): 20.3 Measured Finding: Hosted `ilmu-asr-v4.2` Against The Shipped Local Path, Decision, Applying The Rule Written In #151 Before Measurement, Findings, In Order Of Consequence, Token Table, Rojak Sample

### Community 114 - "lucide-react"
Cohesion: 0.50
Nodes (4): 20.6 Capture Constraints: Dictation DSP Off (Addendum To §20.3), Re-Measurement Protocol (Needs A Human Reader), What Changed, What This Rests On, And What It Does Not Claim

### Community 115 - "toDetail"
Cohesion: 0.50
Nodes (4): CitationSchema, ClinicalSuggestionSchema, makeSuggestionsAndRedFlagsSchema(), RedFlagSchema

### Community 117 - "evidence.ts"
Cohesion: 0.19
Nodes (13): applyEvidenceCheck(), checkAssertion(), checkGroup(), EVIDENCE_REQUIRED_STATES, EvidenceCheckResult, hasVerbatimEvidence(), LlmClinicalFacts, LlmOperationalBlock (+5 more)

### Community 118 - "react-markdown"
Cohesion: 0.67
Nodes (3): The One Network Call The Local Path Does Make, Two Assets, Two Decisions, What Crosses The Network

### Community 120 - "toPatient"
Cohesion: 0.36
Nodes (6): deriveConsultationTitle(), humanise(), PRESENT_STATES, facts(), emptyFacts(), ClinicalFactsSchema

### Community 127 - "4. Data Model (Prisma)"
Cohesion: 0.29
Nodes (5): { completionsCreate, constructed, envMock }, emittedFor(), request(), Schema, SMUGGLED

### Community 128 - "Landing.tsx"
Cohesion: 0.50
Nodes (4): MALAY_TRIGGER_FIXTURES, patient(), ruleIds(), transcript()

### Community 129 - ".close"
Cohesion: 0.40
Nodes (5): overrides, adm-zip, deepmerge-ts, fast-uri, sharp

## Knowledge Gaps
- **770 isolated node(s):** `name`, `private`, `license`, `type`, `dev` (+765 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AudioCapture()` connect `Backend API Dependencies` to `ConsultationDetailSchema`, `env.test.ts`, `evidence.test.ts`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `draftTurns()` connect `evidence.test.ts` to `confusables.ts`, `react-dom`, `Backend API Dependencies`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `cn()` connect `3. Aim & Objectives` to `ConsultationDetailSchema`, `23. Clinic EHR Integration Interface`, `safety.test.ts`, `no-stray-approval.test.ts`, `makeSuggestionsAndRedFlagsSchema`, `Button.tsx`, `env.test.ts`, `consultations.ts`, `request-context.ts`, `scripts`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `name`, `private`, `license` to the rest of the system?**
  _770 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Root Project Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `Code Formatting Rules` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._