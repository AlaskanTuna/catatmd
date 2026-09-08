# Graph Report - retrieval  (2026-09-09)

## Corpus Check
- 322 files · ~364,713 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2440 nodes · 4043 edges · 181 communities (158 shown, 23 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5bb81cad`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- scripts
- dependencies
- includes
- src/index.ts
- devDependencies
- llm/index.ts
- AudioCapture.test.tsx
- devDependencies
- shared/package.json
- compilerOptions
- dependencies
- FIXTURES
- frontend/tsconfig.json
- backend/tsconfig.json
- TRD
- app.ts
- shared/tsconfig.json
- docs/README.md
- theme.tsx
- 17. Environments & Deployment
- PRD
- 9. Capabilities & Acceptance Criteria
- 9. De-Identification Pipeline
- 10. Red-Flag Rules Engine
- 12. LLM Prompt & Response Contracts
- 3. Shared Contracts (`@shared/types`)
- 21. LLM Guardrail Architecture
- vercel.json
- 6. LLM Port & Adapter
- 13. API Contracts
- 20. ASR Contract — On-Device Default, Hosted By Exception
- 11. Guideline Corpus
- api.ts
- 7. Environment Contract
- 15. Audit Logging
- detectors.ts
- 5. Market Fit
- 11. Regulatory Posture
- 12. Known Limitations
- 14. Demo Script
- 1. Domain Background
- 13. Success Metrics
- 6. Scope
- audit/index.ts
- analysis/index.ts
- CatatAI.tsx
- cn
- CapturePanel.tsx
- logger.ts
- consultations.ts
- ilmu.ts
- Settings.tsx
- copilot/index.ts
- guidelines/index.ts
- evaluateRedFlags
- evals/package.json
- ConsultationReview.tsx
- copilot-proposals.ts
- draft-turns/index.ts
- DemoTour.tsx
- src/index.test.ts
- asr-ab.ts
- evals/tsconfig.json
- ChecklistPanel.tsx
- triggers.ts
- package.json
- checklist.ts
- digest.ts
- clinical-profiles/index.ts
- AmbientCapture.tsx
- toPatient
- deid/index.ts
- asr.test.ts
- 20.2 Draft Speaker Labels: Measured, Gated, Not Diarisation
- frontend/package.json
- PatientList.tsx
- no-stray-provider-sdk.test.ts
- consultations.test.ts
- Guidelines.tsx
- shared/tsconfig.typecheck.json
- no-stray-dev-references.test.ts
- no-stray-clinical-constants.test.ts
- no-stray-brand-casts.test.ts
- StartConsultationDialog.tsx
- error-handler.ts
- ConsultationReview.test.tsx
- no-stray-approval.test.ts
- backend/tsconfig.typecheck.json
- 25. Review Copilot Tool-Call Behaviour
- workflow.ts
- lint-staged
- no-stray-fetch.test.ts
- 20.5 Hosted Draft Turns: Server-Side Split And Label
- Per-Module Dtype On WebGPU (Issue #144)
- Evals
- AudioCapture.tsx
- acceptance/safety.test.ts
- no-stray-audit-writes.test.ts
- health.ts
- 22. Observability & Privacy-Safe Logging
- 23. Clinic EHR Integration Interface
- asr.ts
- patients.test.ts
- notifications.test.ts
- 20.4 The Consent Gate (Resolves §19 Row 18)
- 24. Frontend Rendering Constraints
- CursorGlow
- workspaces
- 20.3 Measured Finding: Hosted `ilmu-asr-v4.2` Against The Shipped Local Path
- 20.6 Capture Constraints: Dictation DSP Off (Addendum To §20.3)
- makeSuggestionsAndRedFlagsSchema
- transcript-bounds.test.ts
- use-live-panes.ts
- AmbientCapture.test.tsx
- devDependencies
- @fontsource-variable/work-sans
- @huggingface/transformers
- lucide-react
- react-dom
- react-markdown
- @types/react
- openai-compatible.test.ts
- use-segment-recorder.ts
- overrides
- settings.test.ts
- soniox-stream.ts
- use-segment-recorder.test.ts
- transcribe.worker.ts
- CapturePanel.test.tsx
- asr-live-sessions.test.ts
- audio-settings.ts
- src/note-templates.test.ts
- consultations-live-analysis.test.ts
- no-stray-transformers.test.ts
- use-transcript-audio.ts
- 20.10 Ambient Capture On Soniox, Browser-Direct, Under An API-Minted Key
- 20.9 Ambient Capture On ILMU, And The Mechanism Behind 20.8's Post-Correction Row
- no-stray-websocket.test.ts
- MedicalRecordNoteEditor.tsx
- 20.7 Live Ambient Capture: Mechanism, Models, And The Accuracy Chain
- 20.8 How This Design Compares To Industry Practice
- WorkerResponse
- use-live-panes.test.ts
- ConsultationRow.tsx
- consultations-audio.test.ts
- consultations-live-flags.test.ts
- 20.11 The Live Panes, And Why The Note Is Not One Of Them
- scripts
- audio.test.ts
- live-window.test.ts
- FakeWebSocket
- FakeWebSocket
- backend/package.json
- LiveConversation.test.tsx
- no-stray-audio-persistence.test.ts
- LivePrompter.test.tsx
- FakeMediaRecorder
- token
- FakeAudioContext
- ApproveBar.test.tsx
- InfoTip.test.tsx
- cors
- dotenv
- express
- @shared/types
- @fontsource-variable/source-serif-4
- FakeAudioContext
- Privacy.tsx

## God Nodes (most connected - your core abstractions)
1. `cn()` - 84 edges
2. `api` - 27 edges
3. `TRD` - 26 edges
4. `evaluateRedFlags()` - 25 edges
5. `20. ASR Contract — On-Device Default, Hosted By Exception` - 25 edges
6. `Button()` - 23 edges
7. `scripts` - 22 edges
8. `recordAuditEvent()` - 18 edges
9. `Deidentified` - 18 edges
10. `main()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `AudioCapture()` --indirect_call--> `draftTurns()`  [INFERRED]
  frontend/src/audio/AudioCapture.tsx → backend/src/draft-turns/index.ts
- `AmbientCapture()` --indirect_call--> `draftTurns()`  [INFERRED]
  frontend/src/audio/live/AmbientCapture.tsx → backend/src/draft-turns/index.ts
- `transcribeWithIlmu()` --indirect_call--> `field()`  [INFERRED]
  backend/src/lib/asr/ilmu.ts → frontend/src/ui/RenameField.test.tsx
- `CapturePanel()` --indirect_call--> `live()`  [INFERRED]
  frontend/src/routes/CapturePanel.tsx → backend/src/redflags/live-window.test.ts
- `buildLexicalQuery()` --indirect_call--> `token()`  [INFERRED]
  backend/src/retrieval/query.ts → frontend/src/audio/live/live-tokens.test.ts

## Import Cycles
- 2-file cycle: `shared/src/index.ts -> shared/src/note-templates.ts -> shared/src/index.ts`

## Hyperedges (group relationships)
- **PHI Boundary Components** — backend_src_deid, backend_src_lib_llm [EXTRACTED 1.00]

## Communities (181 total, 23 thin omitted)

### Community 0 - "scripts"
Cohesion: 0.09
Nodes (22): scripts, build, corpus:ingest, db:migrate, db:migrate:deploy, db:seed, db:seed:demo, db:status (+14 more)

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, better-auth, compression, express-rate-limit, helmet, openai, @prisma/client, zod (+7 more)

### Community 2 - "includes"
Cohesion: 0.05
Nodes (40): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+32 more)

### Community 3 - "src/index.ts"
Cohesion: 0.02
Nodes (100): AssertionState, AssertionStateSchema, CaptureMode, Citation, ClinicalAssertion, ClinicalAssertionShape, ClinicalFacts, ClinicalFactsResponse (+92 more)

### Community 4 - "devDependencies"
Cohesion: 0.09
Nodes (23): @fontsource-variable/outfit, devDependencies, @fontsource-variable/outfit, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/react, @types/react-dom (+15 more)

### Community 5 - "llm/index.ts"
Cohesion: 0.18
Nodes (12): assertNoIdentifiers(), Deidentified, EmbeddingClient, OpenAICompatibleClient, OpenAICompatibleEmbeddingClient, GenerateRequest, LLMClient, LLMProvider (+4 more)

### Community 6 - "AudioCapture.test.tsx"
Cohesion: 0.07
Nodes (17): agree(), consentBox(), FakeAudioContext, FakeMediaRecorder, FakeOfflineAudioContext, FakeWorker, recorders, settle() (+9 more)

### Community 7 - "devDependencies"
Cohesion: 0.11
Nodes (19): @biomejs/biome, @commitlint/cli, @commitlint/config-conventional, concurrently, husky, lint-staged, devDependencies, @biomejs/biome (+11 more)

### Community 8 - "shared/package.json"
Cohesion: 0.09
Nodes (21): dependencies, zod, devDependencies, typescript, vitest, exports, typescript, vitest (+13 more)

### Community 9 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noImplicitOverride (+9 more)

### Community 10 - "dependencies"
Cohesion: 0.10
Nodes (21): clsx, @fontsource-variable/inter, dependencies, clsx, @fontsource-variable/inter, react, react-hot-toast, react-router-dom (+13 more)

### Community 11 - "FIXTURES"
Cohesion: 0.08
Nodes (35): FIXTURES, fullText(), FIXTURE_RUBRICS, FixtureRubric, auditEvent, captured, FIXTURE, store (+27 more)

### Community 12 - "frontend/tsconfig.json"
Cohesion: 0.13
Nodes (14): compilerOptions, jsx, lib, noEmit, types, extends, include, ES2023 (+6 more)

### Community 13 - "backend/tsconfig.json"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, types, exclude, extends, include, node (+4 more)

### Community 14 - "TRD"
Cohesion: 0.11
Nodes (17): 14. Auth Model, 16. Security Controls, 18. Traceability, 19. Open Decisions Register, 1. Purpose & Relationship To Other Docs, 2. System Context & Component Responsibilities, 4. Data Model (Prisma), 5. The PHI Boundary — Type-Level Contract (+9 more)

### Community 15 - "app.ts"
Cohesion: 0.08
Nodes (32): createApp(), PROTECTED_PREFIXES, EnvSchema, parsed, auth, clientIp(), leftmostForwardedFor(), resolveClientIp() (+24 more)

### Community 16 - "shared/tsconfig.json"
Cohesion: 0.17
Nodes (11): compilerOptions, composite, declaration, outDir, rootDir, exclude, extends, include (+3 more)

### Community 18 - "theme.tsx"
Cohesion: 0.22
Nodes (9): App(), readStored(), systemPrefersDark(), ThemeContext, ThemeContextValue, ThemePreference, ThemeProvider(), queryClient (+1 more)

### Community 23 - "17. Environments & Deployment"
Cohesion: 0.15
Nodes (13): 17. Environments & Deployment, A Third Instance: A Worktree's `.env` Is A Copy, Not A Link, CI, Configuration That Lives Outside The Repository, Free-Tier Auto-Pause Mitigation, Free-Tier Seats And Collaborator Access, Migration Flow, Pooled Versus Direct URL Split (+5 more)

### Community 25 - "PRD"
Cohesion: 0.18
Nodes (10): 10. Safety Constraints, 15. Proposal Source Map, 2. Problem Statement, 4. Who It Is For, 7. Product Principles, 8. Primary Flow, Competitive And Regulatory Framing For The Proposal, PRD (+2 more)

### Community 26 - "9. Capabilities & Acceptance Criteria"
Cohesion: 0.33
Nodes (6): 9. Capabilities & Acceptance Criteria, CAP-1 — Generate A Structured Clinical Note, CAP-2 — Identify Missing Documentation, CAP-3 — Detect Predefined Red Flags And Escalation Triggers, CAP-4 — Provide Clinical Suggestions With Cited References, CAP-5 — Doctor Reviews, Edits, And Approves Before Saving

### Community 27 - "9. De-Identification Pipeline"
Cohesion: 0.22
Nodes (9): 9. De-Identification Pipeline, Audit Surface, Detector Inventory, Detector Shape — `pattern + score + context`, Fail-Closed Semantics, Recall Limitation, Token Format, Vault Lifecycle (+1 more)

### Community 28 - "10. Red-Flag Rules Engine"
Cohesion: 0.29
Nodes (7): 10. Red-Flag Rules Engine, Engine Posture, Evaluation, Merge Rule — The Zero-Suppression Invariant, Trigger Record Shape, What Stays Undecided, Whose Words Assert The Symptom (Issue #70)

### Community 29 - "12. LLM Prompt & Response Contracts"
Cohesion: 0.20
Nodes (10): 12. LLM Prompt & Response Contracts, Gap Assembly — Deterministic First, Model Strictly Additive, Latency Budget (Resolved 13/08/26), Measured Workflow Timing (08/09/26, Issue #224), Operation 1 — `clinical_facts` + `note_and_gaps`, Operation 2 — `suggestions_and_red_flags`, Retry / Failure Behaviour, Scope Notice For Non-URTI Presentations (+2 more)

### Community 30 - "3. Shared Contracts (`@shared/types`)"
Cohesion: 0.20
Nodes (10): 3. Shared Contracts (`@shared/types`), Clinical Note & Analysis, Consultation Lifecycle, Load-Bearing Semantics, Malaysian Operational Block, Note Template Projections, Ratification Conditions (Research-Imposed), Structured Clinical-Information Schema — Ratified 13/08/26 (+2 more)

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

### Community 35 - "20. ASR Contract — On-Device Default, Hosted By Exception"
Cohesion: 0.12
Nodes (16): 20.1 Measured Finding — Model Selection For Malaysian Code-Switched Speech, 20. ASR Contract — On-Device Default, Hosted By Exception, Batch, Not Streaming, For V1, Bounding The Wait: The Worker Speaks, Silence Is Terminated, Capture Mode Ownership And Manual Pause, Consent UX — A Live Tension, Not A Solved Problem, Deciding Whether To Offer Audio — The Two-Stage Capability Probe, Interaction With Existing Contracts (+8 more)

### Community 36 - "11. Guideline Corpus"
Cohesion: 0.33
Nodes (6): 11. Guideline Corpus, Candidate Set Reaching The Prompt, Chunk Record Shape, One Source Per Chunk — A Safety Requirement, Not A Style Rule, Schema-Enforced Rejection, Source Selection — Resolved 13/08/26 (§19 Row 3, Closed)

### Community 37 - "api.ts"
Cohesion: 0.07
Nodes (21): AuditEvent, AuditEventSchema, ConsultationEnvelope, ErasePatientEnvelope, FixturesEnvelope, GuidelineDocumentsEnvelope, GuidelinesEnvelope, HistoryEnvelope (+13 more)

### Community 38 - "7. Environment Contract"
Cohesion: 0.40
Nodes (5): 7. Environment Contract, `DEID_FAIL_CLOSED` At The Egress Point — Closed 13/08/26, Frontend Environment (`VITE_*`), Production Guard For DeepSeek (PRC Hosting) — Closed 13/08/26, Production Guards (Enforced At Boot)

### Community 39 - "15. Audit Logging"
Cohesion: 0.20
Nodes (10): 15. Audit Logging, `AuditEvent.action` Taxonomy, Clinical Content Versioning, Clinical Workflow Profiles, Consultation Erasure Tombstones, Forbidden Content, Losing the Race for the Chain Head, One Writer, Enforced (issue #55) (+2 more)

### Community 40 - "detectors.ts"
Cohesion: 0.08
Nodes (36): ADDRESS_CONTEXT, ADDRESS_PATTERN, caseInsensitiveLiteral(), CUE_PATTERNS, cuePattern(), DATE_NEAR_CUE, detectAddress(), detectNames() (+28 more)

### Community 41 - "5. Market Fit"
Cohesion: 0.25
Nodes (8): 5. Market Fit, Commercial Path — Stated As Estimate, Not Finding, Ground Already Occupied — Not Claimed As Novel, Positioning, The Claim Path — Built, Deliberately Not Shipped, The Commercial Thesis, The Scribe Function Is Already Commoditised Here, What Is Table Stakes Versus What Is Differentiating

### Community 42 - "11. Regulatory Posture"
Cohesion: 0.40
Nodes (5): 11. Regulatory Posture, Data Protection, Intended Purpose Statement, The Architecture Is The Compliance Strategy, The Concession, Volunteered

### Community 43 - "12. Known Limitations"
Cohesion: 0.40
Nodes (5): 12. Known Limitations, Audio And ASR, Clinical And Evidential, Language, Product And Delivery

### Community 44 - "14. Demo Script"
Cohesion: 0.40
Nodes (5): 14. Demo Script, Close, Fixture Content, Guardrail Reel (~60 Seconds), Happy Path

### Community 45 - "1. Domain Background"
Cohesion: 0.40
Nodes (5): 1. Domain Background, The Load-Bearing Gap In This Picture, The Setting, What The Note Actually Is, Who Reads The Note

### Community 46 - "13. Success Metrics"
Cohesion: 0.50
Nodes (4): 13. Success Metrics, Evaluation Reported In The Proposal, Future Production Metrics, MVP Success

### Community 47 - "6. Scope"
Cohesion: 0.50
Nodes (4): 6. Scope, In Scope, Out Of Scope, Out-Of-Scope Presentations At Runtime

### Community 48 - "audit/index.ts"
Cohesion: 0.07
Nodes (33): appended, write(), AuditChainFailure, AuditChainInput, AuditChainRow, AuditChainVerification, computeAuditHash(), buildChain() (+25 more)

### Community 49 - "analysis/index.ts"
Cohesion: 0.09
Nodes (29): applyEvidenceCheck(), checkAssertion(), checkGroup(), EVIDENCE_REQUIRED_STATES, EvidenceCheckResult, hasVerbatimEvidence(), LlmClinicalFacts, LlmOperationalBlock (+21 more)

### Community 50 - "CatatAI.tsx"
Cohesion: 0.08
Nodes (19): CatatAI(), CONSULTATION, ToolRuns(), FOLLOW_UP_QUESTIONS, OPENING_QUESTIONS, pickRandom(), COMPONENTS, Markdown() (+11 more)

### Community 51 - "cn"
Cohesion: 0.07
Nodes (27): AudioCapture(), belowHardwareFloor(), estimateRemaining(), Phase, toMono16k(), ConsentGate(), InputMeter(), elapsed() (+19 more)

### Community 52 - "CapturePanel.tsx"
Cohesion: 0.24
Nodes (12): classify(), DOCTOR_PATTERNS, DraftLine, endsWithQuestion(), matches(), normalise(), PATIENT_PATTERNS, proseToDraft() (+4 more)

### Community 53 - "logger.ts"
Cohesion: 0.07
Nodes (27): DeidentificationError, ALLOWED_FIELDS, currentRequestId(), DETECTOR_LABELS, ERROR_CLASSES, HTTP_METHODS, labelSet, LEVELS (+19 more)

### Community 54 - "consultations.ts"
Cohesion: 0.11
Nodes (33): audioRetentionEnabled(), purgeAudio(), readAudio(), storeAudio(), sweepExpiredAudio(), eraseConsultation(), erasePatient(), isChainHeadRace() (+25 more)

### Community 55 - "ilmu.ts"
Cohesion: 0.18
Nodes (13): AsrRelayFailureReason, extensionFor(), getAsrDescriptor(), IlmuRelayError, IlmuWireSchema, REASON_BY_STATUS, audio, relayError() (+5 more)

### Community 56 - "Settings.tsx"
Cohesion: 0.15
Nodes (10): useTheme(), requestRetention(), reseed(), RetentionEnvelope, RetentionSection(), Settings(), ChromeCluster(), NotificationPanel() (+2 more)

### Community 57 - "copilot/index.ts"
Cohesion: 0.14
Nodes (18): ProfileIdSchema, CopilotChunk, keepPartial(), ReasoningFilter, rehydrateArgs(), runCopilotTurn(), buildCopilotSystemPrompt(), serialiseCorpus() (+10 more)

### Community 58 - "guidelines/index.ts"
Cohesion: 0.18
Nodes (15): getClinicalProfile(), corpusIds, corpusIdsFor(), GUIDELINE_CORPUS, GUIDELINE_CORPUS_VERSION, ProfiledGuidelineChunk, URTI_PROFILES, UTI_PROFILES (+7 more)

### Community 59 - "evaluateRedFlags"
Cohesion: 0.09
Nodes (22): corpusIds, evaluateRedFlags(), mergeRedFlags(), TRIGGER_FIXTURES, MALAY_TRIGGER_FIXTURES, patient(), ruleIds(), transcript() (+14 more)

### Community 60 - "evals/package.json"
Cohesion: 0.10
Nodes (19): dependencies, @shared/types, devDependencies, tsx, @types/node, typescript, vitest, @shared/types (+11 more)

### Community 61 - "ConsultationReview.tsx"
Cohesion: 0.06
Nodes (27): useLivePanes(), spokenTimestamp(), Dismissed, FlagState, GAP_PRIORITY_ORDER, PanelModel, selectPrompts(), SEVERITY_ORDER (+19 more)

### Community 62 - "copilot-proposals.ts"
Cohesion: 0.13
Nodes (16): chunks, consultation(), signed(), stream, hasPhantomClickInstruction(), CONTROL_REQUESTS, EDIT_REQUESTS, main() (+8 more)

### Community 63 - "draft-turns/index.ts"
Cohesion: 0.18
Nodes (13): DraftTurnsFailureReason, draftChunk(), draftTurns(), DraftTurnsError, mapWithLimit(), mergeAdjacent(), canonWord(), ReconstructionError (+5 more)

### Community 64 - "DemoTour.tsx"
Cohesion: 0.14
Nodes (15): DemoTourContext, DemoTourProvider(), DemoTourValue, FallbackReason, pickConsultations(), resolveStepRoute(), runEphemeral(), ScoredAnalysis (+7 more)

### Community 65 - "src/index.test.ts"
Cohesion: 0.12
Nodes (15): bareFacts(), request(), ClinicalAssertionSchema, ClinicalFactsResponseSchema, ConsultationListItemSchema, DraftTurnsRequestSchema, DraftTurnsResponseSchema, ErrorEnvelopeSchema (+7 more)

### Community 66 - "asr-ab.ts"
Cohesion: 0.09
Nodes (38): Args, asPercent(), CallResult, checkIntegrity(), Chunk, Container, CONTAINER_CODEC, cutChunks() (+30 more)

### Community 67 - "evals/tsconfig.json"
Cohesion: 0.13
Nodes (14): compilerOptions, noEmit, types, exclude, extends, include, node, ../tsconfig.json (+6 more)

### Community 68 - "ChecklistPanel.tsx"
Cohesion: 0.10
Nodes (16): timestamp(), CHECKLIST_SECTION_LABELS, CHECKLIST_SECTION_ORDER, ChecklistEntry, ChecklistPanel(), ChecklistRow(), ChecklistSection, CLINICAL_FACT_GROUPS (+8 more)

### Community 69 - "triggers.ts"
Cohesion: 0.15
Nodes (21): CONFUSABLES, expandMishears(), Expansion, isRecorded(), originalSpan(), ABILITY_DENIAL, asserts(), DELPHI_AIRWAY_IDS (+13 more)

### Community 70 - "package.json"
Cohesion: 0.13
Nodes (14): dependencies, @prisma/client, engines, node, @prisma/client, license, name, private (+6 more)

### Community 71 - "checklist.ts"
Cohesion: 0.15
Nodes (13): formatReport(), Measurement, measurements, record(), ACTIVE_PROFILE_VERSIONS, getActiveClinicalVersions(), ALL_GAP_CHECKLIST, GAP_CHECKLIST (+5 more)

### Community 72 - "digest.ts"
Cohesion: 0.30
Nodes (9): decisionFor(), renderChecklist(), renderDigest(), renderGaps(), renderNote(), renderRedFlags(), renderSuggestions(), renderTranscript() (+1 more)

### Community 73 - "clinical-profiles/index.ts"
Cohesion: 0.25
Nodes (9): ADULT_ACUTE_UNCOMPLICATED_UTI_PROFILE_VERSION, ADULT_ACUTE_URTI_PROFILE_VERSION, CLINICAL_PROFILES, ClinicalProfile, PROFILE_IDS, ProfileId, ClinicalArtefactVersion, GapChecklistEntry (+1 more)

### Community 74 - "AmbientCapture.tsx"
Cohesion: 0.19
Nodes (19): AmbientCapture(), Availability, LANGUAGE_LABELS, Phase, REGION_LABELS, absorb(), continuesWord(), dominantSpeaker() (+11 more)

### Community 76 - "deid/index.ts"
Cohesion: 0.22
Nodes (10): labelsIn(), detect(), deidentify(), deidentifyTranscript(), markDeidentified(), serialiseTranscript(), sliceDeidentified(), DeidentificationResult (+2 more)

### Community 77 - "asr.test.ts"
Cohesion: 0.22
Nodes (7): auditState, post(), postAudio(), sessionState, testEnv, upstream, webmBytes()

### Community 78 - "20.2 Draft Speaker Labels: Measured, Gated, Not Diarisation"
Cohesion: 0.18
Nodes (11): 20.2 Draft Speaker Labels: Measured, Gated, Not Diarisation, Limits, Measured, 14/08/26, Measured, 15/08/26, Revised 15/08/26: Sentence Units And Content Scores, The Apply Gate Is The Safety Control, The Fallback Contract, The Offsets Contract (+3 more)

### Community 79 - "frontend/package.json"
Cohesion: 0.18
Nodes (10): license, name, private, scripts, build, dev, preview, test (+2 more)

### Community 80 - "PatientList.tsx"
Cohesion: 0.08
Nodes (34): api, ApiError, count(), ConsultationList(), ERASE_NOUN, EraseDialog(), CONSULTATIONS, VIEW_OPTIONS (+26 more)

### Community 81 - "no-stray-provider-sdk.test.ts"
Cohesion: 0.33
Nodes (9): isComment(), isProviderSdk(), packageName(), PROVIDER_PACKAGES, PROVIDER_SCOPES, providerImports(), REPO_ROOT, SCANNED_TREES (+1 more)

### Community 82 - "consultations.test.ts"
Cohesion: 0.18
Nodes (10): AI_MEDICAL_RECORD, AI_NOTE, analysed(), ANALYSIS, auditEvent, audits, call(), LEGACY_ANALYSIS (+2 more)

### Community 83 - "Guidelines.tsx"
Cohesion: 0.18
Nodes (12): getEmbeddingClient(), buildLexicalQuery(), STOP_WORDS, RetrievalOptions, retrieveGuidelines(), embed, findMany, info (+4 more)

### Community 84 - "shared/tsconfig.typecheck.json"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, noEmit, exclude, extends, include, src/**/* (+1 more)

### Community 85 - "no-stray-dev-references.test.ts"
Cohesion: 0.25
Nodes (7): EXTENSIONS, FORBIDDEN, REGEX_MAY_FOLLOW, REPO_ROOT, SKIPPED, SRC, stripComments()

### Community 86 - "no-stray-clinical-constants.test.ts"
Cohesion: 0.36
Nodes (7): CLINICAL_IDS, isExempt(), REPO_ROOT, SCANNED_TREES, sourceFiles(), VERSIONED_DATA_FILES, violations()

### Community 87 - "no-stray-brand-casts.test.ts"
Cohesion: 0.32
Nodes (6): brandCasts(), EXPECTED_CASTS, namesBrand(), REPO_ROOT, SCANNED_TREES, sourceFiles()

### Community 88 - "StartConsultationDialog.tsx"
Cohesion: 0.18
Nodes (7): ChoiceCard(), formatLastSeen(), formatMeta(), StartConsultationDialog(), Harness(), PATIENTS, VISIT_FILTERS

### Community 89 - "error-handler.ts"
Cohesion: 0.32
Nodes (5): ErrorClass, classify(), errorHandler(), DeidentificationError, LLMResponseError

### Community 90 - "ConsultationReview.test.tsx"
Cohesion: 0.15
Nodes (16): displayValue(), formatNoteForClipboard(), HISTORY_KEYS, MedicalRecordSection, medicalRecordSections(), SECTIONS, MEDICAL_RECORD, SOAP (+8 more)

### Community 91 - "no-stray-approval.test.ts"
Cohesion: 0.36
Nodes (7): approvalWrites(), EXPECTED, isComment(), isExempt(), REPO_ROOT, SCANNED_TREES, sourceFiles()

### Community 92 - "backend/tsconfig.typecheck.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, exclude, extends, include, src/**/*, ./tsconfig.json

### Community 93 - "25. Review Copilot Tool-Call Behaviour"
Cohesion: 0.25
Nodes (8): 25.1 The Reported Failure And What Was Actually There, 25.2 Why It Was Invisible To The Suite, 25.3 Method, 25.4 Four Revisions Were Trialled And All Four Rejected, 25.5 The Phantom-Click Diagnostic, 25.6 Evaluation Durability, 25.7 What Stays Open, 25. Review Copilot Tool-Call Behaviour

### Community 94 - "workflow.ts"
Cohesion: 0.21
Nodes (13): BENCH_TRANSCRIPT, TURNS, elapsedMs(), fail(), main(), median(), parseRuns(), runOnce() (+5 more)

### Community 95 - "lint-staged"
Cohesion: 0.25
Nodes (7): lint-staged, AGENTS.md, biome.json, CLAUDE.md, commitlint.config.js, {docs,.github}/**/*.{md,yml,yaml}, {shared,backend,frontend,evals}/**/*.{ts,tsx,js,json}

### Community 96 - "no-stray-fetch.test.ts"
Cohesion: 0.33
Nodes (4): EXPECTED_FETCH_CALLS, fetchCalls(), isFetchCall(), REPO_ROOT

### Community 97 - "20.5 Hosted Draft Turns: Server-Side Split And Label"
Cohesion: 0.29
Nodes (7): 20.5 Hosted Draft Turns: Server-Side Split And Label, Chunking, And Why The Pass Needed It, Failure Taxonomy And Fallback, Gaps, Stated Honestly, Labels Remain Guesses, Mechanism, Why

### Community 98 - "Per-Module Dtype On WebGPU (Issue #144)"
Cohesion: 0.29
Nodes (7): Download Size, Measured 15/08/26, Model, Delivery, And Runtime — Resolved 13/08/26 (§19 Row 13, Closed), Per-Module Dtype On WebGPU (Issue #144), Session And Speed, Same Machine And Recording, The Quantised Decoder Needs Graph Optimisation Disabled, Timestamp Integrity On The Reference Recording, Token A/B, Stated With The Honesty §20.1 Demands

### Community 99 - "Evals"
Cohesion: 0.22
Nodes (8): Adding A Case, Cost And Data, Cost And Data, Evals, Running It, The ASR A/B Harness, What It Grades, Why This Is Not `tests/`

### Community 100 - "AudioCapture.tsx"
Cohesion: 0.11
Nodes (33): bucketName(), chunkPage(), ChunkSpec, cleanPage(), computeRunningHeaders(), EXEC_OPTIONS, execFile, extractFirstPageText() (+25 more)

### Community 101 - "acceptance/safety.test.ts"
Cohesion: 0.11
Nodes (15): CLAIMS, Login(), MarketingShell(), activePath(), Item, ITEMS, SidebarIsland(), LINKS (+7 more)

### Community 103 - "health.ts"
Cohesion: 0.20
Nodes (11): containsDiagnosticProse(), DIAGNOSTIC_PHRASING, DiagnosticGuardResult, stripDiagnosticProse(), BARE_DOSE_REGIMEN, containsUnsafeMedicationProse(), filterUnsafeModelSuggestions(), isUnsafeSuggestion() (+3 more)

### Community 104 - "22. Observability & Privacy-Safe Logging"
Cohesion: 0.33
Nodes (6): 22. Observability & Privacy-Safe Logging, Deliberate Omissions, Residual Risk, The Finding That Shaped The Design, What Is Recorded, Why It Is Structural, Not Conventional

### Community 105 - "23. Clinic EHR Integration Interface"
Cohesion: 0.33
Nodes (6): 23. Clinic EHR Integration Interface, Approved-Note Export Contract, Authentication And Transport, Candidate Standards Assessment, Direction And Trigger, PHI Boundary Under A Real Integration

### Community 106 - "asr.ts"
Cohesion: 0.10
Nodes (23): LiveSessionFailureReason, CONTEXT, getLiveAsrDescriptor(), LANGUAGE_HINTS, liveSessionConfig(), mintSonioxSession(), REASON_BY_STATUS, REGION_HOSTS (+15 more)

### Community 107 - "patients.test.ts"
Cohesion: 0.22
Nodes (5): auditActions, ConsultationRow, consultations, PatientRow, patients

### Community 108 - "notifications.test.ts"
Cohesion: 0.33
Nodes (4): Row, rows, seed(), clock()

### Community 109 - "20.4 The Consent Gate (Resolves §19 Row 18)"
Cohesion: 0.25
Nodes (8): 20.4 The Consent Gate (Resolves §19 Row 18), Ambient Extends This, It Does Not Bypass It, Client Behaviour, Two Controls, Two Questions, What Is Rendered, What Pins This, Added 06/09/26 (#254), What The Copy Claims, And Why It Claims No More, Why The Structure Carries The Rule, Not The Wording

### Community 110 - "24. Frontend Rendering Constraints"
Cohesion: 0.40
Nodes (5): 24. Frontend Rendering Constraints, Glass Inside Glass Is Always Flat, Public Build Inputs, The Two Constraints DESIGN.md Already Names, Verifying A Glass Change

### Community 111 - "CursorGlow"
Cohesion: 0.23
Nodes (12): analyseNote(), buildEvidenceLinks(), EvidenceLink, linkFor(), linksForGroup(), buildClinicalFactsSystemPrompt(), buildNoteAndGapsSystemPrompt(), sharedPreamble() (+4 more)

### Community 112 - "workspaces"
Cohesion: 0.17
Nodes (12): cited(), GapChecklistSource, GapChecklistSourceSchema, NAG_ADULT_COUGH, NAG_ADULT_COUGH_AND_PHARYNGITIS, NAG_PHARYNGITIS, UNSOURCED_PAYER_FIELD, UNSOURCED_URTI (+4 more)

### Community 113 - "20.3 Measured Finding: Hosted `ilmu-asr-v4.2` Against The Shipped Local Path"
Cohesion: 0.50
Nodes (4): 20.3 Measured Finding: Hosted `ilmu-asr-v4.2` Against The Shipped Local Path, Decision, Applying The Rule Written In #151 Before Measurement, Findings, In Order Of Consequence, Token Table, Rojak Sample

### Community 114 - "20.6 Capture Constraints: Dictation DSP Off (Addendum To §20.3)"
Cohesion: 0.50
Nodes (4): 20.6 Capture Constraints: Dictation DSP Off (Addendum To §20.3), Re-Measurement Protocol (Needs A Human Reader), What Changed, What This Rests On, And What It Does Not Claim

### Community 115 - "makeSuggestionsAndRedFlagsSchema"
Cohesion: 0.50
Nodes (4): CitationSchema, ClinicalSuggestionSchema, makeSuggestionsAndRedFlagsSchema(), RedFlagSchema

### Community 117 - "use-live-panes.ts"
Cohesion: 0.33
Nodes (7): appendOnly(), closedSegments(), deltaFor(), mergeFlags(), segmentsToDelta(), EMPTY, TranscriptSegment

### Community 118 - "AmbientCapture.test.tsx"
Cohesion: 0.13
Nodes (15): AmbientProps, config, createLiveSession, draftHostedTurns, FakeMediaRecorder, liveAsrConfig, recorders, renderAmbient() (+7 more)

### Community 120 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, tsx, @types/compression, @types/cors, @types/express, @types/node, typescript, vitest (+7 more)

### Community 127 - "openai-compatible.test.ts"
Cohesion: 0.29
Nodes (5): { completionsCreate, constructed, envMock }, emittedFor(), request(), Schema, SMUGGLED

### Community 128 - "use-segment-recorder.ts"
Cohesion: 0.12
Nodes (18): DEFAULT_SEGMENT_BOUNDS, isSilentThroughout(), rmsFromTimeDomain(), SegmentBounds, SegmentState, shouldCut(), BOUNDS, OpenWindow (+10 more)

### Community 129 - "overrides"
Cohesion: 0.40
Nodes (5): overrides, adm-zip, deepmerge-ts, fast-uri, sharp

### Community 131 - "soniox-stream.ts"
Cohesion: 0.22
Nodes (8): LiveStreamFailure, openSonioxStream(), SonioxMessageSchema, SonioxStreamHandlers, SonioxTokenSchema, blob(), session, toLiveToken()

### Community 132 - "use-segment-recorder.test.ts"
Cohesion: 0.50
Nodes (3): CLAIMS, Landing(), LIMITS

### Community 140 - "transcribe.worker.ts"
Cohesion: 0.18
Nodes (11): countChunks(), WorkerRequest, AsrOptions, ChunkCounter, doLoad(), hasWebGpuAdapter(), load(), loadWasm() (+3 more)

### Community 141 - "CapturePanel.test.tsx"
Cohesion: 0.19
Nodes (4): consultationCaptureProps(), openRecordTab(), renderForSubmit(), setup()

### Community 142 - "asr-live-sessions.test.ts"
Cohesion: 0.21
Nodes (9): auditState, jsonResponse(), mint(), mintedKey(), nextIp(), readConfig(), sessionState, testEnv (+1 more)

### Community 143 - "audio-settings.ts"
Cohesion: 0.26
Nodes (10): AudioSettings, DEFAULT_AUDIO_SETTINGS, loadAudioSettings(), saveAudioSettings(), toConstraints(), TranscriptionEngine, AudioSettingsDialog(), ENGINES (+2 more)

### Community 144 - "src/note-templates.test.ts"
Cohesion: 0.20
Nodes (10): CaptureModeSchema, ConsultationSchema, MedicalRecordNote, MedicalRecordNoteSchema, NoteTemplateSchema, SoapNote, establishedOrFallback(), formatSoapSubjective() (+2 more)

### Community 145 - "consultations-live-analysis.test.ts"
Cohesion: 0.18
Nodes (6): Body, db, llm, sessionState, testEnv, Turn

### Community 146 - "no-stray-transformers.test.ts"
Cohesion: 0.24
Nodes (9): asPosix(), EXTENSIONS, Import, importsOf(), LIVE, reachable(), REPO_ROOT, resolveSpecifier() (+1 more)

### Community 147 - "use-transcript-audio.ts"
Cohesion: 0.15
Nodes (14): db, get(), headers(), put(), recording(), sessionState, testEnv, keepRecording() (+6 more)

### Community 148 - "20.10 Ambient Capture On Soniox, Browser-Direct, Under An API-Minted Key"
Cohesion: 0.20
Nodes (10): 20.10 Ambient Capture On Soniox, Browser-Direct, Under An API-Minted Key, Follow-Ups This Section Creates, Measured 06/09/26: The Policy Pins The Host, And The Host Answers, Measured 06/09/26: What The Endpoint Actually Does, The Mechanism, The Sign-Off, Which Is The Thing §20.9 Was Waiting For, What Is Not Measured, What The Trust Picture Gains And Loses (+2 more)

### Community 149 - "20.9 Ambient Capture On ILMU, And The Mechanism Behind 20.8's Post-Correction Row"
Cohesion: 0.20
Nodes (10): 20.9 Ambient Capture On ILMU, And The Mechanism Behind 20.8's Post-Correction Row, Measured 06/09/26: The Segmentation Penalty On ILMU, Post-Correction: The Mechanism Behind 20.8's Row, Provenance Of The Sources In This Section, The Correction Shape That Was Chosen, The Latency Number Is Fixed Overhead, Which Is The Risk, What Ambient Noise Does To Safety, What Choosing ILMU Costs (+2 more)

### Community 150 - "no-stray-websocket.test.ts"
Cohesion: 0.22
Nodes (7): EXPECTED_WEBSOCKET_SITES, EXTENSIONS, isWebSocketConstruction(), REPO_ROOT, SKIPPED, SRC, websocketSites()

### Community 151 - "MedicalRecordNoteEditor.tsx"
Cohesion: 0.38
Nodes (7): draftToTurns(), timeDraftLines(), parseTranscript(), serialiseTurns(), CapturePanel(), RECORDED_RANK, TABS

### Community 152 - "20.7 Live Ambient Capture: Mechanism, Models, And The Accuracy Chain"
Cohesion: 0.22
Nodes (9): 20.7.1 Measured: Reachability, Containers, And The Context Effect, 20.7 Live Ambient Capture: Mechanism, Models, And The Accuracy Chain, Every Model In The Chain, Is There A Post-Cleaning Model? No, And The Reason Is The Point, Provider Research, And An Unexplained Gap In The Record, Retraction: Language Detection Was Not The Problem, The Mechanism, What Must Be Measured Before This Is Built (+1 more)

### Community 153 - "20.8 How This Design Compares To Industry Practice"
Cohesion: 0.22
Nodes (9): 20.8.1 The Published Work Closest To This Design, 20.8 How This Design Compares To Industry Practice, The Finding That Matters Most: Nobody De-Identifies Before The Model, Two Numbers To Carry Into Any Client Conversation, What The Clinical Literature Says About The Product Itself, What The Research Changed In 20.7, Where This Design Is Behind, Where This Design Leads (+1 more)

### Community 154 - "WorkerResponse"
Cohesion: 0.11
Nodes (14): CAPTURE_MODES, ConsultationSettingsDialog(), ConsultationSettingsPatch, ago(), NotificationRow(), relative, SHAPE, UNITS (+6 more)

### Community 155 - "use-live-panes.test.ts"
Cohesion: 0.25
Nodes (5): apiMock, emptyFacts, FakeApiError, segment(), withClosed()

### Community 156 - "ConsultationRow.tsx"
Cohesion: 0.33
Nodes (5): documents, jurisdiction, publisher, source, sourceLicence

### Community 157 - "consultations-audio.test.ts"
Cohesion: 0.24
Nodes (6): DemoStepBar(), useDemoTour(), HelpButton(), Spotlight(), AppShell(), LiveDataWarning()

### Community 158 - "consultations-live-flags.test.ts"
Cohesion: 0.25
Nodes (5): db, sessionState, testEnv, Turn, upstream

### Community 159 - "20.11 The Live Panes, And Why The Note Is Not One Of Them"
Cohesion: 0.25
Nodes (8): 20.11 The Live Panes, And Why The Note Is Not One Of Them, Decisions A Reviewer Will Question, No Differential Diagnosis, And The Reason Is Regulatory, The Fold, And Why The Model Never Sees The Previous Facts, The Note Stays At Finish, On Evidence, The One-Segment Lookback Is A Safety Requirement, What This Does Not Do, What Updates Live, And What Does Not

### Community 160 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, bench:workflow, build, dev, start, test, typecheck

### Community 161 - "audio.test.ts"
Cohesion: 0.29
Nodes (4): appended, retention, Row, rows

### Community 162 - "live-window.test.ts"
Cohesion: 0.43
Nodes (5): flagIds(), live(), STRADDLING_PAIR, unionOfWindows(), windows()

### Community 165 - "backend/package.json"
Cohesion: 0.40
Nodes (4): license, name, private, type

### Community 167 - "no-stray-audio-persistence.test.ts"
Cohesion: 0.40
Nodes (3): AUDIO_DIR, MAY_PERSIST, MAY_SEND_AUDIO

### Community 168 - "LivePrompter.test.tsx"
Cohesion: 0.20
Nodes (4): LivePanes, none, panes(), show()

### Community 169 - "FakeMediaRecorder"
Cohesion: 0.36
Nodes (4): withRequestContext(), normaliseRoute(), requestContext(), captured

### Community 170 - "token"
Cohesion: 0.33
Nodes (5): CPG Corpus, How Scanned Pages Are Handled, How To Add Documents, Licence Status, What Lives Here

### Community 173 - "InfoTip.test.tsx"
Cohesion: 0.67
Nodes (3): 3. Aim & Objectives, Aim, Objectives

## Knowledge Gaps
- **976 isolated node(s):** `name`, `private`, `license`, `type`, `dev` (+971 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `draftTurns()` connect `draft-turns/index.ts` to `asr.ts`, `cn`, `deid/index.ts`, `AmbientCapture.tsx`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `Settings.tsx`, `ChecklistPanel.tsx`, `ConsultationReview.test.tsx`, `acceptance/safety.test.ts`, `audio-settings.ts`, `PatientList.tsx`, `CatatAI.tsx`, `ConsultationReview.tsx`, `MedicalRecordNoteEditor.tsx`, `StartConsultationDialog.tsx`, `WorkerResponse`, `consultations-audio.test.ts`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `AudioCapture()` connect `cn` to `src/index.test.ts`, `soniox-stream.ts`, `AudioCapture.test.tsx`, `audio-settings.ts`, `MedicalRecordNoteEditor.tsx`, `draft-turns/index.ts`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **What connects `name`, `private`, `license` to the rest of the system?**
  _976 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `includes` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._