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
| `grilling` | invoked as `/grill-me`; stress-tests a plan a decision-frontier at a time |
| `writing-for-agents` | `AGENTS.md`, `CLAUDE.md`, or authoring any skill |

## Notes

- **Symlinks need Git support on Windows.** On a Windows checkout without developer
  mode or `git config core.symlinks true`, these land as plain text files containing
  the target path and the skills will not load. Linux, WSL, and macOS are fine.
  Flipping the config alone does not repair a checkout that is already broken, because
  Git considers those files clean. To recover one (issue #257):

  ```bash
  # 1. Turn Developer Mode ON in Windows Settings. `start ms-settings:developers`
  #    opens the page directly; it sits under Update & Security > For developers on
  #    Windows 10 and System > For developers on Windows 11. Since Windows 10 1703
  #    this is what permits symlink creation without elevation.
  # 2. Sign out and back in. This step is not optional and is easy to miss: Developer
  #    Mode grants SeCreateSymbolicLinkPrivilege to the account, but Windows computes
  #    token privileges at logon, so every process already running (your shell, your
  #    editor, the agent) keeps a token without it and still fails with "Administrator
  #    privilege required". Confirm with:
  #      whoami /priv | findstr Symbolic
  # 3. Only now does Git have the privilege it needs.
  git config core.symlinks true
  # 4. Delete only the placeholder FILES. impeccable/ is a real directory, keep it.
  find .claude/skills -maxdepth 1 -type f -delete
  # 5. Let Git lay them down again, this time as real symlinks.
  git checkout -- .claude/skills/
  # 6. Confirm: arrows in the listing, and mode 120000 still in the index.
  ls -la .claude/skills/ && git ls-files -s .claude/skills/ | head -3
  ```

  Without developer mode, `mklink /J` directory junctions are the privilege-free
  fallback, since junctions do not require elevation the way symlinks do.
- Versions for registry-installed skills are pinned in `skills-lock.json`; restore
  with `npx skills experimental_install`.
- Superpowers is vendored so collaborators get the same method skills without
  installing the plugin. Refresh instructions are in `.superpowers-provenance`.
