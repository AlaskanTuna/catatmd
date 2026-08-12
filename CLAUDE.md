# CLAUDE.md

> Claude Code adapter. The canonical, tool-agnostic project instructions live in `AGENTS.md` (imported below) — edit that file, not this one.

@AGENTS.md

## Claude Code Specifics

- Roles are dispatched as **named subagents** from `.claude/agents/` (`planner`, `programmer`, `qa`), each pinned to its own `model:` + `effort:`. Dispatch by name so both take effect.
- Read `docs/roles.md` before acting — it defines your role, boundaries, and the gates.
