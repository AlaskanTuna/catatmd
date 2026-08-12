# PRD

> Owned by **PL**, implemented against by **PG**, verified by **QA**. This document defines what the prototype must do and how each capability is judged complete. It does not describe implementation — see `docs/trd.md` for contracts, schemas, and module boundaries. It does not carry the reader-facing narrative — see `docs/README.md`.

**Status:** first draft, Gate 1 answers adopted (Q1–Q14). Living document — see the Iteration Protocol in `docs/plan.md`.

**Submission:** https://dxp.kabel.my/candidate/projects/d30f9b0b-bd4e-43a2-81b2-08fdb8458a61

---

## Problem & Context

A GP consultation produces a spoken conversation that must become a structured clinical note. Writing that note by hand costs the doctor time during or after every consultation, and the resulting notes vary in structure and completeness from doctor to doctor and day to day — there is no consistent prompt to capture missing history, and no systematic check for symptoms that should trigger escalation.

This prototype narrows that problem to a single, well-bounded presentation: adult GP consultations for acute cough, sore throat, and other upper respiratory symptoms. That scope is deliberate. Upper respiratory presentations are common, well covered by published guidance (NICE, Centor/FeverPAIN, WHO, Malaysian CPG), and structurally simple enough that a first prototype can be judged honestly against real acceptance criteria rather than against an open-ended clinical domain.

The prototype is a documentation aid, not a diagnostic device. It will be evaluated by an external party against a working end-to-end demonstration and a written proposal; this document is the source of truth for what "working" means.

---

## Who It Is For

**Primary persona:** a GP in an adult-practice clinic setting in Malaysia, seeing a steady stream of short consultations and documenting each one under time pressure.

- **Environment.** Desktop or tablet browser, used between or immediately after consultations; not a dictation device used mid-consultation.
- **Will tolerate.** Reviewing and correcting an AI-drafted note before it is saved; being prompted to clarify something they did not ask; seeing a red flag surfaced even when they already judged the patient safe.
- **Will not tolerate.** A note that saves itself without their approval; a suggestion presented as a diagnosis; a red flag that can be silently dismissed with no record; any workflow that is slower than writing the note unaided.

Gate 1 introduced a second seeded doctor account only to demonstrate ownership isolation (Q2) — this does not introduce a second persona. Every account represents the same primary persona above.

---

## Goals

- Turn a transcript into a structured SOAP note the doctor can review in seconds, not minutes.
- Surface clinically relevant gaps the doctor did not address, each with a stated rationale.
- Catch predefined red flags deterministically, so detection does not depend on model behaviour.
- Offer clinical suggestions the doctor can verify against a real, ID-constrained citation.
- Make review, edit, and approval an explicit, auditable step — never a default.

## Explicit Non-Goals

- **Diagnosis.** The system never states or implies a diagnosis.
- **Triage decisions.** Red flags are escalation prompts for the doctor to weigh, not automated triage outcomes.
- **Autonomous action.** Nothing is sent, prescribed, scheduled, or escalated without the doctor initiating it.
- **Prescribing.** No medication, dosage, or treatment plan is generated or suggested.
- **EMR write-back.** The approved note stays inside this system; "send to EMR" is out of scope.
- **Real patient data.** All consultation data is simulated; the system is not built or tested against real identifiers.
- **Confidence or uncertainty display (Q20).** No numeric or visual confidence signal is shown for any AI output — it would invite misplaced trust in an unvalidated prototype.

---

## Product Principles

- **The AI should interrupt only when useful.** Gaps and red flags are shown to be weighed, not to maximize alert volume.
- **Every clinical claim should be traceable.** Red-flag evidence (CAP-3) and guideline citations (CAP-4) exist so the doctor can check the AI's basis, not just its conclusion.
- **Use local Malaysian guidance first.** The guideline corpus is drawn from Malaysian and internationally recognised sources appropriate to a Malaysian GP setting (Known Limitations).
- **Privacy is an architectural boundary, not a disclaimer.** The de-identification gate sits between the API and every external LLM call (`AGENTS.md`); no prompt or product-copy assurance substitutes for it.
- **The product should feel like clinical software, not a general chatbot with a medical skin.** The review screen presents structured findings the doctor acts on, not a conversation.

---

## Clinical Scope

**In scope:** adult patients, GP setting, presentations of acute cough, sore throat, or other upper respiratory symptoms.

**Out-of-scope presentations.** When a transcript describes a presentation outside this scope (e.g. a chest injury or a paediatric consultation), the system still generates a note, gap list, and any rule-triggered red flags — the deterministic red-flag engine and the SOAP structure are general-purpose. It does **not** attempt guideline-cited suggestions outside the corpus's coverage, and the review screen carries a visible notice that clinical suggestions and citations are scoped to upper-respiratory presentations and may not apply. The doctor's review and approval step is unchanged.

---

## Primary Flow

Numbered against `Consultation.status` (`shared/src/index.ts`):

1. Doctor selects a bundled synthetic fixture, pastes transcript text, uploads a transcript file (`.txt` / `.json`), or captures a live consultation via browser-based audio transcription (Q1). For the audio path, transcription runs entirely on the doctor's device before anything is sent to the API — see `docs/trd.md` §20. A `Consultation` is created with status **`draft`** once a `Transcript` exists, regardless of which path produced it.
2. Doctor triggers analysis. Status transitions to **`analyzing`**.
3. The transcript is de-identified, analysed by the LLM, and checked against the deterministic red-flag rules engine (rules run regardless of model output; the model may only add candidates). On completion, status transitions to **`awaiting_review`** and the assembled `ConsultationAnalysis` is attached.
4. Doctor reviews the SOAP note, information gaps, red flags, and cited suggestions.
5. Doctor edits the SOAP note and acknowledges red flags as needed (red flags can be acknowledged, never removed — Q3). While still `awaiting_review`, the doctor may re-trigger analysis to refresh the draft.
6. Doctor explicitly approves. Status transitions to **`approved`**, `approvedAt` and an audit event are recorded, and a read-only finalised view with copy-to-clipboard and PDF/print export becomes available (Q4).
7. **`approved` is terminal.** No further edits, re-analysis, or status change is possible from this state.

---

## CAP-1 … CAP-5

### CAP-1 — Generate A Structured Clinical Note

The system generates a SOAP note (subjective, objective, assessment, plan) from the transcript.

**Acceptance Criteria**

- [ ] Running analysis on any bundled fixture produces a `SoapNote` with all four fields populated (non-empty strings).
- [ ] The note is visible on the review screen before any approval action is available.
- [ ] Analysis completes within **30 seconds** for a transcript of up to **3,000 words** (roughly a 20-minute consultation) — the stated non-functional target (Q11), measured from the doctor triggering analysis, not from when audio capture began. This target is not yet reconciled against `docs/trd.md` §12's two-sequential-call design, the second of which carries the full guideline corpus in the system prompt; see the TRD's Open Decisions Register, §19, row 8. Live audio capture (Primary Flow step 1) makes this reconciliation gap materially worse, not better: client-side transcription adds further wall-clock time before analysis is even triggered, and that time is not counted in the 30s figure at all — see `docs/trd.md` §20.
- [ ] The note is editable by the doctor prior to approval, and edits persist.

### CAP-2 — Identify Missing Clinical Information

The system surfaces information the doctor did not establish, as prompts to ask.

The completeness checklist for the in-scope presentation covers, at minimum: presenting symptoms (cough and duration, productive/non-productive, sputum characteristics, haemoptysis, sore throat, fever, dyspnoea, chest pain, swallowing difficulty, oral intake, symptom onset and progression), relevant history (asthma, COPD, cardiac disease, immunosuppression, smoking, relevant recent infection exposure, current medications, drug allergies), observations (temperature, heart rate, respiratory rate, blood pressure, SpO₂), and examination findings (throat, tonsillar, cervical lymph-node, chest). This fixes the categories the checklist must cover; the field-level schema and its assertion-state representation (Safety Constraints, above) is an open structured-schema question for `docs/trd.md` (§19, row 10), not decided here.

**Acceptance Criteria**

- [ ] Each gap carries a question, a rationale, and a priority (`high` / `medium` / `low`).
- [ ] The gap-heavy fixture (Q5) surfaces at least three gaps.
- [ ] Gaps are read-only findings — the doctor cannot edit gap text, only note that it has been reviewed.

### CAP-3 — Detect Predefined Red Flags And Escalation Triggers

Deterministic rules run first and cannot be suppressed by the model; the model may only add candidate flags for review.

**Acceptance Criteria**

- [ ] The hard-red-flag fixture (Q5) triggers its rule-sourced flag on every run — 100% reproducibility, since detection must not depend on model behaviour.
- [ ] Every red flag displays `severity`, `evidence`, and whether it came from a `rule` or the `model`; rule-sourced flags are visually distinct from model-sourced candidates.
- [ ] A red flag can be acknowledged by the doctor; it cannot be deleted or hidden from the record.

### CAP-4 — Provide Clinical Suggestions With Cited References

Suggestions are grounded in a curated guideline corpus; the model cites guideline IDs, never free text.

**Acceptance Criteria**

- [ ] Every clinical suggestion carries at least one citation (`citations.min(1)`).
- [ ] Every citation resolves to a real guideline ID in the corpus; a suggestion with an unresolvable or free-text reference fails validation and is never shown.
- [ ] Selecting a citation shows the doctor the underlying guideline entry (title, publisher, year, URL).

### CAP-5 — Doctor Reviews, Edits, And Approves Before Saving

Nothing reaches `approved` without an explicit doctor action.

**Acceptance Criteria**

- [ ] The approve action is a distinct, deliberate control — never a default state or a side effect of another action.
- [ ] Approval is blocked until the consultation is `awaiting_review` with an attached analysis.
- [ ] After approval, the note is read-only, copyable to the clipboard, and exportable as a PDF (or printable directly from the browser); no further edits are accepted.
- [ ] Approval writes an audit event recording the transition (see `docs/trd.md`, Audit Logging).

---

## Safety Constraints

Each item below is a requirement with a testable consequence, not a disclaimer:

- **Unknown is never recorded as negative.** Every symptom, allergy, medication, history item, vital sign, examination finding, and safety question must resolve to one of six explicit states — `PRESENT`, `DENIED`, `CLINICIAN_OBSERVED`, `NOT_ASSESSED`, `UNKNOWN`, `NOT_APPLICABLE` — and a field the transcript never touches must never be defaulted to `DENIED` or silently omitted. This half is absolute, with no exception: it carries the same weight as the red-flag and citation rules below, because a fabricated negative is more dangerous than a missing field — a later clinician may rule out a diagnosis on a finding nobody ever actually checked. An information gap (CAP-2) and a `NOT_ASSESSED` field are the same fact seen from two sides: every field the completeness check has no transcript evidence for must be represented as not-assessed rather than as a negative, and surfaced as a gap where `InformationGap.priority` judges it clinically material — `priority` carries the volume decision, never the safety half. **Testable today:** the gap-heavy fixture (CAP-2, Q5; see the Demo Script's Fixture content note) never mentions haemoptysis — any generated note, gap, or persisted field that asserts haemoptysis absent, rather than not-assessed, fails QA.
- **No diagnostic labelling.** No output field, label, or UI copy ever states or implies a diagnosis. QA can fail a build on any diagnostic phrasing found in generated content or static copy.
- **No autonomous action.** Every state transition past `draft` requires an explicit doctor-initiated action; none fires on a timer, on page load, or as a side effect.
- **Approval is a real state transition.** `approved` exists as a distinct `ConsultationStatus` value reachable only through the approve action — it is checkable in the database, not inferred from UI state.
- **Red flags are escalation prompts, not triage outcomes.** The UI never ranks or orders next clinical steps for the doctor; it presents evidence and lets the doctor decide.
- **Every output is editable before approval.** The SOAP note accepts edits; nothing the model produced is presented as final until the doctor approves it.
- **Citations let the doctor evaluate the source.** Every suggestion links to a real, inspectable guideline entry so the doctor is judging the source, not trusting the model's paraphrase.

---

## Regulatory & Data-Protection Positioning

This section states a design posture, **not a legal conclusion.** Final regulatory classification is a determination for qualified counsel, not this document.

- **Medical Device Act 737 / MDA (Malaysia).** The system is positioned to avoid medical-device classification by design: it does not diagnose, does not recommend treatment, and every clinical output requires doctor review and approval before it has any effect. Whether this positioning holds under a formal MDA assessment is outside this document's authority to state.
- **PDPA 2010 (Malaysia).** The de-identification gate (`backend/src/deid/`) is the primary control for processing patient-linked data outside the API boundary. Consultation transcripts are stored raw at rest inside the API's own database, not tokenised (Q9) — this is a deliberate design decision, defensible only in combination with encryption at rest, in-region hosting, and doctor-scoped access control (see `docs/trd.md`, Data Model and Security Controls).
- **Singapore hosting for Malaysian data.** Backend and database hosting sit in Singapore (Render, Supabase), while patient data originates in Malaysia. This is a cross-border transfer under PDPA 2010 and is stated here as a known design constraint requiring its own compliance review — not resolved by this document.
- **DeepSeek benchmarking provider (PRC).** `LLM_PROVIDER=deepseek` is available for benchmarking (`docs/README.md`) and is a second, distinct cross-border question — DeepSeek's API is hosted in the PRC. Unlike the Gemini free-tier path, `backend/src/config/env.ts` currently guards **only** `gemini` in production; there is no equivalent production guard for `deepseek`. This is recorded as an open gap, not a resolved control — see `docs/trd.md` §7 and §19 (row 9).
- **Retention, deletion, and DPIA.** The MVP stores synthetic transcripts indefinitely — no retention schedule and no deletion or access-request path exist (`docs/trd.md` §4). Both are prerequisites before any real patient data reaches this system, and a Data Protection Impact Assessment (DPIA) must precede any production deployment. The retention period itself is not yet decided — see `docs/trd.md` §19, row 11.

---

## Out Of Scope For The MVP

| Deferred Item                                  | Reason                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "Send to EMR" or any external write-back       | Presumed out by the brief; no EMR integration target exists                                     |
| Red-flag deletion or silent dismissal          | Flags may only be acknowledged, never removed (Q3) — a safety guarantee, not a deferred feature |
| Editing or re-analysis after `approved`        | `approved` is terminal by design (Q3)                                                           |
| Development timeline and team responsibilities | Belong to the proposal, not this document (Q12)                                                 |

Four items previously deferred here — transcript file upload, PDF/print export of the approved note, live audio capture with browser-side ASR, and open self-service sign-up — have moved into scope for this iteration; see Primary Flow, CAP-1, CAP-5, and the Demo Script, and `docs/trd.md` §20 for the ASR architecture.

---

## Known Limitations

- **English-only, and worse on audio.** Malaysian GP consultations frequently code-switch (Malay / Manglish / dialect); this prototype does not handle that (Q8). Browser-side Whisper transcription (`docs/trd.md` §20) inherits this limit and is expected to degrade further on Malaysian-accented English and code-switching than typed or pasted input does — it has not been benchmarked against local speech.
- **First-use ASR download cost.** The client-side Whisper model is not free to obtain: the first use of live audio capture on a given device adds a download (latency and bandwidth) before transcription can run, on top of the accuracy limitation above.
- **No server-side ASR fallback.** Transcription cannot run on the API server as a fallback or alternative — Render's free tier (512 MB, no GPU) cannot host a local Whisper instance, so browser-side transcription (`docs/trd.md` §20) is the only supported path, not one option among several.
- **Narrow clinical scope.** Validated only for adult acute cough, sore throat, and other upper respiratory presentations — not for any other presentation.
- **Scope grew late against a short runway.** Transcript upload, PDF export, live audio/ASR, and open sign-up were added to the MVP after the original scope was drafted. They are not equally mature: audio/ASR in particular carries the open questions in `docs/trd.md` §19 (rows 8, 13) and has no benchmark evidence yet. Treat the newly in-scope items as a delivery risk, not a settled capability set.
- **No clinician sign-off.** The red-flag trigger list and the guideline corpus are drawn from published sources and cited, but no clinician has reviewed or signed off on them (Q7).
- **Small guideline corpus.** 10–15 chunks is not exhaustive coverage of upper-respiratory guidance; specific source selection and redistribution licensing are still pending confirmation (Q6).
- **De-identification recall is best-effort, not guaranteed.** The detectors in `backend/src/deid/` are pattern-based and may miss an identifier; this is stated plainly, not softened, and is why raw transcripts are still treated as sensitive at rest.
- **LLM output is non-deterministic.** The same transcript may produce different note wording, gap phrasing, or suggestion text across runs, even with a low sampling temperature.
- **Synthetic data only.** No real-world clinical validation of note quality, gap relevance, or suggestion accuracy has been performed.
- **Free-tier hosting constraints.** Both Render (backend) and Supabase (database) stay on free tiers by design (`docs/trd.md` §17): Render free instances spin down when idle and Supabase free-tier projects auto-pause after roughly a week idle. Evaluation happens after submission, so a sleeping demo on first access is a real failure mode; a keep-alive mechanism is needed and not yet chosen — see `docs/trd.md` §19, row 14. The Gemini free tier's terms permit use for product improvement and is restricted to local development on synthetic data only.
- **Alert-fatigue risk is unmeasured.** Red-flag severity (`emergency` / `urgent` / `advisory`) and the acknowledge-not-remove workflow (Safety Constraints) bound how a flag is presented, but the MVP does not track acknowledgment/dismissal rates or otherwise measure whether the volume of surfaced flags and gaps causes a doctor to disengage — deferred to Future Production Metrics, below.

---

## Success Metrics

### MVP Success

The MVP is judged against the Demo Script (below) and CAP-1 … CAP-5's acceptance criteria — not a separate metric set. A metric restated outside those acceptance criteria risks drifting out of sync with them.

### Future Production Metrics

Deferred to a production deployment, once real usage exists to measure against:

- time spent documenting per consultation,
- same-day note completion rate,
- clinician edit rate on generated notes,
- clinician acceptance/dismissal rate for gaps, red flags, and suggestions,
- false-alert rate and any missed predefined safety event,
- system latency against the CAP-1 target,
- privacy/security incident count.

---

## Demo Script

An ordered walkthrough an evaluator can follow end to end, exercising all five capabilities:

1. **Log in** as a seeded doctor account, or **sign up** for a new account (self-service sign-up, Q2).
2. **View the consultation list**, scoped to the logged-in doctor.
3. **Start a new consultation** and pick a bundled fixture, paste transcript text, upload a transcript file, or capture a short audio sample transcribed in-browser (Primary Flow step 1).
4. **Trigger analysis** and observe the status move to `analyzing`, then `awaiting_review`.
5. **Review the SOAP note** — CAP-1.
6. **Review the information gaps** and their rationale — CAP-2.
7. **Review the red flags**, noting the rule-sourced flag is visually distinct from any model-added candidate — CAP-3.
8. **Review the clinical suggestions**, opening a citation to see the underlying guideline entry — CAP-4.
9. **Edit a field of the SOAP note** and **acknowledge a red flag** without removing it.
10. **Approve the consultation** — CAP-5 — and confirm the read-only finalised view, copy-to-clipboard, and PDF/print export are available, and that no further edits are possible.
11. **Log out and log in as the second seeded doctor**; confirm the first doctor's consultation does not appear — ownership isolation (Q2).

**Fixture content note.** The gap-heavy fixture (step 6) should read like an incomplete adult URTI presentation — e.g. cough, sore throat, and fever established, but haemoptysis, chest pain, SpO₂, and respiratory rate never asked about — so the missing-information panel has genuine gaps to surface. The hard-red-flag fixture (step 7) should contain evidence for at least one deterministic rule trigger, so the rule-sourced flag fires reproducibly. This grounds the Q5 fixture references above; it does not add steps to the walkthrough.

---

## Proposal Source Map

The ten sections required by the external proposal, mapped to where each is drafted from. Two are marked **Proposal-Only** — they carry commercial framing (staffing, schedule) that must never enter a tracked file (Q12); they are drafted directly in the proposal document, outside this repo.

| #   | Proposal Section                                                 | Source                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Understanding of the problem and proposed MVP                    | `docs/prd.md` — Problem & Context, Who It Is For, Goals, Explicit Non-Goals, Clinical Scope, Primary Flow, CAP-1 … CAP-5. `docs/README.md`'s top summary and capability table give the one-paragraph version.                                                                                                                                        |
| 2   | Team members and responsibilities                                | **Proposal-Only.** No source in this repo (Q12).                                                                                                                                                                                                                                                                                                     |
| 3   | Development timeline                                             | **Proposal-Only.** No source in this repo (Q12).                                                                                                                                                                                                                                                                                                     |
| 4   | Technology stack and programming languages                       | `docs/README.md` — Stack section (runtime, frameworks, hosting one-liner). `docs/trd.md` §2 (System Context & Component Responsibilities) for the per-module detail a technical reviewer would want.                                                                                                                                                 |
| 5   | Hosting approach                                                 | `docs/trd.md` §17 (Environments & Deployment) — topology, pooled-versus-direct URL split, migration flow, CI, free-tier mitigation. `docs/prd.md` Regulatory & Data-Protection Positioning for the Singapore-hosting-for-Malaysian-data framing.                                                                                                     |
| 6   | Cybersecurity controls                                           | `docs/trd.md` §16 (Security Controls), §5 (PHI Boundary — Type-Level Contract), §14 (Auth Model).                                                                                                                                                                                                                                                    |
| 7   | PDPA compliance approach                                         | `docs/prd.md` Regulatory & Data-Protection Positioning, including the retention/deletion/DPIA bullet. `docs/trd.md` §4 (Data Model — no retention or deletion path today), §9 (De-Identification Pipeline), §15 (Audit Logging), §16 (Security Controls) for the mechanisms that back the positioning, and §19 row 11 for the open retention period. |
| 8   | How patient data will be prevented from being exposed to the LLM | `docs/README.md` — The PHI Boundary section and diagram, for the narrative, including the audio path. `docs/trd.md` §5 (type-level contract), §6 (LLM Port & Adapter), §9 (De-Identification Pipeline), §20 (Browser-Side ASR Contract) for contract-level depth.                                                                                    |
| 9   | Key technical risks and limitations                              | `docs/prd.md` Known Limitations. `docs/trd.md` §19 (Open Decisions Register) for the specific unresolved engineering questions, including the two recorded enforcement gaps (§5 `markDeidentified` export, §7 `DEID_FAIL_CLOSED` not read at egress) and §11's licensing question.                                                                   |
| 10  | Clear MVP deliverables and acceptance criteria                   | `docs/prd.md` CAP-1 … CAP-5 (acceptance criteria), Out Of Scope For The MVP, Demo Script.                                                                                                                                                                                                                                                            |
