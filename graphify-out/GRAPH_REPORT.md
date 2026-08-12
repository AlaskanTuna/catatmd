# Graph Report - ai-clinical-assistant  (2026-08-13)

## Corpus Check
- 31 files · ~14,357 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 432 nodes · 435 edges · 38 communities (37 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `da554282`
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
- 6. LLM Port & Adapter
- 13. API Contracts
- 11. Guideline Corpus
- 4. Data Model (Prisma)
- 7. Environment Contract
- 15. Audit Logging
- 8. HTTP Surface As Built

## God Nodes (most connected - your core abstractions)
1. `TRD` - 20 edges
2. `scripts` - 17 edges
3. `compilerOptions` - 16 edges
4. `PRD` - 16 edges
5. `includes` - 8 edges
6. `lint-staged` - 8 edges
7. `9. De-Identification Pipeline` - 7 edges
8. `17. Environments & Deployment` - 7 edges
9. `scripts` - 6 edges
10. `scripts` - 6 edges

## Surprising Connections (you probably didn't know these)
- `GenerateRequest` --references--> `Deidentified`  [EXTRACTED]
  backend/src/lib/llm/types.ts → backend/src/deid/types.ts
- `OpenAICompatibleClient` --implements--> `LLMClient`  [EXTRACTED]
  backend/src/lib/llm/openai-compatible.ts → backend/src/lib/llm/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PHI Boundary Components** — backend_src_deid, backend_src_lib_llm [EXTRACTED 1.00]

## Communities (38 total, 1 thin omitted)

### Community 0 - "Root Project Configuration"
Cohesion: 0.06
Nodes (30): dependencies, @prisma/client, engines, node, @prisma/client, license, name, private (+22 more)

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
Cohesion: 0.29
Nodes (7): 17. Environments & Deployment, CI, Free-Tier Auto-Pause Mitigation, Migration Flow, Pooled Versus Direct URL Split, Render Service Definition (`render.yaml`), Topology

### Community 25 - "lint-staged"
Cohesion: 0.25
Nodes (7): lint-staged, AGENTS.md, biome.json, CLAUDE.md, commitlint.config.js, {docs,.github}/**/*.{md,yml,yaml}, {shared,backend,frontend}/**/*.{ts,tsx,js,json}

### Community 26 - "PRD"
Cohesion: 0.08
Nodes (23): CAP-1 … CAP-5, CAP-1 — Generate A Structured Clinical Note, CAP-2 — Identify Missing Clinical Information, CAP-3 — Detect Predefined Red Flags And Escalation Triggers, CAP-4 — Provide Clinical Suggestions With Cited References, CAP-5 — Doctor Reviews, Edits, And Approves Before Saving, Clinical Scope, Demo Script (+15 more)

### Community 27 - "9. De-Identification Pipeline"
Cohesion: 0.29
Nodes (7): 9. De-Identification Pipeline, Audit Surface, Detector Inventory, Fail-Closed Semantics, Recall Limitation, Token Format, Vault Lifecycle

### Community 28 - "10. Red-Flag Rules Engine"
Cohesion: 0.33
Nodes (6): 10. Red-Flag Rules Engine, Engine Posture, Evaluation, Merge Rule — The Zero-Suppression Invariant, Trigger Record Shape, What Stays Undecided

### Community 29 - "12. LLM Prompt & Response Contracts"
Cohesion: 0.33
Nodes (6): 12. LLM Prompt & Response Contracts, Latency Budget Tension (Open), Operation 1 — `note_and_gaps`, Operation 2 — `suggestions_and_red_flags`, Retry / Failure Behaviour, Scope Notice For Non-URTI Presentations

### Community 30 - "3. Shared Contracts (`@shared/types`)"
Cohesion: 0.33
Nodes (6): 3. Shared Contracts (`@shared/types`), Clinical Note & Analysis, Consultation Lifecycle, Load-Bearing Semantics, Structured Clinical-Information Schema — Proposal, Transcript

### Community 31 - "6. LLM Port & Adapter"
Cohesion: 0.33
Nodes (6): 6. LLM Port & Adapter, Adapter Mechanism (`OpenAICompatibleClient`), Failure Modes, `GenerateRequest<T>`, `LLMResponseError`, Port (`LLMClient`)

### Community 32 - "13. API Contracts"
Cohesion: 0.40
Nodes (5): 13. API Contracts, Gap — Red-Flag Acknowledgment And Gap Review Have No Columns Yet, New Response Schemas Proposed For `@shared/types`, Routes, State Machine Cross-Check

### Community 33 - "11. Guideline Corpus"
Cohesion: 0.50
Nodes (4): 11. Guideline Corpus, Candidate Set Reaching The Prompt, Chunk Record Shape, Schema-Enforced Rejection

### Community 34 - "4. Data Model (Prisma)"
Cohesion: 0.50
Nodes (4): 4. Data Model (Prisma), Auth Models (better-auth Prisma Adapter), Clinical Domain, Gap: No Data-Retention Or Deletion Path

### Community 35 - "7. Environment Contract"
Cohesion: 0.50
Nodes (4): 7. Environment Contract, Gap: `DEID_FAIL_CLOSED` Is Not Read At The Egress Point, Gap: No Production Guard For DeepSeek (PRC Hosting), Production Guards (Enforced At Boot)

### Community 36 - "15. Audit Logging"
Cohesion: 0.67
Nodes (3): 15. Audit Logging, `AuditEvent.action` Taxonomy, Forbidden Content

### Community 37 - "8. HTTP Surface As Built"
Cohesion: 0.67
Nodes (3): 8. HTTP Surface As Built, Middleware Stack (In Order), Routes

## Knowledge Gaps
- **273 isolated node(s):** `name`, `private`, `license`, `type`, `dev` (+268 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TRD` connect `Frontend Scripts` to `13. API Contracts`, `11. Guideline Corpus`, `4. Data Model (Prisma)`, `7. Environment Contract`, `15. Audit Logging`, `8. HTTP Surface As Built`, `CI Workflow`, `9. De-Identification Pipeline`, `10. Red-Flag Rules Engine`, `12. LLM Prompt & Response Contracts`, `3. Shared Contracts (`@shared/types`)`, `6. LLM Port & Adapter`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Development Tooling` to `Root Project Configuration`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `private`, `license` to the rest of the system?**
  _273 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Root Project Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `Code Formatting Rules` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Clinical Data Models` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._