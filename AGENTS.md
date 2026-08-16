# AGENTS.md

> This file is the **canonical, tool-agnostic** project instructions — every agentic tool (Claude Code, Codex, Antigravity, …) reads it natively, and `CLAUDE.md` is a thin adapter that imports it. **Every agent working in this repository follows these rules**, regardless of which collaborator or harness dispatched it.

---

## Project

**ai-clinical-assistant** — an AI assistant that turns a GP consultation transcript into a reviewable structured clinical note, with missing-information prompts, red-flag detection, and cited clinical suggestions.

Clinical scope is deliberately narrow: **adult GP consultations for acute cough, sore throat, and other upper respiratory symptoms**. The system **does not diagnose and does not replace clinical judgement** — the doctor reviews, edits, and approves every output, and remains fully responsible for all medical decisions. All consultation data used here is **simulated**; no real patient data enters this repo.

This is a prototype built to a high standard because it will be evaluated by an external party. Treat quality, security posture, and documentation as first-class deliverables, not as polish to add later.

---

## Architecture

Three-tier: React SPA → Express API → Postgres. The API is the only component holding identifiable data; the LLM sits **outside** the trust boundary and is reached only through a de-identification gate.

**The central invariant — the PHI boundary:** no text containing patient identifiers may leave the API. Every outbound LLM call passes through `backend/src/deid/` first, which replaces identifiers with stable pseudonymous tokens (`[PATIENT_1]`, `[NRIC_1]`) held in a request-scoped vault; responses are re-hydrated on the way back. `LLMClient` is the only egress point, and it refuses input that has not been through the gate. Treat any change that lets raw transcript text reach a provider SDK as a **critical defect**, not a style issue.

The LLM provider is a **swappable adapter** behind `backend/src/lib/llm/` — this is a deliberate architectural commitment, not incidental indirection. It is what lets the proposal answer "how is patient data prevented from reaching the LLM" and "what happens when data residency requirements change" with the same answer.

**Red flags are deterministic first.** `backend/src/redflags/` is a rules engine over a versioned trigger list; the LLM runs as a second pass and may only _add_ candidates for doctor review, never suppress a rule hit. Patient safety must not depend on model behaviour.

**Citations are ID-constrained.** The model may only cite guideline IDs supplied to it from `backend/src/guidelines/`; free-text references are rejected at parse time. This makes hallucinated medical references structurally impossible rather than merely unlikely.

See `docs/trd.md` (canonical) once written. Do not create `docs/architecture.md`.

### Repo layout

```
shared/          @shared/types — Zod schemas + inferred types, built first, imported by both sides
backend/         Express 5 API (tsx dev, tsc build)
  src/deid/      PHI detection, tokenisation, re-hydration vault  ← the trust boundary
  src/lib/llm/   LLMClient port + qwen/gemini/deepseek adapters   ← the only egress point
  src/redflags/  deterministic escalation-trigger rules engine
  src/guidelines/ curated citation corpus (ID-constrained)
  src/routes/    HTTP surface
frontend/        Vite + React 19 SPA (Tailwind 4, Radix, TanStack Query)
prisma/          schema.prisma + migrations (Supabase Postgres)
docs/            workflow + product docs
```

---

## Tech Stack

- **Runtime/PM:** Node 24, **Bun** workspaces (`bun install`, `bun run`) — root `package.json` declares `workspaces`
- **Shared:** TypeScript 5.9, **Zod** — schemas live in `shared/` and are the single source of truth for both sides
- **Backend:** Express 5, tsx (dev), Prisma 6 (`@prisma/client`), **better-auth** (Prisma adapter), Vitest
- **Frontend:** React 19, Vite 7, Tailwind 4, Radix UI, TanStack Query 5, react-router 7
- **Database:** **Supabase Postgres** — used as Postgres only (auth is better-auth, in the Prisma schema). Pooled URL (Supavisor, `:6543`) for the app; direct URL (`:5432`) for migrations
- **LLM:** provider-agnostic. Default **Qwen** via Alibaba Model Studio **Singapore** endpoint (OpenAI-compatible); Gemini free tier is **local dev only, synthetic data only**; DeepSeek for benchmarking. Selected by `LLM_PROVIDER`
- **Tooling:** Biome (lint/format), Prettier (md/yml only), Husky + commitlint, Vitest
- **Hosting:** frontend → Vercel · backend → Render (Singapore) · database → Supabase (Singapore). All three in-region by design — data residency is a scored part of the brief.

---

## Commands

```bash
bun install                  # install all workspaces
bun run dev                  # shared watch + backend + frontend concurrently
bun run dev:backend          # build shared, then backend only
bun run dev:frontend         # build shared, then frontend only

bun run db:migrate           # prisma migrate dev   (uses DIRECT_URL)
bun run db:studio            # prisma studio
bun run prisma:generate      # regenerate client

bun run lint                 # biome check .
bun run format               # biome format --write + prettier for md/yml
bun run typecheck            # tsc --noEmit across all three workspaces
bun run test                 # vitest run (shared + backend + frontend)
bun run build                # shared → prisma generate → backend tsc → frontend vite build
```

---

## Code Style

- **Naming:** `camelCase` values/functions, `PascalCase` types/components/Zod schemas (`ClinicalNoteSchema`), `SCREAMING_SNAKE` env vars. Files: `kebab-case.ts`, React components `PascalCase.tsx`. Prisma models `PascalCase` singular, columns `camelCase`.
- **Types:** No `any` — prefer `unknown` + narrowing. **Zod at every boundary** (HTTP request/response, LLM output, env). Types are _inferred from_ schemas (`z.infer`), never hand-written alongside them. Shared contracts live in `shared/`; never redeclare a shared type locally.
- **Error handling:** Validate at system boundaries; do not wrap internal framework calls in try/catch.
- **Comments:** Default to none. Comment only when the _why_ is non-obvious. Never describe _what_ the code does.
- **Changes are surgical:** touch only what the task requires; match existing style; don't refactor what isn't broken.

> Full behavioral coding guidelines (Andrej Karpathy) are appended at the end of this file.

---

## Documentation Hygiene

- **Formatting:** Title Case applies to headings, subheadings, labels, bullet-point lead-ins, and table headers. Full sentences and commit subjects stay in normal sentence case.
- **Conciseness:** Do not clump long descriptive prose into one block. Break text into bullet points, tables, or short subsections. If a paragraph runs past ~4 lines, it probably wants to be a list or a table.
- **Forward-looking only:** Apply this to what you write or touch. Do not sweep existing docs to conform — a repo-wide retitle buries real changes in noise.

### README vs TRD

`README.md` and `docs/trd.md` may both describe architecture. They differ in **depth and audience**, not in subject.

|              | `README.md`                                                                                           | `docs/trd.md`                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Audience** | Readers — external reviewers, collaborators, anyone landing on the repo                               | Developers implementing against it                                        |
| **Depth**    | High-level narrative: the WHATs, HOWs, and WHYs                                                       | Canonical implementation-level technical reference                        |
| **Contains** | Architecture overview, diagrams for notable components and pipelines, setup, constraints, limitations | API contracts, data models, schemas, pipeline details, decision rationale |
| **Rule**     | Anything an outside reader legitimately needs must live here                                          | Never duplicate the README's narrative; go deeper instead                 |

Both are committed in this repo, so "it's in the TRD" is a valid answer for implementation detail — but **not** for anything a reviewer needs to understand the system. This project is evaluated partly on the README.

`README.md` lives in **`docs/`**, not the repo root. GitHub renders `docs/README.md` as the repository landing page, so it is still the front door — keep links relative to `docs/`.

### README Structure And Density

The README is **scanned, not studied**. A reviewer decides what to read from headings, tables and bold lead-ins, so a section that is correct but dense is a section that does not get read. These rules apply to `docs/README.md` specifically, and are stricter than the general Conciseness rule above.

**Density, in order of how often each is broken:**

- **No prose block over four lines.** If a paragraph runs longer it is a list, a table, or two paragraphs. Split on the seam between the claim and its justification: the claim leads, the reasoning follows.
- **Three or more consecutive bolded-lead-in paragraphs are a table.** A run of `**Claim.** explanation` blocks reads as a wall. Two columns, claim and how it is enforced, says the same thing and can be skimmed.
- **An enumeration inside a sentence is a list.** Any sentence naming three or more vendors, fields, states, controls or absences belongs in bullets or a table. Semicolons separating list items are the tell.
- **One idea per block.** A paragraph that states a rule, justifies it, and then cites a section is three blocks.
- **Trim before restructuring** when the content is not load-bearing, but **never drop a measured figure, a citation, a section reference, or a limitation** to save space. Reformatting must be lossless; verify by grepping the claims out of the old version and back into the new.

**Navigation, applied to every top-level (`##`) section:**

- **A `---` divider before each section**, so the page reads as blocks rather than a scroll.
- **A back-to-top link at the foot of each section**, right-aligned, pointing at an `<a id="top"></a>` anchor on the first line of the file:
  ```html
  <div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>
  ```
- **Any heading that is linked to needs an explicit `<a id="..."></a>` above it.** GitHub's auto-generated slug drops a leading emoji but keeps the hyphen the space left behind, and an emoji carrying a variation selector makes the result unpredictable. A reviewer clicks a broken anchor once and does not try again.

---

## Working Conventions

- **CLI-first, always.** Reach for a CLI tool before a GUI — `gh` for anything GitHub, `supabase` for the database, `vercel` and `render` for deploys, `prisma` for schema work. Manual GUI configuration is a last resort, and when it is genuinely unavoidable, record the exact steps in `docs/trd.md` so it is reproducible. The goal is efficient, scriptable, reviewable development; clicking through a dashboard leaves no trace and cannot be handed to a collaborator.
- **Task tracking lives in GitHub Issues.** The repo's issue page is the shared task list and TODO backlog between collaborators — not a markdown file, not a chat message. Every issue carries a **clear assignee** and **labels**. Any work that crosses between collaborators must be visible as an issue before it starts. Use `gh issue create`, `gh issue list`, `gh issue edit` rather than the web UI.
  - Templates live in `.github/ISSUE_TEMPLATE/` (`task.yml`, `bug.yml`). Agents filing an issue from the CLI must reproduce the template's sections in the body — an issue without **Acceptance Criteria** and **File Scope** is incomplete, because those two fields are what make parallel work collision-free and review objective.
  - Label taxonomy: `type:task` / `type:bug`, one `area:*` (`deid`, `llm`, `redflags`, `guidelines`, `api`, `ui`, `db`, `infra`, `docs`), and a `priority:*` where it matters.
  - PRs follow `.github/PULL_REQUEST_TEMPLATE.md`. Its **Clinical-Safety Checklist** is not optional when the diff touches `deid/`, `lib/llm/`, `redflags/`, `guidelines/`, or logging.
- **Two lanes to `main`, chosen by what the change is, not by how big it is.**
  - **Docs Lane, direct to `main`.** Prose only: `docs/**` plus root prose such as `README.md`. Commit straight to `main`, no branch, no PR. Every push to `main` runs `verify`, so the commit has to stand on its own. It does not deploy: `docs/**` is outside the deployable paths filter (`.github/workflows/ci.yml`), which is what makes this lane cheap against Vercel's daily deployment cap. Do not widen that filter to include docs; issue #82 is what it was added to fix.
  - **A mixed diff is Branch Lane, docs included.** "Prose only" means the whole diff. A change that also touches code takes the Branch Lane entire, so the prose describing a change ships in the same PR as the change itself rather than being split out.
  - **Branch Lane, everything else.** Feature branch → PR → `gh pr merge --squash --delete-branch`. The branch is always deleted on merge, so no residue accumulates. Size is not a reason to skip it: a one-line code, config, or workflow fix still takes a branch.
  - **Markdown is not automatically docs.** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`, `.claude/agents/*.md`, `.agents/skills/**/SKILL.md`, and `.github/*.md` change how agents behave rather than describing the project. They take the Branch Lane whatever their size.
- **Parallel work runs in isolated worktrees, one per branch.** Two agents editing one working tree collide, and a branch switch under a running agent strands it. Give each concurrent piece of Branch Lane work its own worktree and its own session. Prefer the harness's native worktree support over `git worktree add` by hand, so creation and cleanup stay something the harness can see and sweep; `.agents/skills/using-git-worktrees/` holds the fallback procedure, and `CLAUDE.md` holds the Claude Code mechanics.
  - **Review agents stay in the main checkout.** A reviewer dispatched into a fresh worktree reviews a clean tree instead of your diff, which reads as a pass. Isolation is for agents that write, not agents that read.
  - A worktree is a fresh checkout carrying no gitignored files. It needs `.env` copied in, plus its own `bun install` and `bun run prisma:generate`, before the suite will pass there.
- **Project skills are committed**, so every collaborator's agent has the same capabilities on clone — no per-machine setup. They live in **`.agents/skills/`** (the tool-agnostic home) and are symlinked from `.claude/skills/`; see `.agents/skills/README.md` for the layout and the Windows symlink caveat.
  - **healthcare-cdss-patterns** — read before touching `redflags/` or any clinical scoring. Its core rule is ours: the engine is a pure function library with zero side effects and **zero tolerance for false negatives**.
  - **healthcare-phi-compliance** — read before touching `deid/`, `AuditEvent`, or access control.
  - **better-auth-security-best-practices** — read before touching auth wiring.
  - **superpowers** (14 skills, vendored) — brainstorming, writing-plans, test-driven-development, systematic-debugging, verification-before-completion and more. These are process skills: they set the approach before implementation skills carry it out.
  - **impeccable** — the one exception, a real directory at `.claude/skills/impeccable/` because its hook manifest hard-codes that path. The hook is wired in the committed `.claude/settings.json` and fires on every UI edit; QA runs `npx impeccable detect` on UI diffs as the deterministic audit. Never suppress a design finding without explicit human confirmation; waivers go through `/impeccable hooks ignore-*` only. Needs Node ≥ 22.12.
- **Report concisely — do not overwhelm the human.** When you finish a piece of work, give a short, digestible summary: what changed, and anything they must decide or act on. Lead with the outcome.
  - **Do not** paste full file contents, long diffs, exhaustive file listings, command transcripts, or a replay of your reasoning.
  - Prefer a few bullets or a small table over paragraphs. If the summary runs past roughly 10 lines, it is too long — cut it.
  - Detail belongs in the diff, `docs/`, and the PR body. The human will ask if they want more.
  - **Brevity must never hide a problem.** Blockers, risks, failed tests, and skipped work are always stated explicitly, even when everything else is compressed away.
- **No secrets in repo.** `.env.example` committed, `.env` gitignored. Engagement terms, client names, and commercial figures are **confidential** — they belong in local-only notes, never in tracked files, commit messages, issues, or PR descriptions. One explicit exception: the project submission URL (`docs/prd.md`) is permitted and expected in tracked files, not a confidentiality-check hit. The fee figure, engagement length and dates, and the submission deadline framed as an external commitment stay banned everywhere else.

---

## Critical Do-Nots

- **Do not** `git push --force`, rewrite published history, or delete branches other than a merged feature branch.
- **Do not** commit or push without explicit human authorization.
- **Do not** create `docs/architecture.md` — architecture lives in `docs/trd.md`.

**Clinical-safety do-nots — these are the ones that lose the deal:**

- **Do not** send un-de-identified text to any LLM provider. Every egress goes through `backend/src/deid/` then `LLMClient`. No direct provider SDK calls anywhere else in the codebase.
- **Do not** commit real patient data, real NRICs, or anything scraped from a real clinical system. All fixtures are **synthetic** and live in `backend/src/fixtures/`.
- **Do not** let the LLM suppress, downgrade, or filter a deterministic red-flag hit. It may only add candidates for the doctor to review.
- **Do not** allow free-text medical citations. The model cites guideline **IDs** from the supplied corpus; anything else fails schema validation.
- **Do not** present any output as a diagnosis, or auto-approve a note. The doctor's explicit approval is a required state transition, never a default.
- **Do not** point `LLM_PROVIDER=gemini` at anything but synthetic local data — the free tier's terms permit Google to use submitted content for product improvement and human review.
- **Do not** log transcript bodies, note contents, or de-identification vault entries. Log IDs and event types only.

---

## Git Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/): `<type>[scope]: <description>` — single imperative sentence, no trailing period. Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`. The PM proposes the message at Gate 2; the human authorizes the commit.

---

<!-- andrej-karpathy-skills -->

# Coding Guidelines (Andrej Karpathy)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- andrej-karpathy-skills -->

<!-- rtk-instructions v2 -->

# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Only if `rtk` is installed** (`which rtk`) — not all teammates have it. If it's missing, run commands directly and ignore this entire RTK section.

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:

```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)

```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)

```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)

```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)

```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)

```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)

```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)

```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)

```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)

```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands

```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category         | Commands                       | Typical Savings |
| ---------------- | ------------------------------ | --------------- |
| Tests            | vitest, playwright, cargo test | 90-99%          |
| Build            | next, tsc, lint, prettier      | 70-87%          |
| Git              | status, log, diff, add, commit | 59-80%          |
| GitHub           | gh pr, gh run, gh issue        | 26-87%          |
| Package Managers | pnpm, npm, npx                 | 70-90%          |
| Files            | ls, read, grep, find           | 60-75%          |
| Infrastructure   | docker, kubectl                | 85%             |
| Network          | curl, wget                     | 65-70%          |

Overall average: **60-90% token reduction** on common development operations.

<!-- /rtk-instructions -->

<!-- graphify-instructions v1 -->

# Graphify - Codebase Knowledge Graph

## Golden Rule

**Only if `graphify` is installed** (`which graphify`) — not all teammates have it. If it's missing, ignore this entire Graphify section and navigate the codebase normally.

Graphify builds a persistent, queryable knowledge graph of this project, so you answer architecture and relationship questions from a compact map instead of grepping and reading many files.

## When to use it

If `graphify-out/graph.json` exists, treat codebase questions ("how does X work", "what calls Y", "where is Z handled", "trace the data flow") as a **`graphify query`** FIRST — before grep/read:

```bash
graphify query "how does auth reach the database"   # BFS over the graph
graphify query "..." --budget 1500                   # cap the answer at N tokens
graphify path "AuthModule" "Database"                # shortest path between two concepts
graphify explain "SomeNode"                          # plain-language explanation of a node
```

**Applies to every agent** — the PM _and_ PG/programmer subagents (Codex workers read this AGENTS.md too): run `graphify query` before grepping for architecture/relationship questions, then drop to grep/sed/Read for exact `file:line` evidence — the graph gives you the file, not the line. Query results interleave code, UI (screenshot), and doc nodes; ask a narrow question and use `--budget` to keep the answer focused.

## Scope before the first build (avoid a token blowout)

Before the first `/graphify .`, create a `.graphifyignore` at the repo root (gitignore syntax — graphify merges it with `.gitignore`, and `!` can re-include). Write this sensible default, then **ask the human (AskUserQuestion) to confirm or adjust it before building** — large or asset-heavy repos can otherwise burn a lot of tokens on the first extraction:

```gitignore
# Keep the knowledge graph focused. Merged with .gitignore (! re-includes).
# Use docs/* (not docs/) so the ! lines below can re-include specific files.
docs/*
!docs/prd.md
!docs/trd.md
.claude/
AGENTS.md
CLAUDE.md
GEMINI.md
.cursorrules
.windsurfrules
RTK.md
*.pdf
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.ico
*.svg
assets/
public/assets/
```

## Keeping the graph fresh

- No graph yet, and this is a real codebase? **Scope it first** (write/confirm `.graphifyignore`, above), then build once: `/graphify .` (code-only = free, no API key).
- After changing code, refresh incrementally: `graphify update .` (no LLM). A SessionStart hook may already do this automatically.

## Shared graph? Add a commit hook

Sharing the graph with collaborators? Two things.

**Keep the committed surface lean.** Commit only `graph.json` (queryable) and `GRAPH_REPORT.md` (human-readable); gitignore the regenerable, churny artifacts — `graph.html` (megabytes, rebuilt every commit), `cache/`, and machine-local state — which teammates rebuild locally via the hook below. Add to `.gitignore`:

```gitignore
graphify-out/*
!graphify-out/graph.json
!graphify-out/GRAPH_REPORT.md
```

**Refresh on commit.** If `graphify-out/` is committed and the repo uses Husky (`.husky/` exists), add — or append to — a committed `.husky/post-commit` so every commit refreshes the graph in lockstep with the code (fewer `graph.json` merge conflicts):

```sh
# Keep the committed knowledge graph in sync with committed code
[ -f graphify-out/graph.json ] && command -v graphify >/dev/null 2>&1 && graphify update . >/dev/null 2>&1 || true
```

Graphify (codebase comprehension) and RTK (command-output compression) are complementary — use both when present.

<!-- /graphify-instructions -->
