# Graph Report - ai-clinical-assistant  (2026-08-13)

## Corpus Check
- 32 files · ~23,725 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 490 nodes · 492 edges · 48 communities (47 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fea7fd12`
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
- PRD
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
- 11. Regulatory Posture
- 12. Known Limitations
- 14. Demo Script
- 1. Domain Background
- 13. Success Metrics
- 6. Scope

## God Nodes (most connected - your core abstractions)
1. `TRD` - 22 edges
2. `scripts` - 17 edges
3. `compilerOptions` - 16 edges
4. `PRD` - 16 edges
5. `9. De-Identification Pipeline` - 9 edges
6. `includes` - 8 edges
7. `lint-staged` - 8 edges
8. `3. Shared Contracts (`@shared/types`)` - 8 edges
9. `17. Environments & Deployment` - 8 edges
10. `21. LLM Guardrail Architecture` - 8 edges

## Surprising Connections (you probably didn't know these)
- `GenerateRequest` --references--> `Deidentified`  [EXTRACTED]
  backend/src/lib/llm/types.ts → backend/src/deid/types.ts
- `OpenAICompatibleClient` --implements--> `LLMClient`  [EXTRACTED]
  backend/src/lib/llm/openai-compatible.ts → backend/src/lib/llm/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PHI Boundary Components** — backend_src_deid, backend_src_lib_llm [EXTRACTED 1.00]

## Communities (48 total, 1 thin omitted)

### Community 0 - "Root Project Configuration"
Cohesion: 0.05
Nodes (37): dependencies, @prisma/client, engines, node, @prisma/client, license, lint-staged, AGENTS.md (+29 more)

### Community 1 - "Backend Dependencies"
Cohesion: 0.08
Nodes (25): devDependencies, tsx, @types/compression, @types/cors, @types/express, @types/node, typescript, vitest (+17 more)

### Community 2 - "Code Formatting Rules"
Cohesion: 0.08
Nodes (24): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+16 more)

### Community 3 - "Clinical Data Models"
Cohesion: 0.09
Nodes (22): Citation, CitationSchema, ClinicalSuggestion, ClinicalSuggestionSchema, Consultation, ConsultationAnalysis, ConsultationAnalysisSchema, ConsultationSchema (+14 more)

### Community 4 - "Frontend Build Tools"
Cohesion: 0.10
Nodes (21): devDependencies, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/react, @types/react, @types/react-dom, typescript (+13 more)

### Community 5 - "LLM Integration Services"
Cohesion: 0.18
Nodes (10): DeidentificationResult, Deidentified, TokenVault, build(), getLLMClient(), OpenAICompatibleClient, GenerateRequest, LLMClient (+2 more)

### Community 6 - "Backend API Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, better-auth, compression, cors, dotenv, express, openai, @prisma/client (+11 more)

### Community 7 - "Development Tooling"
Cohesion: 0.11
Nodes (19): @biomejs/biome, @commitlint/cli, @commitlint/config-conventional, concurrently, husky, lint-staged, devDependencies, @biomejs/biome (+11 more)

### Community 8 - "Shared Package Configuration"
Cohesion: 0.11
Nodes (18): dependencies, zod, devDependencies, typescript, exports, typescript, zod, license (+10 more)

### Community 9 - "TypeScript Compiler Settings"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noImplicitOverride (+9 more)

### Community 10 - "Frontend UI Dependencies"
Cohesion: 0.07
Nodes (27): clsx, dependencies, clsx, lucide-react, react, react-dom, react-router-dom, @shared/types (+19 more)

### Community 11 - "Linting Rules"
Cohesion: 0.13
Nodes (15): linter, enabled, rules, level, options, allow, preset, style (+7 more)

### Community 12 - "Frontend TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, jsx, lib, noEmit, types, extends, include, ES2023 (+6 more)

### Community 13 - "Backend TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, types, extends, include, src/**/*, ../tsconfig.json (+2 more)

### Community 14 - "Frontend Scripts"
Cohesion: 0.18
Nodes (10): 14. Auth Model, 16. Security Controls, 18. Traceability, 19. Open Decisions Register, 1. Purpose & Relationship To Other Docs, 2. System Context & Component Responsibilities, 5. The PHI Boundary — Type-Level Contract, Status Tag Legend (+2 more)

### Community 15 - "Server Initialization"
Cohesion: 0.33
Nodes (5): createApp(), EnvSchema, parsed, prisma, healthRouter

### Community 16 - "Shared TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, outDir, rootDir, extends, include, src/**/* (+1 more)

### Community 18 - "Frontend Entry Point"
Cohesion: 0.40
Nodes (3): App(), queryClient, root

### Community 23 - "CI Workflow"
Cohesion: 0.25
Nodes (8): 17. Environments & Deployment, CI, Free-Tier Auto-Pause Mitigation, Free-Tier Seats And Collaborator Access, Migration Flow, Pooled Versus Direct URL Split, Render Service Definition (`render.yaml`), Topology

### Community 25 - "lint-staged"
Cohesion: 0.14
Nodes (13): 10. Safety Constraints, 15. Proposal Source Map, 2. Problem Statement, 3. Aim & Objectives, 4. Who It Is For, 7. Product Principles, 8. Primary Flow, Aim (+5 more)

### Community 26 - "PRD"
Cohesion: 0.33
Nodes (6): 9. Capabilities & Acceptance Criteria, CAP-1 — Generate A Structured Clinical Note, CAP-2 — Identify Missing Documentation, CAP-3 — Detect Predefined Red Flags And Escalation Triggers, CAP-4 — Provide Clinical Suggestions With Cited References, CAP-5 — Doctor Reviews, Edits, And Approves Before Saving

### Community 27 - "9. De-Identification Pipeline"
Cohesion: 0.22
Nodes (9): 9. De-Identification Pipeline, Audit Surface, Detector Inventory, Detector Shape — `pattern + score + context`, Fail-Closed Semantics, Recall Limitation, Token Format, Vault Lifecycle (+1 more)

### Community 28 - "10. Red-Flag Rules Engine"
Cohesion: 0.33
Nodes (6): 10. Red-Flag Rules Engine, Engine Posture, Evaluation, Merge Rule — The Zero-Suppression Invariant, Trigger Record Shape, What Stays Undecided

### Community 29 - "12. LLM Prompt & Response Contracts"
Cohesion: 0.33
Nodes (6): 12. LLM Prompt & Response Contracts, Latency Budget Tension (Open), Operation 1 — `note_and_gaps`, Operation 2 — `suggestions_and_red_flags`, Retry / Failure Behaviour, Scope Notice For Non-URTI Presentations

### Community 30 - "3. Shared Contracts (`@shared/types`)"
Cohesion: 0.25
Nodes (8): 3. Shared Contracts (`@shared/types`), Clinical Note & Analysis, Consultation Lifecycle, Load-Bearing Semantics, Malaysian Operational Block, Ratification Conditions (Research-Imposed), Structured Clinical-Information Schema — Ratified 13/08/26, Transcript

### Community 31 - "21. LLM Guardrail Architecture"
Cohesion: 0.25
Nodes (8): 21.1 Measured Finding — Fabricated Clinical Negatives, 21.2 Provider Constraint — Strict Structured Output Is Not Universal, 21.3 Control Tiers, 21.4 Evidence-Bound Assertion — The Primary Control, 21.5 Transcript As Untrusted Input, 21.6 Independent Corroboration Of The §21.1 Mechanism, 21.7 What Stays Open, 21. LLM Guardrail Architecture

### Community 32 - "vercel.json"
Cohesion: 0.29
Nodes (6): buildCommand, framework, installCommand, outputDirectory, rewrites, $schema

### Community 33 - "6. LLM Port & Adapter"
Cohesion: 0.33
Nodes (6): 6. LLM Port & Adapter, Adapter Mechanism (`OpenAICompatibleClient`), Failure Modes, `GenerateRequest<T>`, `LLMResponseError`, Port (`LLMClient`)

### Community 34 - "13. API Contracts"
Cohesion: 0.40
Nodes (5): 13. API Contracts, Gap — Red-Flag Acknowledgment And Gap Review Have No Columns Yet, New Response Schemas Proposed For `@shared/types`, Routes, State Machine Cross-Check

### Community 35 - "20. Browser-Side ASR Contract"
Cohesion: 0.33
Nodes (6): 20. Browser-Side ASR Contract, Interaction With Existing Contracts, Model, Delivery, And Runtime — Resolved 13/08/26 (§19 Row 13, Closed), Threat: ASR Is A Second Fabrication Surface, What Crosses The Network, Where Transcription Runs

### Community 36 - "11. Guideline Corpus"
Cohesion: 0.33
Nodes (6): 11. Guideline Corpus, Candidate Set Reaching The Prompt, Chunk Record Shape, One Source Per Chunk — A Safety Requirement, Not A Style Rule, Schema-Enforced Rejection, Source Selection — Resolved 13/08/26 (§19 Row 3, Closed)

### Community 37 - "4. Data Model (Prisma)"
Cohesion: 0.50
Nodes (4): 4. Data Model (Prisma), Auth Models (better-auth Prisma Adapter), Clinical Domain, Gap: No Data-Retention Or Deletion Path

### Community 38 - "7. Environment Contract"
Cohesion: 0.50
Nodes (4): 7. Environment Contract, Gap: `DEID_FAIL_CLOSED` Is Not Read At The Egress Point, Gap: No Production Guard For DeepSeek (PRC Hosting), Production Guards (Enforced At Boot)

### Community 39 - "15. Audit Logging"
Cohesion: 0.67
Nodes (3): 15. Audit Logging, `AuditEvent.action` Taxonomy, Forbidden Content

### Community 40 - "8. HTTP Surface As Built"
Cohesion: 0.67
Nodes (3): 8. HTTP Surface As Built, Middleware Stack (In Order), Routes

### Community 41 - "5. Market Fit"
Cohesion: 0.33
Nodes (6): 5. Market Fit, Commercial Path — Stated As Estimate, Not Finding, Ground Already Occupied — Not Claimed As Novel, Positioning, The Scribe Function Is Already Commoditised Here, What Is Table Stakes Versus What Is Differentiating

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

## Knowledge Gaps
- **318 isolated node(s):** `name`, `private`, `license`, `type`, `dev` (+313 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TRD` connect `Frontend Scripts` to `6. LLM Port & Adapter`, `13. API Contracts`, `20. Browser-Side ASR Contract`, `11. Guideline Corpus`, `4. Data Model (Prisma)`, `7. Environment Contract`, `15. Audit Logging`, `8. HTTP Surface As Built`, `CI Workflow`, `9. De-Identification Pipeline`, `10. Red-Flag Rules Engine`, `12. LLM Prompt & Response Contracts`, `3. Shared Contracts (`@shared/types`)`, `21. LLM Guardrail Architecture`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `PRD` connect `lint-staged` to `5. Market Fit`, `11. Regulatory Posture`, `12. Known Limitations`, `14. Demo Script`, `1. Domain Background`, `13. Success Metrics`, `6. Scope`, `PRD`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Development Tooling` to `Root Project Configuration`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `name`, `private`, `license` to the rest of the system?**
  _318 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Root Project Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `Code Formatting Rules` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._