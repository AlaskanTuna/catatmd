# Evals

Runs every synthetic fixture through the **real** analysis pipeline and grades what comes back.

Three harnesses live here. `run.ts` is the pipeline eval this page describes, `asr-ab.ts` measures hosted ASR and has [its own section](#the-asr-ab-harness), and `copilot-proposals.ts` is documented only in its own file header.

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

<a id="the-asr-ab-harness"></a>

## The ASR A/B Harness

`asr-ab.ts` posts a local audio file to ILMU and reports what came back. `docs/trd.md` 20.3 cites it as the gate for the hosted-ASR ship decision, and 20.9 uses it to decide whether ambient capture can ride on ILMU at all.

It is deliberately **not** wired into `bun run evals`. Run it directly, from the repo root:

```bash
bunx tsx evals/asr-ab.ts ~/audio/sample.mp4 --runs 3 --segment 8 --wer --ground-truth turns.json
```

| Flag | Effect |
| --- | --- |
| `--runs <n>` | Repetitions, default 3. Section 20.9 requires three, because `temperature=0` is not byte-deterministic here |
| `--probe-ms` | One extra call forcing `language=ms`. Direct only, since the relay exposes no language field |
| `--label <name>` | Names the report file. Defaults to the audio filename |
| `--ground-truth <turns.json>` | A `{ turns: [{ text }] }` file, printed under its own heading for comparison |
| `--segment <seconds>` | Cuts fixed windows and posts each in order. `0` transcodes the whole file without cutting |
| `--container wav\|webm` | `wav` (default) is 16 kHz mono PCM, `webm` is mono Opus |
| `--wer` | Adds WER and CER against the ground truth. Requires `--ground-truth` |
| `--via-relay <origin>` | Posts through `POST /api/asr/transcriptions` on a deployed origin rather than direct to the provider |

| Detail | Why it is the way it is |
| --- | --- |
| **`--segment 0` is the control, not the bare flag** | It transcodes through the same encoder as the cut arms. A control that kept the original codec would let a transcoding penalty masquerade as a segmentation penalty |
| **The container is a flag** | The published `qwen3-asr-flash` segmentation table was measured on 16 kHz mono wav, so `wav` is what makes an ILMU row comparable to it. `webm` is what `MediaRecorder` actually emits, so it is what ambient would really send |
| **Scoring is a port, not an implementation** | `wer.ts` reproduces the published normalisation exactly: NFKC, lowercased, punctuation stripped. A rate computed any other way cannot be compared with the rows already in `reports/` |
| **`wer.ts` is the tested part** | It is pure, so `wer.test.ts` runs in CI like `graders.test.ts`. The harness itself never does, for the reason at the top of this page |
| **`--via-relay` paces itself** | The route's bucket is 5 per minute, so an unpaced segmented run would measure 429s instead of latency. The pause is excluded from the reported per-chunk numbers |
| **Segmenting needs ffmpeg** | Resolved from `FFMPEG_PATH` or `PATH`, and its absence fails before any call is spent. It is a machine-local install, not a repo dependency |

### Cost And Data

- **Every run spends billed calls**, one per chunk per repetition. A three-run segmented arm on a 99 s file at 8 s windows is 39 calls.
- **Synthetic or scripted audio only**, per the `docs/trd.md` 20.1 and 20.2 provenance rules. Never point it at a recording of a real consultation.
- **Nothing is committed.** Audio and ground truth stay outside the repo, and reports land in `reports/`, which is gitignored.
- **Numbers reach the TRD by hand.** The harness writes a dated report; a human transcribes the figures into the relevant section with provenance stated, per the 20.3 convention.
