# Response Template

The CI agent's final response becomes the PR body. Follow this structure.

Do not include the client name, the fee figure, or the engagement length anywhere in it —
the `verify` job's confidentiality check scans tracked files, and a reviewer pasting the
body into one would trip it.

---

```markdown
## What Changed

Cleared N of M advisories reported by `bun audit --audit-level=moderate`:

- `resolved`: X
- `skipped`: Y

## Why

<!-- One or two sentences. Which advisories, and what they exposed. -->

## Advisories

### 1. `<package>` <affected range> → <fixed version>

- **Severity**: moderate | high | critical
- **Advisory**: <GHSA URL>
- **Path**: `workspace:<name> › <parent>`
- **Route**: direct bump in `<manifest>` | parent bump | root `overrides`
- **Resolution**: **RESOLVED**
- **Risk**: low | medium | HIGH
- **Call-site changes**: none | `path/to/file.ts` — <what adapted and why>

### 2. `<package>` <affected range>

- **Severity**: moderate
- **Advisory**: <GHSA URL>
- **Resolution**: **SKIPPED**. <Why — no patched release, or the only route leaves scope.>

## Validation

- [ ] `bun install`
- [ ] `bunx prisma generate --schema prisma/schema.prisma`
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun audit --audit-level=moderate`

## Clinical-Safety Checklist

<!-- Required only if a bump touched an LLM SDK, a logging library, or anything reaching
     lib/llm/ or guidelines/. Otherwise: "Not applicable — no bump reached a clinical or
     logging path." -->
```

---

## Guidelines

1. **Lead with the count.** A reviewer should see scope in the first line.
2. **One section per advisory**, in the order `bun audit` reported them.
3. **State risk per advisory, not per PR.** A patch bump to a dev dependency and a minor
   bump to an Express middleware do not carry the same risk.
4. **Skipped is a real outcome.** Say why, so the next run does not retry it blindly —
   and so it can be promoted into the memory file if it is permanent.
5. **Call-site changes are the thing reviewers most need to see.** Never bury them.
