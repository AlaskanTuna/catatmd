# UAT Review Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement each owned task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely extract the worthwhile UAT changes from PR #273 and make consultation hero actions visually and behaviorally consistent.

**Architecture:** Two isolated worker branches start from `origin/main`. The backend branch owns model-output and CatatAI corpus safeguards; the review-UI branch owns question copy, checklist grouping and hero controls. Their commits are cherry-picked into one integration branch and verified together.

**Tech Stack:** TypeScript 5.9, Zod, Express 5, React 19, Tailwind 4, Vitest, Testing Library

## Global Constraints

- No diagnostic differentiation or clinical calculator implementation; issues #226 and #221 remain open.
- No raw transcript, note, citation quote or suppressed prose may enter logs or audit metadata.
- Every LLM egress remains behind `deid/` and `LLMClient`; citation IDs remain constrained to the active profile corpus.
- Deterministic red flags remain unchanged and unsuppressable.
- UI changes follow `docs/DESIGN.md`; no nested interactive elements.
- Preserve the current SOAP/Malaysian note switcher, consultation settings, capture modes and template-aware copy/print behavior from #272.

---

### Task 1: Profile-Scoped CatatAI And Suggestion Safety Guard

**Files:**

- Modify: `backend/src/analysis/diagnostic-guard.ts`
- Modify: `backend/src/copilot/index.ts`
- Modify: `backend/src/copilot/index.test.ts`
- Modify: `backend/src/suggestions/index.ts`
- Modify: `backend/src/suggestions/index.test.ts`
- Create: `backend/src/suggestions/safety.ts`
- Create: `backend/src/suggestions/safety.test.ts`
- Modify: `backend/src/routes/consultations.ts`
- Modify: `backend/src/routes/consultations.test.ts`

**Interfaces:**

- Consumes: `ConsultationDetail.analysis?.profileId`, `DEFAULT_PROFILE_ID`, `getClinicalProfile()`, `containsDiagnosticProse()` and decoded `ClinicalSuggestion[]`.
- Produces: `filterUnsafeModelSuggestions(suggestions): { suggestions: ClinicalSuggestion[]; suppressedSuggestionIds: string[] }` and audit metadata containing only `suppressedSuggestionIds`.

- [ ] **Step 1: Write failing profile-scope and suggestion-safety tests**

  Add a CatatAI test whose UTI analysis includes `moh-nag-2024-acute-uti-scope` and excludes URTI-only IDs. Add pure guard cases for safe considerations, diagnostic conclusions, directive medication orders, bare dose regimens and unsafe citation quotes. Add a route assertion that suppression audit metadata contains IDs only.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

  Run: `bunx vitest run backend/src/copilot/index.test.ts backend/src/suggestions/index.test.ts backend/src/suggestions/safety.test.ts backend/src/routes/consultations.test.ts`

  Expected: new assertions fail because CatatAI still uses the global corpus and no post-decode suggestion guard or suppression metadata exists.

- [ ] **Step 3: Implement the pure guard and profile lookup**

  Export `containsDiagnosticProse`. In `safety.ts`, inspect `suggestion.text` plus every defined `citation.quote`; suppress diagnostic language and text that autonomously orders, prescribes, starts or gives medication, including a bare numeric dose regimen. Return safe suggestions in original order and suppressed IDs only. Resolve CatatAI's profile from the persisted analysis, falling back to `DEFAULT_PROFILE_ID`.

- [ ] **Step 4: Apply and audit the guard**

  Filter only model suggestions after schema validation. Carry `suppressedSuggestionIds` through `runAnalysis()` and include it in `consultation.analysis_completed` metadata without recording rejected text.

- [ ] **Step 5: Re-run focused tests**

  Run: `bunx vitest run backend/src/copilot/index.test.ts backend/src/suggestions/index.test.ts backend/src/suggestions/safety.test.ts backend/src/routes/consultations.test.ts`

  Expected: all focused tests pass with no warnings.

- [ ] **Step 6: Verify and commit the owned branch**

  Run: `bun run lint && bun run typecheck && bun run test`

  Commit: `fix(llm): scope guidance and filter unsafe suggestions`

---

### Task 2: GP Questions And Canonical Checklist Grouping

**Files:**

- Modify: `backend/src/gaps/checklist.ts`
- Modify: `backend/src/gaps/derive.test.ts`
- Modify: `frontend/src/review/ChecklistPanel.tsx`
- Modify: `frontend/src/review/ChecklistPanel.test.tsx`

**Interfaces:**

- Consumes: the existing fixed `ClinicalFacts` and `OperationalBlock` objects and canonical Malaysian projection labels from `shared/src/note-templates.ts`.
- Produces: `gap-checklist-v4` neutral next-question strings and a checklist view grouped as Presenting Complaint, History of Presenting Complaint, Past Medical History, Social History, Family History, Objective, Assessment and Plan. Empty groups are omitted.

- [ ] **Step 1: Write failing gap and grouping tests**

  Replace the old “record does not” expectation with question-form assertions that remain non-accusatory and non-diagnostic. Add UI expectations that cough/sore throat render under Presenting Complaint, remaining symptoms under History of Presenting Complaint, clinical history under Past Medical History/Social History, observations and examination under Objective, diagnosis under Assessment, and medications/MC/referral/follow-up under Plan.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

  Run: `bunx vitest run backend/src/gaps/derive.test.ts frontend/src/review/ChecklistPanel.test.tsx`

  Expected: wording tests fail on declarative copy and grouping tests fail on the current internal Symptoms/History/Observations/Examination headings.

- [ ] **Step 3: Implement neutral questions and canonical grouping**

  Port the medically equivalent question wording from PR #273 while retaining current provenance, priorities, profiles and selectors. Bump the version to `gap-checklist-v4` with effective date `2026-09-08`. Derive checklist display groups locally from field IDs; do not add a second persisted record-section schema and do not render empty Family History.

- [ ] **Step 4: Re-run focused tests**

  Run: `bunx vitest run backend/src/gaps/derive.test.ts backend/src/gaps/checklist.test.ts frontend/src/review/ChecklistPanel.test.tsx`

  Expected: all focused tests pass with question wording and canonical group headings.

---

### Task 3: Consultation Hero Action Consistency

**Files:**

- Modify: `frontend/src/routes/ConsultationReview.tsx`
- Modify: `frontend/src/routes/ConsultationReview.test.tsx`
- Modify: `frontend/src/review/ApproveBar.tsx`
- Modify: `frontend/src/review/ApproveBar.test.tsx`
- Modify: `frontend/src/ui/InfoTip.tsx` only if a narrow styling prop is required

**Interfaces:**

- Consumes: existing `Button`, `InfoTip`, consultation states and approval confirmation flow.
- Produces: a visually internal but DOM-sibling tooltip trigger for contextual hero information; all persistent hero actions use `size="lg"`.

- [ ] **Step 1: Write failing draft, awaiting-review and approved-state tests**

  Assert Copy Note and Export emit the same `h-12` size class as Consultation Settings. Assert the contextual tooltip trigger shares the CTA's visual wrapper in draft and awaiting-review states, opens its existing explanatory content, and is absent when there is nothing to explain.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

  Run: `bunx vitest run frontend/src/routes/ConsultationReview.test.tsx frontend/src/review/ApproveBar.test.tsx`

  Expected: size and wrapper assertions fail against the current sibling layout.

- [ ] **Step 3: Implement the accessible compound action**

  Use a relative inline wrapper, reserve trailing space in the large action button, and position the independently focusable `InfoTip` trigger inside the visible CTA boundary. Do not nest a button inside another button. Preserve disabled/loading behavior, two-step approval, unacknowledged warning content and error rendering. Set Copy Note and Export to `size="lg"`.

- [ ] **Step 4: Re-run focused tests and frontend diagnostics**

  Run: `bunx vitest run frontend/src/routes/ConsultationReview.test.tsx frontend/src/review/ApproveBar.test.tsx frontend/src/review/ChecklistPanel.test.tsx`

  Run: `npx react-doctor@latest --verbose --diff`

  Run: `npx impeccable detect`

  Expected: tests pass, React Doctor score does not regress, and no new Impeccable finding remains.

- [ ] **Step 5: Verify and commit the owned branch**

  Run: `bun run lint && bun run typecheck && bun run test`

  Commit: `fix(ui): refine consultation review guidance`

---

### Task 4: Integrate, Review And Ship

**Files:**

- Modify: this plan's checkbox state only if required by the worker workflow
- GitHub: PR #273, issues #223, #280 and #281, replacement PR

**Interfaces:**

- Consumes: the two reviewed worker commits.
- Produces: one replacement PR against `main`, a referenced review comment on #273, and a squash merge after all required checks are green.

- [ ] **Step 1: Cherry-pick both worker commits into `feat/uat-review-improvements`**

- [ ] **Step 2: Run branch-wide review and verification**

  Run: `bun run lint && bun run typecheck && bun run test && bun run build`

  Run: `npx react-doctor@latest --verbose --diff`

  Run: `npx impeccable detect`

- [ ] **Step 3: Push and open the replacement PR**

  The PR body references #273, closes #223/#280/#281, lists the deliberately excluded diagnostic/scoring work, and includes the clinical-safety checklist.

- [ ] **Step 4: Reply to PR #273**

  Mention `@DebbieLim98`, link the replacement PR, credit adopted work, and give evidence for exclusions: the current production overlap, the audited Abdullah citation mismatch, exact score-input requirements, and issues #226/#221.

- [ ] **Step 5: Monitor required checks and merge**

  Run: `gh pr checks <replacement-pr> --watch`

  After every required check passes: `gh pr merge <replacement-pr> --squash --delete-branch`.

- [ ] **Step 6: Verify the main-branch workflow/deployment state**

  Run: `gh run list --branch main --limit 10` and report any skipped or failed deploy explicitly.
