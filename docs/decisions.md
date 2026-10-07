# Decisions

Scope decisions that change what this product does, recorded rather than silently applied. `docs/prd.md` Section 1 names this file as the place a post-final scope change must land.

**What belongs here:** a change to what the product will or will not do, where the reasoning matters more than the diff. Implementation choices belong in `docs/trd.md` Section 19. A question still open belongs in Section 19 too, until someone answers it.

**Entry format:** an id, a date, a status, the decision in one sentence, the reasoning, and what the decision explicitly does not license. Entries are appended and never rewritten. A decision that is later reversed gets a new entry that says so.

---

## D-001: Dictated Medication Capture

|                |                                                               |
| -------------- | ------------------------------------------------------------- |
| **Date**       | 2026-09-09                                                    |
| **Status**     | Adopted. Amended 2026-09-10 three times, and 2026-10-06 twice |
| **Issues**     | #310, #311, #312, #313, #355, #356, #357, #363                |
| **Supersedes** | Nothing. Clarifies `docs/prd.md` Section 6                    |

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

### Amended 2026-10-06: The Engine Choice Goes

**The last device-level choice on this surface is removed, on the owner's instruction.** Nothing about the egress changes: same vendor, socket, region and minting route.

|                       |                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**      | The Prescription Dictation section left the Audio dialog, the dialog's mount in the dictation theatre went with it, and `AudioSettings.dictationEngine` no longer exists                        |
| **What runs now**     | Streaming, always, falling back to this device when streaming is unavailable or unreachable, with the notice that says so. A stored `dictationEngine` is dropped on load                        |
| **What it costs**     | The doctor's last way to keep dictation on this device by choice. A device that had chosen on-device now streams. This is the owner's call, recorded here rather than argued away               |
| **What still holds**  | Every failure lands on this device or on typing, never silently on the cloud: key unset, config unreachable, mint refused, socket dropped. The audit row still records `consentAsserted: false` |
| **Who authorised it** | @AlaskanTuna, 2026-10-06, scoped to prescription dictation on the review page                                                                                                                   |

### Amended 2026-10-06: One Read, One Table Of Lines

**A doctor dictated three drugs and the theatre found two.** "Amoxicillin 500 mg, paracetamol 350 mg, antibiotic 200 mg, all of them 2 times a day" offered amoxicillin and paracetamol, folded "antibiotic 200 mg" into paracetamol's quote, and gave "2 times a day" to paracetamol alone. Every drug also needed its own Accept, even when it was heard exactly.

**The parse now reads the whole dictation into lines, one per drug, and the theatre shows them as one table.** Still deterministic, still no model, and still nothing stored before Confirm. Three decisions came with it, each authorised by @AlaskanTuna on 2026-10-06.

| Decision                                                 | What it means                                                                                                                                                                                                                                                                                                                    | Why it stays inside this decision                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. An exact name starts ticked**                       | A name heard exactly as the lexicon spells it is ticked, so Confirm accepts it. Never ticked for the doctor: a near-match, a single agent inside a combination also heard, or a drug said in one breath with another. A near-match holds Confirm until the doctor ticks it, picks another reading, types a name or leaves it out | Nothing is substituted: the name on the line is the name said. Confirm is still the act that records it, and a reading the matcher had to guess at can be neither saved nor dropped without the doctor |
| **2. A shared clause fills every line, except the dose** | "All of them", "both" or "semua", followed by a frequency, duration, route or food timing, fills that field on every line that left it unsaid. Each filled field names the clause it came from, and the clause travels in `dictated`                                                                                             | A dose belongs to one drug. A shared clause that carries a dose becomes a line of its own instead, so it is neither spread nor dropped                                                                 |
| **3. A line nobody named holds Confirm**                 | A line with a sig but no recognised name, such as "antibiotic 200 mg" or a brand, is shown with a dashed outline and an empty drug field. Confirm stays held until the doctor names it or unticks it                                                                                                                             | No drug is proposed for it. Generic names are offered as typing suggestions only, and a typed name carries no `lexiconId`                                                                              |

**Where a line ends is a heuristic, and it shows its working.** Each line quotes the words it was read from, and the TRD lists the rules. The clinical review on 2026-10-06 reproduced three ways a dose reached the wrong drug, each fixed and pinned by a test:

| Dictation                                       | Was                                       | Now                                                                 |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| "Paracetamol, Brufen, 400 mg three times a day" | 400 mg on paracetamol, ticked             | A line for "Brufen, 400 mg", unnamed; paracetamol's dose left empty |
| "Cefuroxime, cefixime 200 mg twice a day"       | Merged as one cefuroxime line with 200 mg | Two lines; the look-alike is a near-match that needs a decision     |
| "amoxicillin three times a day 1 g paracetamol" | Both ticked, 1 g on amoxicillin           | Neither ticked, because whose dose it is is a guess                 |

**A dictation benchmark on 2026-10-07 found three more,** running accented synthetic speech through the production recogniser. Each is fixed and pinned by a test:

| Dictation, as the recogniser wrote it                                | Was                                                                                    | Now                                                                                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| "Paracetamol 1 g, 4 times a day. Amoxicillin 500 mg, 3 times a day." | Paracetamol's frequency on amoxicillin, ticked; amoxicillin's an unnamed line          | Each frequency on its own drug. "day. Amoxicillin" also reads as doxycycline, and that reading no longer hides the full stop |
| "cetirizine 10 mg sekali sehari waktu malam"                         | Cetirizine empty and unticked, beside an amoxicillin-clavulanate line holding its dose | One cetirizine line, ticked. A reading of sig words alone is not a name                                                      |
| "Paracetamol three times a day, for 7 days Brufen 400 mg"            | 400 mg on paracetamol, ticked, and Brufen gone                                         | An unnamed line for "for 7 days Brufen 400 mg"; paracetamol's dose left empty                                                |

**One known gap stays.** A brand with no dose and no repeated field, as in "amoxicillin 500 mg, Panadol four times a day", still joins the line before it. That line's quote shows it.

**The box is read again about 0.6 s after the doctor stops editing it**, and the Check button is gone. Fields the doctor changed are kept across reads, keyed by drug rather than by offset. Confirm is held while the table is behind the text.

The two sections below describe the mechanism this replaces. They stay as the history of why a line has the boundaries it has.

### The Per-Drug Sig, And Why It Is Not The Whole Phrase

_Superseded 2026-10-06 by One Read, One Table Of Lines above._

One dictation naming four drugs gets one sig back from the parse endpoint, because `parseSig` reads a phrase and not a list. Attaching that sig to every accepted drug would put paracetamol's 500 mg on cetirizine, which is the wrong-dose failure the Not Built table below exists to prevent.

The theatre instead re-sends each accepted drug's own stretch of text to the same endpoint, bounded by the next drug name the matcher heard. Three properties make it safe to rely on:

- **It shows its working.** The slice is printed on the row it filled, so a bad boundary is visible rather than hidden inside a number.
- **It fails toward the empty field.** The slice starts at the drug's own name, so a dose spoken before the name ("500 mg of amoxicillin") is lost and the field stays empty. Starting earlier would catch it and would also open drug two's slice with drug one's trailing sig. An empty field asks the doctor a question; an inherited dose answers one they never asked.
- **It is still a draft.** Every field remains editable and nothing is stored until the doctor confirms.

It stays a client-side heuristic against an unchanged endpoint. The endpoint is deterministic, stores nothing, writes no audit row and allows thirty calls a minute, so the extra calls buy correctness at no boundary cost.

### The Stretch No Row Claims

_Superseded 2026-10-06 by One Read, One Table Of Lines above. The #369 dictation now reads as two lines, the brand left unnamed for the doctor._

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

|                         |                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**        | The residency paragraph is gone from the ambient panel. The tick now reads "This patient has agreed to be recorded and transcribed, for this consultation only"                                                                                            |
| **What it costs**       | **No screen in the product names the processor or the region for ambient capture.** The doctor is asked to record, and is told nothing about where the audio goes                                                                                          |
| **What still gates it** | Both halves of the two-control rule, untouched: the Capture Mode preference and the per-consultation tick. Nothing streams without the tick, enforced in the dispatcher. **The Capture Mode half was superseded on 21/09/26, see D-007; the tick was not** |
| **What did not weaken** | The trail. `LiveSessionRequestSchema` still refuses an ambient body without `consent: true`, and that mint still records `consentAsserted: true`                                                                                                           |
| **What moved with it**  | Three claims elsewhere pointed at the removed sentence and were corrected in the same change: two in the Audio dialog, one in the theatre header comment                                                                                                   |
| **Who authorised it**   | The repository owner, 2026-09-10, scoped to the ambient panel and nothing else                                                                                                                                                                             |

### The Reason Given Was Usability, And It Is Recorded As That

The owner's words were that the sentence is not important to show, and that the consent is the part that matters. No measurement supports the removal and none is claimed. It is the same reason and the same shape as the third amendment to D-001, one surface later.

**The difference from D-001 is the half worth reading.** Dictation lost its disclosure **and** its tick, so the honest count of consent controls there is zero. Ambient loses the disclosure only. A doctor still has to tick a box per patient before anything streams, so what went is the explanation, not the asking.

**What is genuinely lost is worth naming precisely.** MMC 003/2023 cl.18 wants consent specific to the purpose before capture, and a purpose stated without a recipient is a weaker statement of it. `docs/dpia.md` carries that as a residual risk rather than a closed one, and the release gate for real data is unchanged: synthetic data only until the controller decides otherwise.

### What This Decision Does Not License

- **No change to the two-control rule.** `.claude/rules/security.md` still governs this surface in full. The tick may not be folded into the preference, and the start dispatcher may not fall through to another path instead of refusing.
- **No claim, anywhere, that the interface discloses residency on this path.** A document or comment that says the ambient gate names the processor is now false. This is the failure the Audio dialog has already shipped twice.
- **No second disclosure appearing somewhere quieter.** Moving the sentence into a tooltip, a title bar, or a settings card would be a claim made by a surface the doctor is not reading at the moment of consent, which is worse than the absence recorded here.
- **No change to the egress.** Same vendor, socket, region, minting route, session cap and audit pair. Nothing about what leaves the browser moves.

---

## D-005: The Browser Stops Depending On The Analyze Response

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| **Date**       | 2026-09-11                                                                       |
| **Status**     | Adopted                                                                          |
| **Issues**     | #373                                                                             |
| **Supersedes** | The one-shot `onError` re-read adopted for #340                                  |
| **Answers**    | D-003's open question: whether synchronous analysis behind the rewrite is viable |

### Decision

The record's `status` is what says whether analysis is running, and the review page reads it until it settles. `POST /analyze` stays synchronous and its response stays the fast path, but it is no longer the only path.

Three parts, all of which are needed for any of them to be correct:

| Part          | Change                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **The poll**  | The detail query re-reads every `ANALYSIS_POLL_MS` while the record says `analyzing`, and stops when it settles or expires |
| **The lease** | `analyzing` is honoured for `STALE_ANALYSIS_MS`, after which a fresh press re-claims the row                               |
| **The claim** | The guard and the `analyzing` write become one conditional `updateMany`, so two presses cannot both proceed                |

### Reasoning

- **The failure was reported, not predicted.** A doctor pressed Analyse on a long transcript, waited past two minutes, and got a button that spun and said "Analysis failed" at once. The analysis had finished and been saved; a refresh showed it. D-003 had already named this as the open question and declined to answer it.
- **The one-shot re-read loses a race it was written to win.** `onError` re-reads once, at t=120s, which is exactly when the pipeline is most likely to still be running. It then wrote `analyzing` into the cache, the button latched on it, and nothing re-read again. The recovery mechanism was what created the permanent spinner.
- **A poll survives what a stream does not.** Streaming `/analyze` would defeat the 120s ceiling, and `routes/copilot.ts` proves the pattern works through the same rewrite. It would not survive a reload, a closed tab, or a dropped connection, and those are ordinary in a clinic. The doctor who waited and the doctor who refreshed should see the same thing.
- **The lease is what stops one wedge replacing another.** Without it the poll spins forever on a row abandoned by a restarted process, and the 409 guard refuses every retry. Sharing the constant is what makes the client's give-up point and the API's accept point the same instant rather than two numbers that drift.
- **The atomic claim came free with the lease.** The guard was being rewritten anyway, and one conditional update is simpler than read-then-check-then-write as well as correct under concurrency.

### What This Decision Does Not License

- **No autonomous retry.** The poll re-reads a record; it never re-presses. CAP-5 still makes the doctor's press the only retry, and nothing here weakens it.
- **No claim that analysis is fast enough.** The wait is unchanged. What changed is that it now ends. Making the delay legible to the doctor rather than merely survivable is #224, still open.
- **No sweeper.** The lease releases a dead claim lazily, on the next press, which is the only moment it matters. A background job to tidy `analyzing` rows would be state nobody reads.
- **No reliance on `updatedAt` beyond its current coupling.** It is the lease clock only because nothing writes the row mid-run. A mid-run write means a real `analysisStartedAt` column and a migration, not a longer lease.
- **No widening of the poll.** It exists for one status on one page. A page that polls because it might be interesting is a page that bills for nothing.

---

## D-006: The Printed Report Is A Separate Artefact From The EHR Export

|                |                                                                                     |
| -------------- | ----------------------------------------------------------------------------------- |
| **Date**       | 2026-09-20                                                                          |
| **Status**     | Adopted                                                                             |
| **Issues**     | #376                                                                                |
| **Supersedes** | The `@media print` subtraction approach shipped for #26, for the approved-note case |

### Decision

An approved consultation's printed report is a separate document with its own field contract (`docs/trd.md` §26), not a print rendering of the §23 EHR export payload and not governed by that contract's field list.

### Reasoning

- **Two recipients, two minimum-necessary answers.** §23's contract pushes to a clinic EHR and excludes patient identifiers and `ClinicalAssertion.evidence` for that recipient. The printed report goes into the patient's chart or the patient's hand, so the patient name and the prescriptions belong on it.
- **A document, not a filtered screen.** The replaced approach subtracted chrome from the live review page through scattered `data-print="hide"` attributes and printed the DOM dump that remained. The report is a dedicated route whose entire DOM is the document, so print correctness no longer depends on attributes staying in sync with the layout.
- **The browser already holds everything it prints.** The report renders from the consultation detail payload at `/consultations/:id/report` and prints through `window.print()`: no new egress, no new logging, no server round trip, no stored file.

### What This Decision Does Not License

- **No patient identifiers in the §23 payload.** The EHR export contract still excludes them; this decision runs the other way only, licensing identifiers on the printed report because its recipient differs.
- **No reading of the report as an EHR integration.** It is a browser-rendered document. §23's push direction, authentication, transport and FHIR assessment are untouched and still unbuilt.
- **No citation of the de-identification gate as protecting either artefact.** The gate guards LLM egress. The report never crosses it, and a real EHR export is an identifiable-data path the gate does not protect — the point §23's PHI-boundary subsection already makes, recorded here from the other end.

---

## D-007: A New Consultation Opens In Ambient Capture

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Date**       | 2026-09-21                                                                                                               |
| **Status**     | Adopted                                                                                                                  |
| **Issues**     | #378                                                                                                                     |
| **Supersedes** | `Consultation.captureMode @default(manual)` (#272), and D-004's "What still gates it" row for the Capture Mode half only |
| **Follows**    | D-001's third amendment, which made the same move on the dictation surface on 10/09/26                                   |

### Decision

A consultation **that opens empty** is created in `ambient`. Press To Record remains a full capture path, selectable per consultation in Consultation Settings until a transcript exists.

Two populations are deliberately excluded, for the same reason.

- **Any consultation whose transcript did not stream.** A `source` other than `asr_live` means the audio was captured some other way or never existed, so the mode is written `manual`, both on a create that carries the transcript and on the `PATCH` that later brings one in. The mode locks the instant a transcript exists, and a row asserting a stream that never happened could never be corrected afterwards. The transcript's `source` stays the record of which path ran; this only stops the mode contradicting it.
- **Consultations created before 21/09/26.** The migration issues `SET DEFAULT` and no `UPDATE`, so it rewrites no row at all. That leaves untranscribed drafts on `manual` too, which is the conservative reading and is chosen rather than overlooked: the mode is consent-adjacent state, and a migration is the wrong place to change one on a record a doctor already opened.

### What Changes, And What Does Not

|                               |                                                                                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**              | `Consultation.captureMode` defaults to `ambient`, and the create route writes it on the empty-create path so the value does not depend on migration-versus-deploy ordering                                                                                                   |
| **What backing it out takes** | A forward migration, `SET DEFAULT 'manual'`, plus removing the write. Reverting the code alone is a no-op, because the column default then supplies `ambient` anyway. Never delete this migration directory: Prisma would see an applied migration with no local counterpart |
| **What it costs**             | Capture Mode is one half of the ambient two-control rule, and it now ships pre-set to the value that can stream. A doctor who changes nothing lands on ambient                                                                                                               |
| **What still gates it**       | The per-consultation tick, unchanged. `AmbientCapture`'s start dispatcher refuses without it, and `LiveSessionRequestSchema` rejects an ambient body lacking it                                                                                                              |
| **What did not weaken**       | The trail. The mint still records `consentAsserted: true` for ambient, and a stream nobody agreed to still cannot be opened                                                                                                                                                  |
| **What did not move**         | The egress. Same vendor, socket, region, minting route and session cap. Nothing new leaves the browser and no new surface may open it                                                                                                                                        |
| **Who authorised it**         | @Andersonnn7788, 2026-09-21, scoped to the capture-mode default and nothing else                                                                                                                                                                                             |

### The Reason Given Was Workflow, And It Is Recorded As That

The owner's words were that a coming consultation should land on ambient scribe rather than press to record. No measurement supports the change and none is claimed: ambient was already the mode a doctor reaches for when the consultation is the thing being recorded, and the default was asking them to say so every time.

**What it costs is honest to state as a count.** On ambient the rule was two chosen controls; it is now one defaulted preference plus one deliberate tick, which is the shape the dictation surface took on 10/09/26. The difference from that surface is the half worth reading: dictation ended with zero live controls, ambient keeps its tick, so a doctor still agrees per patient before anything streams.

**The asymmetry with the relay is deliberate.** `DEFAULT_AUDIO_SETTINGS.engine` stays `'local'`, so the press-to-record path still sends nothing by default. Only the mode moved.

### What This Decision Does Not License

- **No change to the two-control rule.** `.claude/rules/security.md` still governs this surface in full. The tick may not be folded into the mode, and the start dispatcher may not fall through to another path instead of refusing.
- **No backfill.** Rewriting `captureMode` on a consultation that already has a transcript would make the column claim audio was taken a way it was not. The transcript's own `source` remains the record of which path actually ran.
- **No weakening of the transcript lock.** The mode is still immutable once `Consultation.transcript` is non-null, and the API still answers `409 invalid_state` to a late write.
- **No second disclosure, and no restored one.** D-004 removed the residency paragraph above the ambient tick and that stands. This decision makes the unexplained path the default one, which sharpens D-004's recorded cost rather than reopening it.
- **No silent substitution, and no dishonest one.** Where the provider answers `asr_unavailable` the Record tab shows press-to-record instead of an unusable ambient panel, says on screen that it did, and **moves the consultation's mode with it**. Showing one path while the record claims the other is how a consultation ends up locked at `ambient` with nothing having streamed, which is the same falsehood the first bullet refuses. The substitution reads the error code and not just the `503`, so a cold start cannot trigger it.
- **No change to the release gate.** Synthetic data only until the controller decides otherwise.

---

## D-008: Two-Way Machine Translation For Urdu And Bengali Speakers

|             |                                                                             |
| ----------- | --------------------------------------------------------------------------- |
| **Date**    | 2026-09-28                                                                  |
| **Status**  | Adopted                                                                     |
| **Issues**  | #389, #390, #391, #392, #393                                                |
| **Follows** | `docs/trd.md` §20.10's grant, extended the same day to translation (§20.12) |

### Decision

Ambient capture can pair English with Urdu or Bengali, in both directions.

- **On screen.** The patient's words show with English beneath, and the doctor's English shows with the patient's language beneath.
- **What the product keeps.** The English is what it stores, analyses and raises red flags from.

### What The Owner Decided, And What Each Costs

| Decision                                                           | What it costs                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Both directions**, so each side can read the other               | The doctor's words reach the patient through machine translation too, and nothing measures its quality on real speech                                                   |
| **The original words are kept** with each turn, beside the English | More PHI at rest, in a script no detector reads. It sits in the transcript column, so erasure reaches it, and nothing sends it to a model                               |
| **Consent stays English only**, naming machine translation         | A patient who reads neither English nor Malay cannot read what the doctor asserts they agreed to. The tick records the doctor's assertion, which is all it ever records |

### What Was Decided With It

- **Soniox stays.** Research across Soniox, the hyperscalers, and specialist and open models found it the only candidate that adds no egress. Qwen LiveTranslate, with a Singapore endpoint, is the follow-up pilot (§20.12).
- **Roles come from the spoken language.** English is drafted as the doctor and anything else as the patient, with no labelling pass. Labels stay unreviewed, so the red-flag engine keeps its fail-open reading.
- **The audit trail records nothing about translation.** With two languages on offer, even a boolean names a likely national origin, and the trail outlives erasure.

### What This Decision Does Not License

- **No claim of interpreting.** This is machine translation. NHS England advises against it replacing an interpreter for consent and high-stakes content, and the product says "machine-translated" wherever it shows the result.
- **No other language pair** without its own measurement and its own grant row. That includes Punjabi, and Malay as the doctor's half of the pair.
- **No unreadable script in model input.** Only Latin script reaches `turn.text`, and the `SCRIPT` detector (#391) tokenises Bengali, Arabic and Devanagari at the gate whatever a client sends. Chinese and Tamil are the exception; see the amendment below.
- **No claim about accuracy.** #389 measured the wire and the red-flag engine on synthetic voices, never recognition or translation quality on real speech.
- **Who authorised it:** @Andersonnn7788, 2026-09-28, for the scope above and nothing else.

### Amended 06/10/26: Mandarin And Tamil, Unmeasured

The same two-way translation now pairs English with Mandarin (`zh`) or Tamil (`ta`), for Mandarin- and Tamil-speaking patients (#385).

|                                        |                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it adds**                       | Two rows in `translatedAmbientConfig`, each hinting `[language, 'en', 'ms']` with diarisation off and endpoint detection on, exactly as Urdu and Bengali                                                                                                                                                                                                                                                |
| **What it skips**                      | The measurement this decision asks of every new pair. Neither language has been streamed through Soniox's translation here, and red-flag recall on their translated English is unknown. The grant comes ahead of the measurement and is recorded as that                                                                                                                                                |
| **What differs from Urdu and Bengali** | The gate's `SCRIPT` detector does not read Chinese or Tamil, because the untranslated Auto-detect path relies on both reaching the note. On a translated session the script guard in `frontend/src/audio/live/bilingual.ts`, now an allowlist of Latin script, keeps them out of `turn.text`. It runs in the browser, so a client other than the SPA, or a doctor's edit to the transcript, bypasses it |
| **Names**                              | Mandarin translation spells a name in Pinyin ("Chen", not "Tan"), so thirty common Pinyin surnames join the gazetteer, leaving out any that are also an English or Malay word                                                                                                                                                                                                                           |
| **Cantonese**                          | Not a pair of its own. Chinese-script speech the recogniser tags as anything but `zh` is still kept out of `turn.text`: its English is used if a translation arrives, and otherwise the turn reads as untranslated                                                                                                                                                                                      |
| **Who authorised it**                  | @AlaskanTuna, 2026-10-06, for these two languages on ambient capture and nothing else                                                                                                                                                                                                                                                                                                                   |

---

## D-009: Which Language Takes Which Capture Path, And What Is Not Supported

|            |                                                                         |
| ---------- | ----------------------------------------------------------------------- |
| **Date**   | 2026-10-07                                                              |
| **Status** | Adopted                                                                 |
| **Issues** | #218, #418                                                              |
| **Builds** | §20.10 "Measured 07/10/26" in `docs/trd.md`, which supplies the numbers |

### Decision

Each language goes to the path below, and Cantonese is stated as not supported on the Record tab rather than left to fail quietly.

| Language               | Path                                                    | Measured on that path (synthetic voices, `docs/trd.md` §20.10)            |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| English, Manglish      | Ambient Auto-Detect, or on-device press-to-record       | English measured elsewhere (§20.1); not re-run here                       |
| Malay                  | Ambient Auto-Detect, or the ILMU relay                  | 9.4% WER                                                                  |
| Mandarin               | Ambient Auto-Detect, or translated with English (D-008) | 6.5% CER                                                                  |
| Tamil                  | Ambient Auto-Detect, or translated with English (D-008) | 8.2% WER                                                                  |
| Urdu, Bengali          | Translated with English only (D-008)                    | Wire and red flags only (#389)                                            |
| **Cantonese**          | **Not supported.** The Record tab says so               | 62.5% CER, recognised as Mandarin; the real-time API refuses a `yue` hint |
| Other Chinese dialects | Not supported, unmeasured                               | None                                                                      |

### Why

- **Tamil changed sides.** #218's 05/09/26 run found Tamil unusable (71.8% WER) on `qwen3-asr-flash`, which does not list it. Ambient capture moved to Soniox on 06/09/26 (§20.10), and Tamil on the production config now reads at 8.2%. The vendor fork #218 asked for is answered by the provider already in place, so no second vendor is needed for it.
- **Cantonese did not.** Synthetic Cantonese came back as Mandarin-script text with the clinical content wrong ("我可做生意了" for "我咳咗三日喇"). Part of the 62.5% is the traditional-to-simplified script swap, but not most of it. The vendor's dialect support is not reachable from the real-time endpoint without the hint it refuses.

### What This Decision Does Not License

- **No accuracy claim to a client.** Every number above is synthetic text-to-speech, two voices, six read lines per language. Real consulting-room speech, Malaysian varieties of Tamil and Mandarin, and code-switching remain unmeasured.
- **No new egress, surface or language pair.** This records where existing paths already send each language. Translation pairs stay governed by D-008.
- **No claim that Mandarin or Tamil is de-identified.** On Auto-Detect, a name spoken in either reaches the model in its own script. That gap is #418, pinned as known-bad in `deid.test.ts`, and stays open until it is decided.
- **Who recorded it:** @AlaskanTuna's issue triage of 2026-10-07, stating routing already in production plus one sentence of on-screen copy.

---

## D-011: A Name In Chinese Or Tamil Script Is Found By Its Cue

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Date**       | 2026-10-08                                                                             |
| **Status**     | Adopted                                                                                |
| **Issues**     | #418                                                                                   |
| **Supersedes** | D-009's "No claim that Mandarin or Tamil is de-identified" bullet, for cued names only |

### Decision

`detectNativeScriptNames` tokenises a name in Chinese or Tamil script where a cue says a name is there, and nothing else. The note keeps reading Mandarin and Tamil speech, which is why `SCRIPT` still leaves both scripts alone.

| Cue                                 | Example                                                | Tokenised                                                                            |
| ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Self-introduction, Chinese          | 我叫陈美玲, 我的名字是王小明, 我姓陈，叫美玲, 他叫陈伟 | A name opening on a listed surname, or a given name alone where the clause then ends |
| Self-introduction, Tamil            | என் பெயர் ஆர். லட்சுமி, என் பேர் முருகன்               | Up to two words, with an initial                                                     |
| Latin introducer or title before it | Nama saya 陈美玲, Mr 陈, Encik ராமசாமி                 | The script name after it                                                             |
| Title after a surname               | 陈先生, 给林医生, 司徒先生                             | The surname alone, where it starts a word                                            |
| Title before a Tamil name           | திரு ராமசாமி, திருமதி லட்சுமி                          | One word, with an initial                                                            |

A name found by its cue is found again wherever it is repeated in the same text, unless it is one character (陈 also opens 陈皮) or the capture did not end a clause, so a wrong guess cut from a phrase is never spread. A Tamil name is carried only as a whole word.

### Why Cues, And Why So Narrow

Measured against a precision corpus of 118 clinical Mandarin, Cantonese, Tamil and code-switched lines, pinned in `deid.test.ts`, every one of which must pass unchanged. Three rounds of `phi-boundary-auditor` built it.

- **A Chinese name must open on a listed surname.** "我叫" is as often "I called" (我叫救护车, an ambulance) as "my name is", and the surname is what tells them apart.
- **The title rule reads the surname alone, and only where it starts a word.** That is after punctuation, a space, or a verb that takes a person (给, 找, 是, 谢). Reading back from the title turned 白天医生 ("daytime, the doctor") into a name, and any other character before the surname usually makes it the end of a word: 体温医生 ("temperature, the doctor"), 主任医生 ("the consultant").
- **A Latin cue is a whole word and must be followed by a whole name.** "symptoms" contains "Ms", and "Dr 高烧三天" is "doctor, high fever for three days".
- **Bare 名字是 and 病人叫 are not cues.** They are as often a drug's name or a patient crying out.
- **One Tamil word after a title.** A second one was as often the symptom that followed (செல்வி கவிதா இருமல், "cough").

### What Still Passes

- **A name said with no cue.** "陈美玲今天咳嗽" reaches the model on the Auto-Detect path. Translated sessions are unaffected: the script never reaches `turn.text` there.
- **A full name before a title,** as in 陈美玲小姐, pinned as a known gap.
- **A surname outside the list,** a Tamil father's name after a title, and a native-script address.

### What This Decision Does Not License

- **No claim that Mandarin or Tamil is de-identified.** Cued names are; the rest is the residual risk recorded in `docs/dpia.md`.
- **No bare surname or given-name list for either script,** and no widening of the cues, without the precision corpus still passing unchanged.
