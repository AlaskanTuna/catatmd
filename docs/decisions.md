# Decisions

Scope decisions that change what this product does, recorded rather than silently applied. `docs/prd.md` Section 1 names this file as the place a post-final scope change must land.

**What belongs here:** a change to what the product will or will not do, where the reasoning matters more than the diff. Implementation choices belong in `docs/trd.md` Section 19. A question still open belongs in Section 19 too, until someone answers it.

**Entry format:** an id, a date, a status, the decision in one sentence, the reasoning, and what the decision explicitly does not license. Entries are appended and never rewritten. A decision that is later reversed gets a new entry that says so.

---

## D-001: Dictated Medication Capture

|                |                                            |
| -------------- | ------------------------------------------ |
| **Date**       | 2026-09-09                                 |
| **Status**     | Adopted                                    |
| **Issues**     | #310, #311, #312, #313                     |
| **Supersedes** | Nothing. Clarifies `docs/prd.md` Section 6 |

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
- A microphone on the review page, transcribing **on device only**, so no new audio egress is created
- A versioned drug-name lexicon used to offer spelling candidates for names the recogniser garbled

### What This Decision Does Not License

Each of these is a safety boundary in its own right, and none is a deferred feature.

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

### What This Decision Does Not License

- **No move of the bounds to a call site.** They stay constructor options so every path inherits them (`.claude/rules/security.md`, issue #94). A per-operation bound, if one is ever wanted, is a second adapter instance with its own constructor bound, never a per-request option.
- **No claim that this makes analysis fast.** It buys headroom. The median is unchanged, and whether synchronous analysis behind the rewrite is viable at all is still open.
- **No cover for the transient-failure regression.** A 429 or 5xx now fails immediately on **every** chat operation, not just analysis. That is accepted, not unnoticed.
- **No retrospective trust in the timing table.** `docs/trd.md` Section 19's `retrieval` row measures the suggestions call without retrieval, so production is slower than it reads.
