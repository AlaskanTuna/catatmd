---
name: upkeep-dependency-advisories
description: Clear dependency advisories reported by `bun audit` when they can be resolved by a version bump; treat the advisory database as the source of truth, not the age of a dependency.
---

# Upkeep Dependency Advisories

Use this skill when clearing security advisories that `bun audit` reports against this
repository's dependency tree.

The goal is to keep `bun audit --audit-level=high` — the gate `verify` enforces on every
push — permanently clean, by resolving advisories while they are still `moderate` and a
version bump away. This is upkeep, not a general dependency upgrade: an advisory is the
only reason to change a version here.

## Core Requirements

- `bun audit` output is the source of truth for what needs fixing. A dependency being old,
  or `bun outdated` listing it, is not an advisory and is not in scope.
- Work at `--audit-level=moderate`. CI gates at `high` on purpose (`ci.yml` explains why:
  a moderate advisory in a transitive dev dependency must not block clinical work). This
  loop exists to stop moderates ever reaching that gate, so it deliberately looks one
  severity level deeper than CI does.
- Prefer the smallest version change that clears the advisory. A patch bump beats a minor
  bump beats a major bump, and a direct dependency bump beats an `overrides` entry.
- Reach for `overrides` in the root `package.json` only when the advisory is in a
  transitive dependency that no direct dependency has released a fix for. The repo already
  uses this pattern (`sharp`, `adm-zip`) — match it.
- Source changes are permitted **only** when a bump requires an API adaptation, and each
  one must be called out in the response with a risk level.
- Never change a version to clear an advisory the audit did not report.

## Out Of Scope

These paths are off limits to this loop. Read them if you must understand a call site;
never edit them:

- `backend/src/deid/` — the PHI trust boundary and token vault.
- `backend/src/redflags/` — the deterministic clinical escalation engine.
- `prisma/schema.prisma` and `prisma/migrations/` — schema changes are not reversible
  against a live database.
- `.github/workflows/` and deploy config (`vercel.json`, `render.yaml`) — the loop does
  not edit its own machinery.

If clearing an advisory would require touching any of these, stop and report it as
`SKIPPED` with the reason. That is a correct outcome, not a failure.

## Workflow

### 1. Find the advisories

```bash
bun audit --audit-level=moderate
```

Record, for each advisory: the package, the affected version range, the dependency path
(`bun audit` prints the workspace and the parent that pulls it in), the severity, and the
advisory URL.

Completion criterion: you can name every reported advisory and which workspace pulls it in.

### 2. Establish the fix for each one

Read the linked GHSA advisory to find the first patched version. Then find the shortest
route to it:

1. Is the vulnerable package a direct dependency in `package.json`, `backend/`,
   `frontend/`, or `shared/`? Bump it there.
2. Is it transitive? Check whether the direct parent has a newer release that depends on a
   patched version. Bump the parent if so.
3. Only if neither applies, add or widen an `overrides` entry in the root `package.json`.

Completion criterion: every advisory has a named target version and a chosen route, or an
explicit reason it cannot be fixed without leaving scope.

### 3. Apply the smallest change

Edit the manifest, then regenerate the lockfile:

```bash
bun install
```

Do not hand-edit `bun.lock`. Do not run `bun update --latest` — it upgrades the whole tree
and buries the advisory fix in unreviewable churn.

Completion criterion: the diff touches manifests and `bun.lock` only, plus any call-site
adaptation a bump forced.

### 4. Validate

Run in this order and stop at the first failure:

```bash
bun install
bunx prisma generate --schema prisma/schema.prisma
bun run lint
bun run typecheck
bun run test
bun audit --audit-level=moderate
```

`bun run test` needs a reachable Postgres — the workflow provides one, matching `verify`.

If a bump breaks the suite and the fix is not a small, obvious adaptation, revert that one
bump and report it as `SKIPPED`. A partial PR that clears three of four advisories is more
useful than a broken one that attempts all four.

Completion criterion: every command above passes, or the response names the exact failing
command and the advisory it belongs to.

### 5. Format the response

Follow `references/response-template.md`. The response becomes the PR body.

Two repo rules bind the PR body as much as any other tracked text:

- The **confidentiality check** in `verify` scans tracked files for the client name and
  commercial engagement terms. Never put them in a commit message, branch name, or PR body.
- The PR template's **Clinical-Safety Checklist** applies when a diff touches `deid/`,
  `lib/llm/`, `redflags/`, `guidelines/`, or logging. This loop cannot touch the first
  three, but a bump to an LLM SDK or a logging library does reach the last two — say so
  explicitly when it happens.

Completion criterion: the response follows the template and states a risk level per change.

## Review Checklist

- Every version change traces to a specific advisory in the run's `bun audit` output.
- The chosen version is the smallest one that clears the advisory.
- `overrides` was used only where no direct-dependency route existed.
- No out-of-scope path was edited.
- Validation passed, or the blocker is named exactly.
- No confidential terms appear in the PR body.
