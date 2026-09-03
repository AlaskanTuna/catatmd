# Agent Memory: Dependency Advisories

Standing feedback for future `Agent: Dependency Advisories` runs. Keep this short — it is
carried into every run's prompt. Add an entry only when it should change what a _future_
run does; one-off notes belong in the PR, not here.

## Guidance

- CI gates at `high`; this loop works at `moderate`. Do not "fix" that mismatch by raising
  the loop's level to match CI — the gap is the point.
- `overrides` entries in the root `package.json` (`sharp`, `adm-zip`) exist to clear past
  advisories. Do not remove one because the advisory no longer appears; it no longer
  appears _because_ of the override. Widen rather than delete.
- The `verify` job runs `bun audit --audit-level=high` before migrations. An advisory that
  blocks it blocks every PR in the repo, so a `high` finding takes priority over any number
  of moderates in the same run.
- Prefer leaving a major-version bump to a human. Open the PR with the moderates you could
  clear and report the major as `SKIPPED`.
