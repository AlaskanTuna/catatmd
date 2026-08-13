# Kickoff — CatatMD backend session (@Andersonnn7788)

> **A dated session brief, not standing policy.** Written 13/08/26 to start parallel build sessions after `docs/prd.md` and `docs/trd.md` were finalised. Committed so both collaborators' agents work from the same instructions. The canonical, durable rules live in `AGENTS.md` — where this brief and `AGENTS.md` disagree, `AGENTS.md` wins.

You are working on **CatatMD** — the `catatmd` repository — on behalf of **@Andersonnn7788**. Your lane is the backend. Work from wherever your local clone lives.

---

## First: two things that will block you if not done

1. **The repository was renamed.** If your remote still points at `ai-clinical-assistant`, fix it before anything else:
   ```bash
   git remote set-url origin https://github.com/AlaskanTuna/catatmd.git
   git fetch origin && git checkout main && git pull --rebase
   ```
2. **You need a local `.env`.** It is gitignored and carries real secrets — `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `QWEN_API_KEY`. `.env.example` shows the shape but not the values. **If you do not have these, stop and comment on your first assigned issue tagging @AlaskanTuna to request them.** Do not invent placeholder values and do not commit anything resembling a secret.

**Read before doing anything, in this order:** `AGENTS.md` (canonical project instructions — conventions, clinical-safety do-nots, commit rules) → `docs/prd.md` → `docs/trd.md` → your assigned issues on GitHub.

Both `prd.md` and `trd.md` are **Final for the MVP** as of 13/08/26 — they are the contracts. Build against them; do not redesign them.

> **Note on documents you will not find.** `docs/roles.md`, `docs/plan.md`, `docs/progress.md` and `docs/decisions.md` are part of a **git-excluded private workflow layer** on @AlaskanTuna's machine. They are not missing from your clone by accident and you are not expected to have them. Everything you need is in `AGENTS.md`, the two canonical documents, and the issues. Do not create local copies of them, and do not add them to the repository.

---

## What CatatMD is

An assistant that turns a Malaysian GP consultation transcript into a **reviewable** structured clinical note — with documentation gaps, deterministic red-flag detection, and citation-constrained clinical suggestions. Clinical scope is narrow and deliberate: **adult acute cough, sore throat, and other upper respiratory symptoms.**

The product does not diagnose and does not replace clinical judgement. Every output is reviewed, edited and explicitly approved by the doctor.

**The thesis you are building:** the safety properties are _architectural_, not promised. De-identification is enforced at a single egress point that refuses un-gated input. Red flags come from a deterministic rules engine the model never sees. Citations are ID-constrained so a hallucinated reference is structurally impossible. **You own almost all of that** — four of the ten sections this project is evaluated on are about the code in your lane.

---

## Your lane, and its hard boundaries

**Yours:** `backend/`, `prisma/`, and the Supabase database.

**Not yours, under any circumstances:**

- **Vercel and Render.** @AlaskanTuna owns all deployment. Do not deploy, do not change platform environment variables, do not run `vercel` or `render` CLI commands. If something needs a deployment change, comment on the issue and tag him.
- **`frontend/`** — his, and a second agent is working it.
- **`shared/`** — his. Issue #31 defines the schema contracts you build against. **If you need a change to a shared schema, do not edit it yourself.** Comment on #31 tagging @AlaskanTuna with exactly what you need and why.

### ⚠ Database migrations — you are the only one who runs them

Supabase is a **single shared instance**, not per-developer. Two people running `prisma migrate dev` against it will corrupt each other's migration history. You own schema migrations. Before creating one:

- `git pull --rebase` first, always.
- Run migrations against `DIRECT_URL` (port 5432), never the pooled URL.
- Commit the generated migration directory in the same PR as the schema change.
- Never edit or delete a migration that already exists on `main`.

---

## Reporting protocol — this is how you talk to @AlaskanTuna

He is away and is not watching this session. **GitHub issue comments are the only channel.**

- **When you complete a task:** comment on that issue with what changed, the PR number, what you verified (with real command output), and anything you deliberately did not do. Tag **@AlaskanTuna**.
- **When you need a decision or are blocked:** comment on the relevant issue, tag **@AlaskanTuna**, state the question in one paragraph, give your recommended default, and say what you will do if he does not reply. **Then keep working on something else** — do not idle.
- **Batch questions.** Surface everything you can foresee in your first pass rather than drip-feeding.

---

## Task order

### Start immediately — these do not wait on #31

| Issue   | Notes                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#14** | Auth, RBAC, secure data handling. Read the two pinned comments first — `sameSite: 'none'` is mandatory, not `lax`, and the failure mode is deceptive.                                                         |
| **#29** | Guest sign-in. **Decided** — read the decision comment before building. Shared account, risk accepted, and the shared-visibility behaviour must be stated in the sign-in UI copy you provide.                 |
| **#9**  | De-identification gate. **The single most important module in this repository.** See below.                                                                                                                   |
| **#11** | Synthetic fixtures. Malaysian register: Manglish, **MC** not "sick note", panel patients, medicine dispensed at the clinic, NRIC, RM. Design them as _gradeable_ cases — one deliberately hard, one red-flag. |
| **#8**  | Guideline corpus. NICE is **excluded** — its licence forbids AI use. Anchor on MOH NAG 2024, Abdullah et al. 2024, Ooi et al. 2022. One source per chunk; see below.                                          |

### After #31 merges — watch that issue for the announcement

**#7** (deterministic red-flag rules) → **#3** and **#5** (extraction, editable note) → **#4** and **#6** (Unknown ≠ Negative, gaps engine) → **#12** (persistence) → **#16** (versioning) → **#13** (clinical-safety acceptance suite).

---

## The three modules where a subtle mistake is a critical defect

**#9 — the de-identification gate.** This is the direct answer to "how is patient data prevented from reaching the LLM", which is a scored proposal section. `LLMClient.generate()` accepts only a branded `Deidentified` string, so a plain `string` is a compile error. Detection is `pattern + score + context-words` (TRD §9), with NRIC structural validation and a Malaysian name gazetteer. The vault is **request-scoped** — never a module-level singleton, never persisted, never logged. **@AlaskanTuna will review this PR line by line.** Write it expecting that.

**#7 — the red-flag rules engine.** A pure function library: zero side effects, zero I/O, **zero tolerance for false negatives**. The model never sees its output and may only _add_ candidates. A rule without a test asserting it fires is not done. Read the `healthcare-cdss-patterns` skill before starting.

**#8 — the guideline corpus.** One source per chunk, always. MOH NAG 2024 and the 2024 Malaysian consensus **disagree** at Centor/McIsaac 3 — merging them would let the model cite a manufactured consensus through a _valid_ ID, which the ID-constraint mechanism structurally cannot catch. Carry `sourceLicence` and `verbatimAllowed`; NAG is all-rights-reserved (summarise and link, never quote).

---

## Hard constraints — violating any of these is a critical defect, not a style issue

1. **No un-de-identified text reaches any LLM provider.** Every egress goes through `backend/src/deid/` then `LLMClient`. No direct provider SDK calls anywhere else in the codebase.
2. **No hardcoded outputs, stubbed model calls, mocked red flags, or faked latency.** If the demo shows a note, the pipeline produced it. **This does not mean removing fixtures** — synthetic fixture _inputs_ are a clinical-safety mandate; hardcoded _outputs_ are what is banned.
3. **The LLM may never suppress, downgrade, or filter a deterministic red-flag hit.**
4. **No free-text citations.** Guideline IDs from the supplied corpus, validated at parse time.
5. **`diagnosis` is transcription-bound.** It records only an impression the doctor stated, carries a verbatim transcript span, and defaults to `NOT_ASSESSED`. The system may never produce a diagnosis the doctor did not say.
6. **Never log transcript bodies, note contents, or vault entries.** IDs and event types only.
7. **`QWEN_MODEL` stays pinned to `qwen-flash`** — the only model on the account accepting JSON-Schema-constrained decoding. Read TRD §21.2 before touching it.
8. **Confidentiality.** The client name, any fee figure, the engagement length, and the deadline-as-commitment must never appear in a tracked file, commit message, issue, or PR. Before every push:
   ```bash
   git ls-files -z | xargs -0 grep -nIiE "kabel|RM ?3,?000|8-week" | grep -v "dxp\.kabel\.my/candidate/projects" || echo CLEAN
   ```
9. **The PR Clinical-Safety Checklist is not optional** for any diff touching `deid/`, `lib/llm/`, `redflags/`, `guidelines/`, or logging.

---

## Shipping

Feature branch → PR → `gh pr merge --squash --delete-branch`. **One PR per issue**, never one large one — @AlaskanTuna needs to review these independently. Always `git pull --rebase` before pushing; two humans and two agents share this repository.

Conventional Commits: `<type>[scope]: <description>`, imperative, no trailing period.

**Verify before claiming done.** `bun run lint`, `bun run typecheck`, `bun run test`. Paste real output into the issue comment. Never assert a pass you did not observe.

**Your progress log is the issue tracker**, not a markdown file — the workflow documents that would normally carry it are outside your clone (see the note above). So: the PR body records what changed and why, and the issue comment records the outcome, the verification output, and anything deliberately left undone. Between them they are the durable record of your work. If you settle a lasting technical decision — a library choice, a convention, a resolved trade-off — say so explicitly in the PR body under a **Decision** heading so @AlaskanTuna can carry it into the decision ledger on his side.

---

## Working expectations

- **TDD on #7, #4 and #9.** Write the failing test first.
- **Surgical changes.** Every changed line traces to the issue you are working. Do not refactor what is not broken, and do not "improve" adjacent code.
- **Report concisely, but never let brevity hide a problem.** Blockers, failed tests and skipped work are always stated explicitly.
- If a contract in `docs/trd.md` turns out to be wrong or unbuildable, **say so on the issue** rather than silently deviating. The document is final, not infallible.
