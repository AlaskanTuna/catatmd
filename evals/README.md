# Evals

Runs every synthetic fixture through the **real** analysis pipeline and grades what comes back.

## Why This Is Not `tests/`

`bun run test` is deterministic, free, and gates every push. This is none of those things: it spends a real LLM call per fixture, and its results move when the provider does. Wiring the two together would either bankrupt CI or get the evals disabled, so they are kept apart by name.

The **graders** are the exception. They are pure functions, so `graders.test.ts` runs in CI like any other test. A grader that silently always passes turns "we do not know" into "we checked", which is worse than having no harness, so the grading logic is the part that gets tested.

## What It Grades

| Grader | Severity | Asks |
| --- | --- | --- |
| `red-flag-recall` | Critical | Did every rule in `expectedRedFlagIds` fire? |
| `rule-attribution` | Critical | Did any rule hit arrive re-badged as model output? |
| `citation-validity` | Critical | Does every cited ID resolve to the corpus? |
| `evidence-grounding` | Critical | Is every asserted span verbatim in the transcript? |
| `fact-coverage` | Informational | How much of the fixed checklist was established? |
| `model-contribution` | Informational | How many candidates did the model add? |

**Recall is a subset check, not equality.** The model may add candidates and may never suppress a rule hit, so extra flags are legitimate output and a missing rule hit is a patient-safety defect. `rule-attribution` exists because those two fail differently: a suppression bug that re-badges a rule hit as model output would otherwise pass recall while the deterministic guarantee is gone.

**`fact-coverage` is informational and must stay that way.** A field the consultation never touched is *correctly* `NOT_ASSESSED`, so there is no target to hit. It earns its place as a drift signal: the same fixture scoring materially lower after a prompt or model change means extraction got worse.

**`evidence-grounding` is a backstop, not a discovery.** `applyEvidenceCheck` already discards ungrounded assertions inside the pipeline, so a healthy run scores 100% by construction. It is graded anyway because that is a Tier-2 control, and an unmeasured control regresses quietly. A failure here means the check broke, not that the model misbehaved.

## Running It

Needs a running API. It drives `POST /api/consultations/analyze-ephemeral`, which runs the same `runAnalysis` a doctor's request runs and **persists no `Consultation`**, so a run leaves the database as it found it.

```bash
bun run dev:backend          # in one shell
bun run evals                # in another
```

Point it elsewhere with `EVAL_API_URL` (default `http://localhost:3001`) and `EVAL_ORIGIN` (default `http://localhost:5173`, which must satisfy the API's CORS origin).

Exits non-zero if any fixture fails a critical grader. Writes a dated report to `evals/reports/`, which is gitignored: reports are generated output, one per run.

## Cost And Data

- One analysis per fixture, and an analysis is two concurrent LLM calls plus retrieval.
- **Synthetic data only.** It reads `backend/src/fixtures/`, and nothing else is permitted here.
- Every run writes `consultation.ephemeral_analyzed` audit rows, by design: the endpoint cannot tell demo content from real content, so an unaudited egress would be a hole in the PHI boundary.

## Adding A Case

Cases come from `backend/src/fixtures/`, not from a list here, so there is no second corpus to drift. Add the fixture to `corpus.ts` and its rubric to `rubrics.ts`, including `expectedRedFlagIds` derived by reading the transcript against the trigger list rather than from observed output. `fixtures.test.ts` keeps the two in lockstep.
