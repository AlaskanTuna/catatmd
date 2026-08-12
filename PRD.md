# AI Clinical Assistant — Product Requirements Document (PRD)

**Status:** MVP / Selection Prototype  
**Product:** AI Clinical Assistant  
**Repository:** `AlaskanTuna/ai-clinical-assistant`  
**Primary market:** Malaysian GP / primary-care clinics  
**Initial clinical scope:** Adult acute cough, sore throat, and upper-respiratory symptoms  
**MVP constraint:** Simulated consultation data only  
**Core principle:** **LLM for language. Rules for safety. Guidelines for evidence. Doctor for decisions.**

---

## 1. Executive Summary

The AI Clinical Assistant is a clinician-in-the-loop documentation and safety copilot for short GP consultations.

The product listens to or receives a simulated doctor–patient consultation, converts it into structured clinical facts, drafts a clinical note, identifies clinically important information that was not assessed, detects predefined red flags, and surfaces Malaysian medical guidance with citations.

The system must never silently convert missing information into a negative finding. If a symptom, vital sign, examination finding, medication history, or allergy was not discussed, it remains explicitly marked as **Unknown / Not Assessed**.

The assistant is not intended to diagnose patients or replace clinical judgement. The clinician remains responsible for all clinical decisions and must review, edit, and approve generated output before it can be saved.

The MVP should feel like a focused clinical workflow tool, not a general chatbot.

---

## 2. Product Vision

### Vision

Build a quiet second pair of eyes for GP consultations that:

1. reduces documentation burden,
2. improves clinical completeness,
3. helps clinicians notice potentially important omissions,
4. supports review with trusted local medical references,
5. provides traceability for every AI-generated claim,
6. preserves clinician control.

### Positioning

Most AI scribes answer:

> **What happened during the consultation?**

This product should also answer:

> **What was not assessed?**  
> **Is there anything potentially concerning?**  
> **What does the local evidence say?**  
> **Where did this information come from?**

### Product thesis

**Ambient documentation is the entry point. Clinical completeness and safety are the differentiator.**

---

## 3. Problem Statement

GP consultations are short. A doctor must simultaneously:

- listen to the patient,
- ask the right questions,
- assess symptoms,
- examine the patient,
- consider red flags,
- decide on management,
- explain the plan,
- document the encounter.

This creates several practical risks:

- documentation is delayed or incomplete,
- clinically relevant questions may not be asked,
- missing information may be incorrectly represented as normal or negative,
- red flags may be buried in a long conversation,
- doctors may spend additional time completing notes after consultations,
- generic AI-generated notes may hallucinate unsupported clinical findings,
- clinical suggestions may be difficult to trust if they lack evidence,
- patient data may be unnecessarily exposed to external AI systems.

The project therefore needs more than transcription. It needs a safe clinical workflow.

---

## 4. Target Users

### Primary persona: General Practitioner

**Needs**
- document consultations quickly,
- avoid retyping the conversation,
- see important gaps before ending the consultation,
- verify where AI-generated information came from,
- edit the note easily,
- remain in control of decisions.

**Pain points**
- time pressure,
- repetitive documentation,
- missing structured information,
- concern about AI hallucination,
- alert fatigue,
- privacy concerns,
- switching between references and clinical systems.

### Secondary persona: Clinic owner / medical director

**Needs**
- safer and more consistent documentation,
- auditability,
- privacy-by-design,
- clear clinician accountability,
- measurable workflow improvement,
- controlled deployment risk.

---

## 5. MVP Scope

### In scope

The MVP supports **adult GP consultations involving:**

- acute cough,
- sore throat,
- common upper-respiratory symptoms.

The MVP must support:

1. simulated consultation input,
2. transcript processing,
3. structured clinical fact extraction,
4. editable clinical note generation,
5. missing-information detection,
6. predefined red-flag detection,
7. local guideline citations,
8. evidence/provenance trace,
9. clinician review and approval,
10. audit metadata,
11. privacy boundary demonstration.

### Out of scope

The MVP will **not**:

- autonomously diagnose patients,
- autonomously prescribe medication,
- replace clinical judgement,
- support every medical specialty,
- connect to a production EHR,
- process real patient data,
- provide autonomous triage,
- automatically submit insurance claims,
- perform billing/coding automation,
- make irreversible clinical decisions.

---

## 6. Core User Flow

### Step 1 — Start consultation

Doctor creates a simulated consultation.

Options:

- load a predefined synthetic case,
- paste a simulated transcript,
- upload simulated audio,
- optionally record a simulated doctor–patient conversation.

The UI displays:

> `AI Assistant active`

The assistant should require minimal interaction during the consultation.

---

### Step 2 — Convert conversation into structured evidence

The transcript is converted into structured facts before a note is generated.

Each fact should contain:

- field,
- status,
- value,
- source speaker,
- source text,
- timestamp when available,
- confidence,
- provenance type.

Example:

```json
{
  "symptoms": {
    "cough": {
      "status": "present",
      "duration": "3 days",
      "evidence": "I've been coughing for about three days",
      "speaker": "patient"
    },
    "dyspnoea": {
      "status": "denied",
      "evidence": "No, my breathing is okay",
      "speaker": "patient"
    },
    "haemoptysis": {
      "status": "unknown",
      "evidence": null
    }
  }
}
```

---

### Step 3 — Generate clinical note

Generate an editable clinical note from structured evidence.

Recommended note styles:

- Concise GP,
- SOAP,
- Detailed.

The generated note must not invent facts that are absent from the structured evidence.

---

### Step 4 — Run clinical completeness check

The system evaluates whether important predefined information is:

- Present,
- Patient Denied,
- Clinician Observed,
- Not Assessed,
- Unknown.

Example:

**Recorded**
- cough x3 days,
- fever yesterday,
- dyspnoea denied.

**Not assessed**
- haemoptysis,
- chest pain,
- oxygen saturation,
- respiratory rate.

---

### Step 5 — Run safety rules

Safety-critical checks must be deterministic and rule-based wherever practical.

The LLM may extract facts, but should not be the sole authority deciding whether a predefined red flag exists.

Suggested severity:

- **Red:** urgent clinician review,
- **Amber:** clarification recommended,
- **Information:** guideline support only.

Each warning must show:

1. what triggered it,
2. why it matters,
3. the supporting evidence,
4. the relevant guideline when applicable,
5. available clinician actions.

Example:

> **Amber — SpO₂ not documented**  
> Acute respiratory symptoms are documented, but no oxygen saturation value was detected.  
> **Actions:** Add result · Not clinically required · Dismiss

---

### Step 6 — Surface local clinical evidence

The assistant should retrieve from a small curated knowledge base containing relevant Malaysian sources.

For MVP, prioritize:

- Malaysian Ministry of Health National Antimicrobial Guideline,
- relevant respiratory / URTI sections,
- sore-throat / pharyngitis guidance,
- clinician-approved project references.

Each clinical suggestion should show:

- source organization,
- guideline title,
- section,
- version/date,
- link or citation identifier.

The UI must not display unsupported phrases such as:

> “According to medical knowledge…”

---

### Step 7 — Evidence Trace

Clinicians must be able to verify AI-generated content.

Example:

> **Generated note:** “Patient denies shortness of breath.”

Clicking the statement shows:

> **Source:** Patient, 00:42  
> “No, breathing is fine.”

If no evidence exists:

> **No supporting evidence detected.**

This feature is critical for:

- hallucination detection,
- clinician trust,
- auditability,
- review speed.

---

### Step 8 — Review, edit, approve

The doctor can:

- edit generated notes,
- add missing information,
- accept or reject suggestions,
- dismiss warnings,
- mark items as not clinically applicable,
- review evidence,
- approve the final note.

Saving must require clinician approval.

---

## 7. Clinical Information Schema

The initial respiratory schema should include at minimum:

### Presenting symptoms

- cough,
- cough duration,
- productive/non-productive cough,
- sputum characteristics,
- haemoptysis,
- sore throat,
- fever,
- dyspnoea,
- chest pain,
- swallowing difficulty,
- oral intake,
- symptom onset,
- symptom progression.

### Relevant history

- asthma,
- COPD,
- cardiac disease,
- immunosuppression,
- smoking,
- relevant recent infection exposure,
- current medications,
- drug allergies.

### Observations

- temperature,
- heart rate,
- respiratory rate,
- blood pressure,
- SpO₂.

### Examination

- throat findings,
- tonsillar findings,
- cervical lymph-node findings,
- chest findings.

### Clinical support

- relevant sore-throat scoring components,
- predefined escalation triggers,
- guideline eligibility.

---

## 8. Key Product Rule: Unknown ≠ Negative

This is a non-negotiable system requirement.

If the patient was not asked about haemoptysis:

```text
haemoptysis = unknown
```

The system must never convert that into:

```text
haemoptysis = denied
```

Allowed states should be explicit:

```text
PRESENT
DENIED
CLINICIAN_OBSERVED
NOT_ASSESSED
UNKNOWN
NOT_APPLICABLE
```

This rule applies to:

- symptoms,
- allergies,
- medications,
- medical history,
- vital signs,
- examination findings,
- safety questions.

---

## 9. Functional Requirements

### FR-01 Consultation input

The user can:

- load synthetic case,
- paste transcript,
- optionally upload or record synthetic audio.

**Acceptance criteria**
- transcript appears in the consultation UI,
- no real patient data is required for MVP.

---

### FR-02 Structured extraction

The system converts transcript content into validated structured JSON.

**Acceptance criteria**
- output follows schema,
- unsupported fields remain unknown,
- evidence text is stored for extracted facts.

---

### FR-03 Clinical note generation

The system generates a note from structured facts.

**Acceptance criteria**
- note is editable,
- note style can be changed,
- no unsupported fact is deliberately inserted,
- unknown fields are not silently normalized.

---

### FR-04 Completeness detection

The system compares extracted facts against the respiratory consultation checklist.

**Acceptance criteria**
- missing predefined fields are surfaced,
- status distinguishes unknown from denied,
- user can update missing items.

---

### FR-05 Red-flag engine

Implement deterministic clinical safety rules.

**Acceptance criteria**
- predefined test cases trigger expected rules,
- rule ID and reason are displayed,
- rules can be versioned.

---

### FR-06 Guideline retrieval

Retrieve relevant content from curated sources.

**Acceptance criteria**
- every clinical recommendation contains a citation,
- sources are versioned,
- ungrounded recommendations are blocked from the clinical evidence panel.

---

### FR-07 Evidence provenance

Generated facts and note content must map back to source evidence where possible.

**Acceptance criteria**
- clinician can inspect source text,
- timestamp is shown where available,
- unsupported generated claims can be identified.

---

### FR-08 Clinician review

Clinician can:

- edit,
- accept,
- reject,
- dismiss,
- mark not applicable,
- approve.

**Acceptance criteria**
- save is disabled until required review state is satisfied,
- final output reflects clinician edits.

---

### FR-09 Audit log

Record:

- model version,
- prompt/workflow version,
- guideline version,
- rule-set version,
- generated output,
- clinician edits,
- approval status,
- timestamps.

---

### FR-10 Privacy gateway

Before an external LLM call, the architecture must demonstrate how identifiers are detected and removed or tokenized.

**Acceptance criteria**
- synthetic direct identifiers are caught in test cases,
- privacy transformation occurs before the external LLM boundary,
- original-to-token mapping is isolated from the LLM service.

---

## 10. Non-Functional Requirements

### Security

- encrypted transport,
- encrypted storage where persistence is enabled,
- authentication,
- role-based access control,
- least-privilege access,
- secrets stored outside source code,
- audit logging,
- secure error handling,
- no PHI in application logs,
- no PHI in analytics payloads.

### Reliability

- schema-validated LLM output,
- deterministic fallback if parsing fails,
- user-visible error state,
- no silent loss of transcript data,
- idempotent approval/save behavior.

### Performance

Target for MVP:

- structured extraction: < 10 seconds for a short transcript,
- note generation: < 10 seconds,
- safety analysis: near-immediate after structured extraction,
- responsive clinician UI.

These are engineering goals rather than clinical benchmarks.

### Explainability

Every meaningful AI-supported clinical statement should expose either:

- transcript evidence,
- deterministic rule rationale,
- guideline citation,
- or an explicit “unsupported / unknown” status.

---

## 11. Privacy and PDPA Approach

The product must be designed around data minimization.

### MVP

Use synthetic data only.

### Production architecture principle

```text
Doctor + Patient
      ↓
Consent / permitted processing
      ↓
Audio / Transcript
      ↓
Trusted Clinic Boundary
      ↓
PII / PHI Privacy Gateway
      ↓
Tokenized / minimized representation
      ↓
LLM processing
      ↓
Structured output
      ↓
Safety rules + guideline retrieval
      ↓
Clinician review
      ↓
Approved clinical record
```

### Privacy requirements

- do not assume removing a name fully anonymizes health information,
- minimize data sent to any external service,
- do not train project models on patient data by default,
- do not expose identifiers in prompts,
- separate identity mapping from external LLM processing,
- document data retention,
- support deletion and access controls,
- maintain a clear audit trail,
- perform a DPIA before real production deployment.

If production requirements prohibit any patient clinical information from reaching an external model, use a private/self-hosted model or an approved private inference environment.

---

## 12. AI Architecture

Recommended pipeline:

```text
Consultation
    ↓
Speech-to-text / Transcript
    ↓
Privacy Gateway
    ↓
Structured Clinical Extraction
    ↓
Schema Validation
    ↓
┌───────────────────────────────┐
│                               │
↓                               ↓
Clinical Note             Safety / Completeness
Generator                 Rules Engine
│                               │
└──────────────┬────────────────┘
               ↓
        Guideline Retrieval
               ↓
        Evidence / Provenance
               ↓
         Clinician Review
               ↓
          Approve & Save
```

### Architectural principles

1. **LLM for language**
   - transcript understanding,
   - structured extraction,
   - note drafting.

2. **Rules for safety**
   - predefined escalation logic,
   - missing-field logic,
   - deterministic thresholds.

3. **Guidelines for evidence**
   - curated Malaysian medical sources,
   - versioned retrieval.

4. **Doctor for decisions**
   - mandatory clinician review,
   - no autonomous diagnosis or prescribing.

---

## 13. Suggested Technical Stack

This PRD does not require a specific implementation, but a suitable stack is:

### Frontend
- Next.js,
- TypeScript,
- Tailwind CSS,
- shadcn/ui.

### Backend
- FastAPI,
- Python,
- Pydantic schema validation.

### Database
- PostgreSQL,
- Prisma or SQLAlchemy depending on service ownership.

### AI
- LLM with structured output support,
- speech-to-text model for simulated audio,
- deterministic rules implemented in application code,
- small curated RAG corpus.

### Infrastructure
- containerized deployment,
- environment-based secret management,
- separate frontend/backend services if already supported by repository structure.

---

## 14. UX Requirements

### Main consultation screen

Recommended three-panel layout:

#### Left — Consultation
- live or uploaded transcript,
- speaker labels,
- timestamps.

#### Centre — Clinical Note
- editable generated note,
- sections,
- evidence-linked sentences.

#### Right — Clinical Safety
- red flags,
- missing information,
- clinical considerations,
- citations.

### Design principles

- no chatbot-first interface,
- minimal interruption,
- warnings prioritized by severity,
- clear distinction between AI suggestion and clinician-approved content,
- one-click evidence review,
- fast editing,
- no large blocks of generated prose where concise clinical UI is better.

---

## 15. MVP Demo Scenarios

### Scenario A — Incomplete URTI consultation

Patient:
- cough x3 days,
- sore throat,
- fever yesterday,
- breathing described as okay.

Missing:
- haemoptysis,
- chest pain,
- SpO₂,
- respiratory rate,
- selected sore-throat assessment fields.

Expected demo:

1. AI generates a concise clinical note.
2. Known information is documented.
3. Missing fields remain unknown.
4. Completeness panel surfaces gaps.
5. guideline panel shows relevant Malaysian source.
6. clinician adds missing information.
7. note updates.
8. clinician approves.

---

### Scenario B — Safety-trigger consultation

Synthetic transcript contains one or more predefined concerning findings.

Expected demo:

1. structured extraction identifies the evidence,
2. deterministic rule fires,
3. red warning is displayed,
4. source transcript is linked,
5. relevant guideline is shown,
6. system says clinician review is required,
7. system does not autonomously diagnose.

---

## 16. Acceptance Criteria

The MVP should target:

| Test | MVP target |
|---|---:|
| Unsupported facts silently inserted into synthetic test notes | 0 |
| Unknown predefined information represented as unknown | 100% |
| Predefined critical deterministic safety rules detected in test suite | 100% |
| Missing-information detection recall on reviewed synthetic cases | ≥90% |
| Clinical suggestions without source citation | 0 |
| Synthetic direct identifiers passed through privacy gate unchanged | 0 |
| Generated note editable before save | Yes |
| Final save requires clinician approval | Yes |
| Generated content contains provenance metadata | Yes |
| Guideline sources are versioned | Yes |

These are proposed engineering acceptance criteria, not validated clinical-performance claims.

---

## 17. Success Metrics

### MVP success

- complete end-to-end demo works reliably,
- clinician can understand the system without explanation,
- synthetic consultations produce useful structured notes,
- no unsupported negative findings,
- missing clinical information is visible,
- red flags are explainable,
- every clinical suggestion is cited,
- approval workflow is clear.

### Future production metrics

- time spent documenting,
- same-day note completion,
- clinician edit rate,
- clinician acceptance/dismissal rate for suggestions,
- false-alert rate,
- missed predefined safety events,
- note completeness,
- clinician satisfaction,
- system latency,
- privacy/security incidents.

---

## 18. Risks and Mitigations

### Risk: LLM hallucination

**Mitigation**
- structured evidence first,
- schema validation,
- provenance links,
- mandatory clinician review.

### Risk: Missing information becomes false negative

**Mitigation**
- explicit clinical-state enum,
- Unknown ≠ Negative rule,
- unit tests.

### Risk: Alert fatigue

**Mitigation**
- severity hierarchy,
- limit alerts to scoped clinical rules,
- allow dismiss / not applicable,
- measure dismissal rate.

### Risk: Incorrect guideline retrieval

**Mitigation**
- small curated source corpus,
- versioned documents,
- citation required,
- no open-web generation for clinical recommendations.

### Risk: privacy leakage

**Mitigation**
- synthetic data for MVP,
- privacy gateway,
- data minimization,
- no PHI in logs,
- private inference option for production.

### Risk: user over-reliance on AI

**Mitigation**
- clinician approval,
- clear assistive positioning,
- evidence display,
- no autonomous diagnosis/prescribing.

### Risk: regulatory scope creep

**Mitigation**
- keep intended use assistive,
- document intended use,
- seek regulatory review before real clinical rollout.

---

## 19. Development Plan

### Selection MVP

#### Phase 1 — Foundation
- clinician UI,
- synthetic cases,
- structured schema,
- transcript ingestion.

#### Phase 2 — AI documentation
- structured extraction,
- note generation,
- evidence mapping.

#### Phase 3 — Safety layer
- Unknown ≠ Negative,
- missing-information engine,
- deterministic red flags.

#### Phase 4 — Clinical evidence
- curated Malaysian guideline corpus,
- RAG retrieval,
- citations.

#### Phase 5 — Review and polish
- edit / dismiss / approve,
- audit metadata,
- test scenarios,
- demo polish.

---

## 20. Proposed GitHub Backlog

### P0 — Selection MVP

1. **[MVP] Build simulated doctor–patient consultation workflow**
2. **[AI] Extract structured clinical facts from consultation transcript**
3. **[Safety] Enforce Unknown ≠ Negative for undocumented findings**
4. **[AI] Generate editable SOAP/GP clinical notes with evidence provenance**
5. **[Safety] Build missing clinical information detection engine**
6. **[Safety] Implement deterministic respiratory red-flag rules**
7. **[Clinical] Add Malaysian MOH guideline retrieval with citations**
8. **[Privacy] Build PHI/PII detection and LLM privacy gateway**
9. **[UX] Build clinician review, edit, dismiss, and approve workflow**
10. **[Demo] Create synthetic URTI / cough / sore-throat scenarios**

### P1 — Production-shaped MVP

11. **[Audit] Record AI output, clinician edits, approvals, model and rule versions**
12. **[QA] Build clinical safety acceptance test suite**
13. **[Security] Add authentication, RBAC, and secure data handling**
14. **[Observability] Add privacy-safe logs, tracing, and error monitoring**
15. **[Clinical] Add clinician-configurable checklist and rule versions**

### P2 — Post-selection

16. **[Integration] Define clinic/EHR integration interface**
17. **[Clinical Validation] Run clinician-reviewed synthetic test set**
18. **[Privacy] Complete DPIA and production data-flow review**
19. **[Performance] Measure documentation time saved**
20. **[Product] Add specialty-specific workflow configuration**

---

## 21. Definition of Done for Selection MVP

The MVP is complete when a reviewer can:

1. open a synthetic adult URTI consultation,
2. view or simulate the doctor–patient conversation,
3. generate a structured clinical note,
4. inspect evidence behind generated facts,
5. see missing clinical information,
6. see a deterministic safety alert when a predefined trigger is present,
7. view a cited Malaysian medical reference,
8. edit the generated output,
9. approve the final note,
10. observe that sensitive identifiers are handled before the external LLM boundary,
11. complete the workflow without the system making an autonomous diagnosis.

---

## 22. Product Principles

1. **Unknown is not negative.**
2. **The AI should interrupt only when useful.**
3. **Every clinical claim should be traceable.**
4. **Safety rules should be deterministic where possible.**
5. **Clinical suggestions require evidence.**
6. **Use local Malaysian guidance first.**
7. **The clinician makes the final decision.**
8. **Privacy is an architectural boundary, not a disclaimer.**
9. **Start narrow and validate deeply.**
10. **The product should feel like clinical software, not ChatGPT with a medical skin.**

---

## 23. One-Sentence Product Pitch

> **An AI clinical safety copilot that documents GP consultations, identifies what may have been missed, surfaces predefined safety signals, and grounds suggestions in Malaysian clinical guidance — while keeping the doctor fully in control.**
