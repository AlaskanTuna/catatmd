<!--
Squash-merge into main, then delete the branch:
  gh pr merge --squash --delete-branch
Keep this body tight. The diff carries the detail; this carries the intent.
-->

## What Changed

<!-- One or two sentences. What is true now that was not before. -->

Closes #

## Why

<!-- The reason, not the mechanics. Skip if the linked issue already says it. -->

## Verification

<!-- How you know it works. Delete rows that do not apply. -->

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] Manually exercised the affected flow

<!-- Name the specific tests added or the manual steps taken: -->

## Clinical-Safety Checklist

<!-- Delete this whole section only if the diff touches none of these paths. -->

- [ ] No new path sends un-de-identified text to a provider — egress still goes through `deid/` then `LLMClient`
- [ ] No provider SDK imported outside `backend/src/lib/llm/`
- [ ] Deterministic red-flag hits remain unsuppressable by the model
- [ ] Citations remain ID-constrained; no free-text references accepted
- [ ] No transcript bodies, note contents, or vault entries written to logs
- [ ] Fixtures added are synthetic

## Notes For The Reviewer

<!-- Trade-offs taken, things deliberately left out, follow-up issues filed. Optional. -->
