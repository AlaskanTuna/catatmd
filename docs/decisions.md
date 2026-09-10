# Decisions

Scope decisions that change what this product does, recorded rather than silently applied. `docs/prd.md` Section 1 names this file as the place a post-final scope change must land.

**What belongs here:** a change to what the product will or will not do, where the reasoning matters more than the diff. Implementation choices belong in `docs/trd.md` Section 19. A question still open belongs in Section 19 too, until someone answers it.

**Entry format:** an id, a date, a status, the decision in one sentence, the reasoning, and what the decision explicitly does not license. Entries are appended and never rewritten. A decision that is later reversed gets a new entry that says so.

---

## D-001: Dictated Medication Capture

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Date**       | 2026-09-09                                                 |
| **Status**     | Adopted. Amended 2026-09-10 twice: transport, then default |
| **Issues**     | #310, #311, #312, #313, #355, #356, #357, #363             |
| **Supersedes** | Nothing. Clarifies `docs/prd.md` Section 6                 |

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
- A microphone on the review page, **streaming by default since 2026-09-10, with on-device recognition as the fallback and the floor**. Both amendments below record how that arrived and what it cost
- A versioned drug-name lexicon used to offer spelling candidates for names the recogniser garbled

### Amended 2026-09-10: The Transport, Not The Boundary

**What changed is how the words are recognised. What did not change is anything this decision actually decided.** Recording a drug the doctor spoke is still extraction, generating or selecting one is still outside scope, and every row of the table below stands unmoved. The amendment reaches one bullet above, whose original wording, "on device only, so no new audio egress is created", is now false rather than merely narrow.

|                            |                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What is added**          | Streaming recognition on the same Soniox socket ambient capture uses, browser-direct, US region (`trd.md` §20.10, issues #356 and #357)                                                                                                       |
| **What stays the default** | On-device Whisper. A doctor who changes nothing sends no audio anywhere, and no consent tick is offered on that path. **Superseded the same day, see the next amendment**                                                                     |
| **What stays the floor**   | On-device is also the fallback. Key unset, consent withheld, socket dropped, or hardware below the floor all land back on it or on typing, never silently on the cloud. **The hardware clause narrowed the same day, see the next amendment** |
| **What gates it**          | The two-control consent rule in `.claude/rules/security.md`, unchanged and now binding on the review page: a standing device preference plus a per-consultation tick that dies with the component                                             |
| **Who authorised it**      | @Andersonnn7788, 2026-09-10, scoped to prescription dictation on the review page and nothing else                                                                                                                                             |

**Why the original wording was right when it was written.** #313 chose on-device deliberately, reasoning that the review page had no consent surface and that rebuilding one in a third place was worse than removing the question. That reasoning is not overturned so much as paid for: the gate is now built there rather than avoided. What forced the question is measurement in `trd.md` §20: on the 83.4 s reference recording the WebGPU path stamped a real-time factor of 0.89, against 2.14 for the WASM q8 baseline, and §20.1 puts browser WASM generally at 1.5 to 3.0. Anything at or above 1.0 cannot keep pace with speech. Words appearing as the doctor speaks was therefore never reachable on the fallback path most clinic hardware runs, and only marginally reachable on the best of them.

### Amended 2026-09-10: Streaming Becomes The Default, At The Cost Of One Control

**The transport amendment above left on-device as the default. This one moves it, and what it costs is a control rather than a boundary.** Nothing about the egress changes: same vendor, socket, region and minting route, and the same sign-off covers it. What changes is what a doctor who touches nothing gets, and therefore how many deliberate acts stand between a patient's voice and the United States.

|                                 |                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**                | `DEFAULT_AUDIO_SETTINGS.dictationEngine` is `'streaming'`. Only the default moved. The on-device path is untouched and still selectable in the Audio dialog                                                                                                                  |
| **What it costs**               | The standing device preference now ships already set to send. A preference the doctor has not moved is not a choice they made, so this surface rests on **one defaulted preference plus one deliberate tick**, not on two chosen controls                                    |
| **What still gates it**         | The per-consultation tick, unchanged: plain `useState`, remembered by nothing, enforced in the start dispatcher rather than by a disabled button. **Nothing sends without it**                                                                                               |
| **What stays the floor**        | Every failure still lands on the device or on typing. Key unset, config unreachable, consent withheld, mint refused, socket dropped: no path falls through to the cloud, and none falls through silently                                                                     |
| **What narrowed**               | The hardware floor no longer forces typing by default. A socket loads no weights, so a machine below the floor is now offered streaming, and typing is what it falls to only when consent is withheld or the socket is unavailable                                           |
| **What made it a real control** | Until #363 the preference was written only in `CapturePanel`, which renders only before a transcript exists, while the card it governs needs one. The switch and the microphone could never be on screen together, so the standing half was unreachable from its own surface |
| **Who authorised it**           | @Andersonnn7788, 2026-09-10, scoped to prescription dictation on the review page and nothing else                                                                                                                                                                            |

**This is the same shape as #228, and the difference is the half worth reading.** #228 collapsed the two controls into one remembered setting and left the interface claiming each patient was asked while nothing asked; #254 undid it. Here the per-consultation half is untouched, still asked once per consultation, and still the only thing that opens the socket, so the failure #228 had, a remembered agreement applying to the patient after the consenting one, is not reintroduced. What is genuinely weaker is defence in depth: one of the two acts is now a default rather than a decision, and a doctor who never opens the Audio dialog is offered the cross-border path on every consultation. That is recorded here rather than argued away, because the honest count of live controls on this surface is one.

**Why the default moved at all.** The measurement in the amendment above is the whole argument. A real-time factor of 0.89 on the best path and 2.14 on the fallback most clinic hardware runs, against a threshold of 1.0 for keeping pace with speech, means an on-device default is one most doctors would have to leave. A default nobody keeps and a preference nobody could reach, which is what #363 also found, together made the on-device default a claim the product was making rather than a protection it was giving.

### Amended 2026-09-10: The Tick Goes, And The Surface Becomes A Theatre

**The two amendments above cost a control each by degrees. This one removes the last of them outright, on the owner's instruction, and the honest count of live consent controls on this surface is now zero.** Nothing about the egress changes: same vendor, socket, region and minting route, and the same sign-off covers it.

|                             |                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**            | The residency disclosure and the per-consultation tick were removed from prescription dictation. Pressing Dictate opens the socket                                                                   |
| **What it costs**           | Every deliberate consent act on this surface. A doctor who touches nothing sends a patient's voice to a United States endpoint on one press, with nothing on screen saying so                        |
| **What still gates it**     | Nothing on this surface. `SONIOX_API_KEY` unset still fails closed to on-device, and the device preference is still selectable, but neither is a consent control                                     |
| **What did not weaken**     | The audit trail. `createLiveSession` now takes `consent` as an argument, dictation passes none, and the row records `consentAsserted: false`. A client that collects no agreement must not claim one |
| **What ambient keeps**      | Both halves, untouched. `LiveSessionRequestSchema` still refuses an ambient body without `consent: true`, and that mint still records `true`                                                         |
| **What else moved with it** | The compose surface became a full-viewport theatre (#365). One dictation now yields several prescriptions, each with its own sig re-parsed from its own stretch of text, confirmed together          |
| **Who authorised it**       | @Andersonnn7788, 2026-09-10, scoped to prescription dictation on the review page and nothing else                                                                                                    |

**The reason given was usability, and it is recorded as that rather than dressed up.** The disclosure and the tick sat between Dictate and the box on a card already too small for its contents, and the owner asked for them gone. No measurement supports the removal and none was claimed.

**What is genuinely lost is worth naming precisely.** MMC 003/2023 cl.18 wants consent specific to the purpose before capture, and the PDPA 2024 amendment makes voice biometric data requiring explicit consent. The interface no longer asks for either on this path. `docs/dpia.md` carries that as a residual risk rather than a closed one, and the release gate for real data is unchanged: synthetic data only until the controller decides otherwise.

**What was deliberately not done, because it would have been the #228 failure again.** The tick was not folded into the device preference, and no remembered agreement was introduced. There is simply no agreement now, which is a smaller claim than a false one.

**One thing got stronger.** `consentAsserted` was the literal `true` in the audit type, so the route could not have recorded anything else even had it wanted to. It is a boolean now, derived as `mode === 'ambient' && consent === true`, which is what lets the trail tell an asked patient from an unasked one. Derived rather than read from the body on purpose: the schema constrains `consent` on ambient only, so an older SPA reaching a newer API during a deploy skew could otherwise assert an agreement on a surface that no longer asks for one.

### The Per-Drug Sig, And Why It Is Not The Whole Phrase

One dictation naming four drugs gets one sig back from the parse endpoint, because `parseSig` reads a phrase and not a list. Attaching that sig to every accepted drug would put paracetamol's 500 mg on cetirizine, which is the wrong-dose failure the Not Built table below exists to prevent.

The theatre instead re-sends each accepted drug's own stretch of text to the same endpoint, bounded by the next drug name the matcher heard. Three properties make it safe to rely on:

- **It shows its working.** The slice is printed on the row it filled, so a bad boundary is visible rather than hidden inside a number.
- **It fails toward the empty field.** The slice starts at the drug's own name, so a dose spoken before the name ("500 mg of amoxicillin") is lost and the field stays empty. Starting earlier would catch it and would also open drug two's slice with drug one's trailing sig. An empty field asks the doctor a question; an inherited dose answers one they never asked.
- **It is still a draft.** Every field remains editable and nothing is stored until the doctor confirms.

It stays a client-side heuristic against an unchanged endpoint. The endpoint is deterministic, stores nothing, writes no audit row and allows thirty calls a minute, so the extra calls buy correctness at no boundary cost.

### The Stretch No Row Claims

**Bounding a slice at the next drug name is only half a boundary, and the missing half lost a drug.** Reported 2026-09-10 (#369): a dictation naming Dextromethorphan and then Strepsils recorded one prescription. Strepsils is a brand, brands are outside the lexicon by the Not Built table below, so the matcher offered a single candidate. With no second name to bound it, the first slice ran to the end of the utterance, and the row's quote presented the second drug's entire sig as evidence for fields none of that text supplied.

Three things were wrong at once, and only the third is new.

| Symptom                                               | Standing                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| The brand raised no candidate                         | Correct, and unchanged. Generic names only          |
| The doctor had to type the second drug by hand        | Correct, and unchanged. The system proposes no drug |
| Nothing said a second drug had been heard and dropped | The defect. Fixed                                   |

**The second boundary is the sig's own reach.** `parseSigWithSpan` reports the offset past which no field was read, the row's quote is cut there, and every stretch left over is shown under "Not Claimed By Any Row" for the doctor to add or ignore.

- **A gap is evidence, never a proposal.** It is quoted verbatim and no drug name is read out of it. The reason a gap is a gap is that the matcher recognised no name in it, so naming one would be the substitution the Not Built table bans.
- **A row staged from a gap does get its sig parsed**, because a gap has known bounds and there is a right answer to what dose was said inside it. Add By Hand, which has only the whole box, still does not.
- **It fails toward showing too much.** Where the first drug's half omits a field the second supplies, the parse reads across the boundary and the gap starts late. That is a visible wrong split, which is the direction the slice already chooses.

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

---

## D-004: Ambient Capture Stops Naming Where The Audio Goes

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| **Date**       | 2026-09-10                                                        |
| **Status**     | Adopted                                                           |
| **Issues**     | Follows #365 on the other Soniox surface. No issue filed for this |
| **Supersedes** | The residency disclosure shipped with ambient capture (#268)      |

### Decision

The paragraph above the ambient consent tick is removed. The tick stays, and is reworded to name what is being agreed to: that this patient is recorded and transcribed, for this consultation only.

The removed sentence read: "This consultation leaves this device as it happens: streamed from this browser to Soniox and transcribed in the United States. Our server issues the session key and never receives the audio."

### What Changes, And What Does Not

|                         |                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**        | The residency paragraph is gone from the ambient panel. The tick now reads "This patient has agreed to be recorded and transcribed, for this consultation only"         |
| **What it costs**       | **No screen in the product names the processor or the region for ambient capture.** The doctor is asked to record, and is told nothing about where the audio goes       |
| **What still gates it** | Both halves of the two-control rule, untouched: the Capture Mode preference and the per-consultation tick. Nothing streams without the tick, enforced in the dispatcher |
| **What did not weaken** | The trail. `LiveSessionRequestSchema` still refuses an ambient body without `consent: true`, and that mint still records `consentAsserted: true`                        |
| **What moved with it**  | Three claims elsewhere pointed at the removed sentence and were corrected in the same change: two in the Audio dialog, one in the theatre header comment                |
| **Who authorised it**   | The repository owner, 2026-09-10, scoped to the ambient panel and nothing else                                                                                          |

### The Reason Given Was Usability, And It Is Recorded As That

The owner's words were that the sentence is not important to show, and that the consent is the part that matters. No measurement supports the removal and none is claimed. It is the same reason and the same shape as the third amendment to D-001, one surface later.

**The difference from D-001 is the half worth reading.** Dictation lost its disclosure **and** its tick, so the honest count of consent controls there is zero. Ambient loses the disclosure only. A doctor still has to tick a box per patient before anything streams, so what went is the explanation, not the asking.

**What is genuinely lost is worth naming precisely.** MMC 003/2023 cl.18 wants consent specific to the purpose before capture, and a purpose stated without a recipient is a weaker statement of it. `docs/dpia.md` carries that as a residual risk rather than a closed one, and the release gate for real data is unchanged: synthetic data only until the controller decides otherwise.

### What This Decision Does Not License

- **No change to the two-control rule.** `.claude/rules/security.md` still governs this surface in full. The tick may not be folded into the preference, and the start dispatcher may not fall through to another path instead of refusing.
- **No claim, anywhere, that the interface discloses residency on this path.** A document or comment that says the ambient gate names the processor is now false. This is the failure the Audio dialog has already shipped twice.
- **No second disclosure appearing somewhere quieter.** Moving the sentence into a tooltip, a title bar, or a settings card would be a claim made by a surface the doctor is not reading at the moment of consent, which is worse than the absence recorded here.
- **No change to the egress.** Same vendor, socket, region, minting route, session cap and audit pair. Nothing about what leaves the browser moves.
