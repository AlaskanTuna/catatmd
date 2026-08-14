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
