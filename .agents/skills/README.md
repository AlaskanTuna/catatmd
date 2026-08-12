# Tool-agnostic skills home

Canonical location for this project's agent skills, the directory-level sibling of
`AGENTS.md`. Harness-specific directories symlink in here rather than holding their
own copies, so every tool sees one source of truth:

```
.agents/skills/<name>/          ← the real skill
.claude/skills/<name>           → symlink to ../../.agents/skills/<name>
```

**Exception — Impeccable.** It lives as a real directory at `.claude/skills/impeccable/`
because its hook manifest hard-codes that path. Never rehome it here.

## What's Here

| Skill | Read Before Touching |
|---|---|
| `healthcare-cdss-patterns` | `backend/src/redflags/`, any clinical scoring |
| `healthcare-phi-compliance` | `backend/src/deid/`, `AuditEvent`, access control |
| `better-auth-security-best-practices` | auth wiring, session/cookie config |
| superpowers (14 skills) | planning, TDD, debugging, code review — see `.superpowers-provenance` |

## Notes

- **Symlinks need Git support on Windows.** On a Windows checkout without developer
  mode or `git config core.symlinks true`, these land as plain text files containing
  the target path and the skills will not load. Linux, WSL, and macOS are fine.
- Versions for registry-installed skills are pinned in `skills-lock.json`; restore
  with `npx skills experimental_install`.
- Superpowers is vendored so collaborators get the same method skills without
  installing the plugin. Refresh instructions are in `.superpowers-provenance`.
