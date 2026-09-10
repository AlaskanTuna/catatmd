# Decisions

Scope decisions that change what this product does, recorded rather than silently applied. `docs/prd.md` Section 1 names this file as the place a post-final scope change must land.

**What belongs here:** a change to what the product will or will not do, where the reasoning matters more than the diff. Implementation choices belong in `docs/trd.md` Section 19. A question still open belongs in Section 19 too, until someone answers it.

**Entry format:** an id, a date, a status, the decision in one sentence, the reasoning, and what the decision explicitly does not license. Entries are appended and never rewritten. A decision that is later reversed gets a new entry that says so.

---

## D-001: Dictated Medication Capture

|                |                                             |
| -------------- | ------------------------------------------- |
| **Date**       | 2026-09-09                                  |
| **Status**     | Adopted. Amended 2026-09-10, transport only |
| **Issues**     | #310, #311, #312, #313, #355, #356, #357    |
| **Supersedes** | Nothing. Clarifies `docs/prd.md` Section 6  |

### Decision

Capturing a medication **the doctor dictates** is inside the scope boundary. Generating, suggesting, selecting, or validating a medication remains outside it.

### The Distinction It Turns On

The hinge is the one Section 10 already applies to `diagnosis`: the system may record what the practitioner decided, and may not produce the decision. A dictated prescription is the practitioner deciding out loud, so the system's role is transcription and structuring.

Section 11's intended-purpose statement already describes exactly this, and is **not amended by this decision**: CatatMD "structures a record of what the practitioner said and did", and is "not intended to ... recommend or select treatment". Recording a treatment the practitioner selected is not selecting one.

### Why The Wording Needed Fixing

**"Prescribing" was carrying two meanings in one word**, and the two halves of the document disagreed about which it meant.

| Where          | What It Said                                                    | Reading                                                                           |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Section 11     | "not intended to recommend or select treatment"                 | Unambiguous, and untouched here                                                   |
| Section 6      | "Diagnosis, triage decisions, prescribing"                      | Ambiguous, and read literally it forbade transcribing a sentence the doctor spoke |
| `docs/dpia.md` | "does not diagnose, prescribe, or approve a note automatically" | The word "automatically" was already doing the work                               |

**The literal reading was already untrue in the shipped product.** `medicationsDispensed` in the operational block (Section 9, CAP-1) has been populated by extraction since that block shipped: drugs the doctor named, each carrying a verbatim transcript span, resolving to `NOT_ASSESSED` when the doctor said nothing. This decision does not widen scope so much as make the written boundary match behaviour that already exists and was already reviewed.

### What Changes In Practice

- A structured `prescriptions` record, authored by the doctor and confirmed by the doctor, separate from the model-extracted `medicationsDispensed`
- A microphone on the review page, transcribing **on device by default and by floor**. Streaming recognition is an opt-in second path, added 2026-09-10 and described below
- A versioned drug-name lexicon used to offer spelling candidates for names the recogniser garbled

### Amended 2026-09-10: The Transport, Not The Boundary

**What changed is how the words are recognised. What did not change is anything this decision actually decided.** Recording a drug the doctor spoke is still extraction, generating or selecting one is still outside scope, and every row of the table below stands unmoved. The amendment reaches one bullet above, whose original wording, "on device only, so no new audio egress is created", is now false rather than merely narrow.

|                            |                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What is added**          | Streaming recognition on the same Soniox socket ambient capture uses, browser-direct, US region (`trd.md` §20.10, issues #356 and #357)                                                           |
| **What stays the default** | On-device Whisper. A doctor who changes nothing sends no audio anywhere, and no consent tick is offered on that path                                                                              |
| **What stays the floor**   | On-device is also the fallback. Key unset, consent withheld, socket dropped, or hardware below the floor all land back on it or on typing, never silently on the cloud                            |
| **What gates it**          | The two-control consent rule in `.claude/rules/security.md`, unchanged and now binding on the review page: a standing device preference plus a per-consultation tick that dies with the component |
| **Who authorised it**      | @Andersonnn7788, 2026-09-10, scoped to prescription dictation on the review page and nothing else                                                                                                 |

**Why the original wording was right when it was written.** #313 chose on-device deliberately, reasoning that the review page had no consent surface and that rebuilding one in a third place was worse than removing the question. That reasoning is not overturned so much as paid for: the gate is now built there rather than avoided. What forced the question is measurement in `trd.md` §20: on the 83.4 s reference recording the WebGPU path stamped a real-time factor of 0.89, against 2.14 for the WASM q8 baseline, and §20.1 puts browser WASM generally at 1.5 to 3.0. Anything at or above 1.0 cannot keep pace with speech. Words appearing as the doctor speaks was therefore never reachable on the fallback path most clinic hardware runs, and only marginally reachable on the best of them.

### What This Decision Does Not License

Each of these is a safety boundary in its own right, and none is a deferred feature. **All of them were re-read on 2026-09-10 and all stand unchanged**, but one deserves an explicit answer rather than silence.

**Streaming audio to a recogniser is not "transmission of a prescription anywhere".** That row bans sending a prescription to a pharmacy, printing it as a legal script, or sharing it. What crosses the socket is speech on its way to becoming text. The structured prescription it becomes still goes nowhere but this database, still behind the doctor's confirmation. The row is about the artefact's destination, not the recogniser's. Separately, "brand names in the lexicon" is unaffected: the recognition vocabulary primes some brands because a patient says "Panadol", and that list is not the lexicon, which still holds generics only and is still the only thing a candidate can be drawn from.

| Not Built                                              | Why                                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Dose validation or maximum-dose checking               | Clinical decision support, and a different intended purpose                                                            |
| Interaction or allergy checking                        | The same, and it would require drug data this corpus deliberately does not hold                                        |
| Drug suggestion or selection                           | The system never proposes a drug the doctor did not say                                                                |
| Automatic substitution of a drug name                  | Look-alike sound-alike confusion is a leading medication-error class. A candidate is offered; the doctor accepts it    |
| Pre-filling a prescription from `medicationsDispensed` | That field is model-extracted. Seeding from it would turn a mis-extraction into a prescription behind one confirmation |
| Transmission of a prescription anywhere                | Nothing is sent to a pharmacy, printed as a legal script, or shared                                                    |
| Brand names in the lexicon                             | Generic names only                                                                                                     |

### Reasoning Recorded Against Later Drift

**The feature is deterministic end to end.** No LLM participates: the sig parser is regex, the drug-name matcher is phonetic plus orthographic distance against a static versioned list. This is not incidental. It keeps the capability out of the "adaptive logic" framing that separates a documentation aid from decision support, and it matches the existing posture that patient safety must not depend on model behaviour.

**The lexicon is a spelling aid, not a formulary.** It holds names and synonyms, and no dose, indication, or recommendation data. The ingested CPG chunks draw the identical line for themselves: "This prototype does not encode drug choice, dose, duration, or treatment thresholds."

**The confirm step is the control.** Published guidance on speech recognition in medication documentation names selection from a list, plus prescriber review before submission, as the mitigations for exactly this failure mode. `docs/trd.md` Section 20.7 reached the same place independently for transcript corrections: "a proposal on screen, never an automatic edit, and never a rewrite of stored text."

---

## D-002: Retire The Curated Guideline Corpus For Retrieval-Only Citation

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Date**       | 2026-09-09                                                                                             |
| **Status**     | Adopted                                                                                                |
| **Issues**     | #250 (open)                                                                                            |
| **Supersedes** | The hand-written `guideline-corpus-v4` chunk set that anchored `docs/trd.md` Section 11 since issue #8 |

### Decision

The 11 hand-written guideline chunks are retired. The three documents behind them, MOH NAG 2024, Abdullah et al. 2024, and Ooi et al. 2022, are ingested through the same CPG retrieval pipeline as every other guideline in `corpus/cpg/manifest.json`, and the model's citable set on `suggestions_and_red_flags` is the retrieved chunks for that consultation and nothing else.

### What This Decision Does Not License

- **No change to the ID-constrained citation mechanism.** `guidelineId` still fails schema validation for any id outside the live corpus (`docs/trd.md` Section 11).
- **No new clinical content.** The same three documents, now ingested rather than hand-copied, plus the deterministic layers (red-flag triggers, gap checklist) citing them through stable `doc:<id>[#p<n>]` references instead of a curated chunk id.
- **Issue #250 stays open.** Whether MOH-ARR spans may be sent to the model for grounding at all, distinct from whether they may be displayed, is not answered by this decision. The current posture is that they are sent, de-identified, and display is off.
- **Page anchors on `doc:` references are deliberately left unset.** No trigger or checklist entry cites a specific page today; this is a scope boundary of the current content, not a limitation of the reference format.

---

## D-003: One Longer Provider Attempt Instead Of Two Short Ones

|                |                                                       |
| -------------- | ----------------------------------------------------- |
| **Date**       | 2026-09-09                                            |
| **Status**     | Adopted                                               |
| **Issues**     | #340                                                  |
| **Supersedes** | The `60_000` / `MAX_RETRIES = 1` pair adopted for #94 |

### Decision

A provider call gets **one attempt of 90 seconds**, not two of 60. `REQUEST_TIMEOUT_MS` moves to `90_000` and `MAX_RETRIES` to `0` on the shared adapter. The embedding client, previously bound by nothing at all, gets its own 10 second bound.

### Reasoning

- **The retry could never succeed.** The SDK retries timeouts. A call needing 70 s of decoding needs 70 s on the second attempt too, so a slow but healthy call spent 120 s and two calls' quota to fail anyway. Measured at `durationMs` 120421 and 120467, provider verified healthy in between.
- **The pipeline outgrew the old bound.** `note_generation` at 45.8 s and the suggestions call at 53.8 s sit within about 6 s of a 60 s ceiling, so ordinary provider variance tips a healthy consultation into failure.
- **90 s is chosen by the ceiling above it, not by the model.** A Vercel rewrite to an external origin allows 120 s to first byte, and `/analyze` emits one JSON at the end, so time-to-first-byte is the whole request. 90 s leaves roughly 30 s for every non-model stage. A bound at 120 s would sit on the cap and could never reach the browser.
- **Losing the retry matches CAP-5**, which already states that nothing retries autonomously and the doctor's press is the retry.

### And Split The Slowest Call In Two

`suggestions_and_red_flags` answered both halves in one response and was the slowest call in the pipeline, which is what put it closest to the bound. It is now `red_flags` and `suggestions`, run concurrently.

- **Only the citing half needs the corpus.** A red-flag candidate is read out of the transcript, not out of a guideline, so the red-flag half stopped carrying the retrieved set as input tokens.
- **The citing half is skipped when retrieval returned nothing.** The citable set is the retrieved chunks and nothing else (D-002), so those consultations were spending a model call whose answer was discarded and replaced with an empty array.
- **`outOfScope` rides on the half that always runs.** Deriving it from an empty corpus would report "outside the guideline scope" for an in-scope consultation that simply retrieved nothing, and the review screen renders those as two different sentences.
- **Suggestion suppression became deterministic.** One call could suppress its own suggestions when it judged the consultation out of scope; two concurrent calls cannot, so `generateSuggestions` drops them instead of asking the model to.

### What This Decision Does Not License

- **No move of the bounds to a call site.** They stay constructor options so every path inherits them (`.claude/rules/security.md`, issue #94). A per-operation bound, if one is ever wanted, is a second adapter instance with its own constructor bound, never a per-request option.
- **No claim about the size of the latency gain.** Splitting one call's output does not imply halving its latency: both halves repeat the transcript and system preamble, the output may not divide evenly, and four concurrent generations can meet a provider concurrency or token-rate limit that one did not. It is a hypothesis until the benchmark says otherwise, and the benchmark had to be repaired first because its `retrieval` stage never ran retrieval.
- **No claim that this makes analysis fast enough.** Whether synchronous analysis behind the Vercel rewrite is viable at all is still open, and is settled by measurement rather than by this decision.
- **No cover for the transient-failure regression.** A 429 or 5xx now fails immediately on **every** chat operation, not just analysis. That is accepted, not unnoticed.
- **No retrospective trust in the timing table.** `docs/trd.md` Section 19's `retrieval` row measures the suggestions call without retrieval, so production is slower than it reads.
