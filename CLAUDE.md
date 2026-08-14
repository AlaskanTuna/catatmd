# CLAUDE.md

> Claude Code adapter. The canonical, tool-agnostic project instructions live in `AGENTS.md` (imported below) — edit that file, not this one.

@AGENTS.md

## Claude Code Specifics

- Eight project subagents live in `.claude/agents/`, each pinned to its own `model:` and `effort:` and scoped to a disjoint set of paths. Dispatch by name, or `@agent-<name>` to guarantee it, so the pinned settings take effect.
  - **Read-only reviewers.** `phi-boundary-auditor` (`deid/`, `lib/llm/`, `logger.ts`, `audit/`), `clinical-safety-reviewer` (`redflags/`, `guidelines/`, `analysis/`, `suggestions/`), `api-security-reviewer` (`routes/`, `middleware/`, auth, `app.ts`), and `frontend-reviewer` (`frontend/src/`).
  - **Builders**, which may edit files: `db-migrator` (`prisma/`), `test-engineer` (Vitest), `docs-maintainer` (`docs/`).
  - **Ops**: `ci-doctor` (failing runs and deploys).
- General diff review that falls outside those scopes goes to the `/code-review` command, not to a subagent. There is deliberately no generalist reviewer, because a second agent claiming "review my changes" makes delegation to the four specialists less reliable.
- **No subagent commits, pushes, merges, or deploys.** Gate 2 is the human's, per `AGENTS.md` "Critical Do-Nots".
- Subagents reference project skills by their real path under `.agents/skills/`. The `.claude/skills/` entries are symlinks that land as plain text stubs on a Windows checkout without developer mode, so only `impeccable` loads there.
- **Worktrees back the Branch Lane when work runs in parallel.** `claude --worktree <name>` creates `.claude/worktrees/<name>/` (gitignored) on branch `worktree-<name>` and refuses any edit, command, or git redirect that reaches back into the main checkout. `.worktreeinclude` copies `.env` in once, at creation time, and never refreshes it, so `.claude/hooks/env-drift.mjs` names the keys that have since drifted; run `bun install` and `bun run prisma:generate` there yourself.
  - **Never add `isolation: worktree` to the four reviewers.** Subagent worktrees branch from `worktree.baseRef`, which defaults to `fresh`, the remote default branch. A reviewer would then audit a clean tree rather than the diff it was dispatched for, and report all clear. Setting `baseRef` to `head` is a global change, so it is not a per-agent fix.
  - Cleanup is automatic for a worktree with no changes in it. One holding work survives until `git worktree remove`, and `-p` runs never prompt, so they always leave theirs behind.
