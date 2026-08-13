# Kickoff — CatatMD frontend + shared session (@AlaskanTuna)

> **A dated session brief, not standing policy.** Written 13/08/26 to start parallel build sessions after `docs/prd.md` and `docs/trd.md` were finalised. Committed so both collaborators' agents work from the same instructions. The canonical, durable rules live in `AGENTS.md` — where this brief and `AGENTS.md` disagree, `AGENTS.md` wins.

Continue the **CatatMD** project — the `catatmd` repository. Work from your local clone.

**Read first, in this order, before doing anything:** `docs/roles.md` → tail of `docs/progress.md` → `docs/plan.md` → `docs/prd.md` → `docs/trd.md`. Both `prd.md` and `trd.md` are **Final for the MVP** as of 13/08/26 and are the canonical contracts — build against them, do not redesign them. `docs/decisions.md` is the decision ledger; read it and append to it, never rewrite it.

---

## Operating mode for this session

- **I am away. Run solo.** Do not block waiting for me. If you hit a genuine fork, pick the option you can best defend, state the assumption plainly, and keep going.
- **Surface every decision you need from me in your FIRST message**, batched, before you start work. Then proceed on your stated defaults. Do not drip-feed questions across the session.
- **Leave anything needing my visual judgement until last.** I am doing the frontend; work that requires eyeballing a rendered UI is mine, not yours.
- **Gate 2 authorisation was granted for the dated session this brief was written for (13/08/26), and does not carry forward.** For that session only: Ship per the project's `pr-auto` mode: feature branch → PR → `gh pr merge --squash --delete-branch`. One PR per issue, not one giant PR. Small fixes may go straight to `main`. Always `git pull --rebase` before pushing — two humans share this repo.
- **A general-purpose peer session is running in the background.** Use `ListAgents` then `SendMessage` to delegate genuinely disjoint work. Give it a self-contained brief with an explicit file scope, and tell it not to commit. Never let two agents edit the same file.
- **Announce `shared/` the moment it lands.** A second developer (@Andersonnn7788) is blocked until then.

---

## ⚠ Lane discipline — a second agent is working the backend in parallel

@Andersonnn7788 has his own agent session running **all backend issues** (#3, #4, #5, #6, #7, #8, #9, #11, #12, #13, #14, #16, #29). **Those are not yours. Do not touch `backend/`, `prisma/`, or any file under them.** Two agents editing the same module is how a safety-critical diff gets silently clobbered.

Your lane is `shared/`, `frontend/`, and deployment configuration. Nothing else.

## Task order

### Wave 0 — the blocker. Ship this first, then announce it.

**#31 — shared schema contracts.** `ClinicalAssertionSchema`, the Malaysian operational block, `Transcript.source`, and the two response schemas from TRD §12. Timeboxed to hours.

Read the issue; the load-bearing details are safety properties, not preferences — especially that `NOT_ASSESSED` must be the cheapest, most default path, and that the verbatim-span requirement binds `state`, not `value`.

**The moment it merges, comment on #31 saying so.** The backend agent is partially blocked until then and is watching that issue.

### Wave 1 — yours, after #31.

- **#15** — privacy-safe logging and tracing. IDs and event types only; never transcript bodies, note contents, or vault entries.
- **Deployment configuration** — `vercel.json`, `render.yaml`, environment variables. You own Vercel and Render exclusively; the backend agent has been told not to touch either.

### Wave 2 — DO NOT START. These are mine.

**#2, #10, #26, #28, #30** — all frontend, all needing my eyes on a rendered screen.

If you run out of lane-safe work, **stop and report** rather than reaching into `backend/` or starting UI. Writing failing tests for the frontend issues is acceptable; building screens is not.

---

## Hard constraints — violating any of these is a critical defect, not a style issue

1. **No un-de-identified text reaches any LLM provider.** Every egress goes through `backend/src/deid/` then `LLMClient`. No direct provider SDK calls anywhere else.
2. **No hardcoded outputs, stubbed model calls, mocked red flags, or faked latency.** If the demo shows a note, the pipeline produced it. **This does not mean removing the fixtures** — synthetic fixture _inputs_ are a clinical-safety mandate; hardcoded _outputs_ are what is banned. The distinction is load-bearing.
3. **The LLM may never suppress, downgrade, or filter a deterministic red-flag hit.** It may only add candidates.
4. **No free-text citations.** Guideline IDs from the supplied corpus, validated at parse time.
5. **`diagnosis` is transcription-bound.** It records only an impression the doctor stated, carries a verbatim span, and defaults to `NOT_ASSESSED`. The system may never produce a diagnosis the doctor did not say.
6. **Never log transcript bodies, note contents, or de-identification vault entries.** IDs and event types only.
7. **Confidentiality.** The client name, any fee figure, the engagement length, and the deadline-as-commitment must never appear in a tracked file, commit message, issue, or PR. Before every push:
   ```
   git ls-files -z | xargs -0 grep -nIiE "kabel|RM ?3,?000|8-week" | grep -v "dxp\.kabel\.my/candidate/projects" || echo CLEAN
   ```
8. **The PR Clinical-Safety Checklist is not optional** for any diff touching `deid/`, `lib/llm/`, `redflags/`, `guidelines/`, or logging.

---

## Working expectations

- **TDD where it matters.** #7, #4 and #9 especially: write the failing test first, then make it pass. A red-flag rule without a test asserting it fires is not done.
- **Surgical changes.** Every changed line traces to the issue you are working. Do not refactor what is not broken.
- **Tick `docs/plan.md`, append to `docs/progress.md`** after each task. Append one line to `docs/decisions.md` for anything that settles a lasting choice.
- **Verify before claiming done.** `bun run lint`, `bun run typecheck`, `bun run test`. Paste real output; never assert a pass you did not observe.
- **Report concisely.** Lead with the outcome. Blockers, failed tests and skipped work are always stated explicitly, even when everything else is compressed.

---

## Known-good state as of this kickoff

- `main` is at the squash-merge of PR #32; working tree clean; only `main` exists on the remote.
- Deployed and live: frontend `https://catatmd.vercel.app`, API `https://catatmd-api.onrender.com/api/health`, DB Supabase Singapore. Keep-alive pings every 10 minutes from an external scheduler.
- `QWEN_MODEL` is pinned to `qwen-flash` — the only model on the account that accepts JSON-Schema-constrained decoding. Do not change it without re-reading TRD §21.2.
- `graphify-out/` is refreshed by a post-commit hook; its churn is expected and not yours.
- 24 issues open, 18 in the **MVP submission** milestone.
