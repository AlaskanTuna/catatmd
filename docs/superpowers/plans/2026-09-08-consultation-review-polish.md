# Consultation Review Workspace Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/consultations/:id` template-correct in Draft state and simplify its supporting UI for GP use.

**Architecture:** Keep the existing consultation settings mutation, native-dialog pattern, and component boundaries. Make the placeholder template-aware; let `ChecklistPanel` own its dialog; and change only presentation/copy in CatatAI and capture components.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 4, native `<dialog>`, Testing Library, Vitest.

## Global Constraints

- Follow `AGENTS.md` and `docs/DESIGN.md`; `docs/DESIGN.md` is the visual authority.
- Use test-driven development: write each behavioral test, run it and observe the expected failure, then implement.
- All labels use Title Case; sentences use normal sentence case.
- Tooltips contain at most two short GP-facing sentences and no implementation vocabulary.
- Preserve visible consent, privacy, residency, clinical-safety, print, and accessibility guarantees.
- Do not change APIs, shared schemas, backend code, dependencies, clinical logic, or unrelated UI.
- Do not commit from a parallel worker.

---

### Task 1: Template-Aware Draft Placeholder

**Files:**

- Modify: `frontend/src/routes/ConsultationReview.test.tsx`
- Modify: `frontend/src/routes/ConsultationReview.tsx`

**Interfaces:**

- Consumes: `detail.noteTemplate: NoteTemplate`.
- Produces: `NotePlaceholder({ template }: { template: NoteTemplate })`.

- [ ] **Step 1: Write the failing Draft behavior test**

Extend the consultation settings tests with a Draft consultation whose `analysis` is `null`. Open Consultation Settings, select Malaysian Medical Record, save, and have `api.patch` resolve with `noteTemplate: 'malaysian'`. Assert that Presenting Complaint and Family History appear and Subjective disappears.

The production mutation this catches is replacing `<NotePlaceholder template={detail.noteTemplate} />` with a parameterless SOAP placeholder.

- [ ] **Step 2: Verify the test fails for the expected reason**

Run:

```bash
bun run --cwd frontend vitest run src/routes/ConsultationReview.test.tsx
```

Expected: the saved consultation updates, but the placeholder still exposes Subjective and lacks Malaysian headings.

- [ ] **Step 3: Implement the minimal template-aware placeholder**

Import `NoteTemplate` from the shared types. Define literal SOAP and Malaysian placeholder heading arrays, accept `template`, and map the selected array. Pass `detail.noteTemplate` at the render site. Remove the obsolete `defaultOpen` prop from the live `ChecklistPanel` call once Task 3 removes it.

- [ ] **Step 4: Verify focused tests pass**

Run the same test file and confirm it passes.

---

### Task 2: Concise GP-Facing Tooltips And Ambient Status

**Files:**

- Modify: `frontend/src/routes/ConsultationReview.tsx`
- Modify: `frontend/src/routes/ConsultationReview.test.tsx`
- Modify: `frontend/src/review/ApproveBar.tsx`
- Modify: `frontend/src/review/ApproveBar.test.tsx`
- Modify: `frontend/src/audio/AudioCapture.tsx`
- Modify: `frontend/src/audio/AudioCapture.test.tsx`
- Modify: `frontend/src/audio/AudioSettingsDialog.tsx`
- Modify: `frontend/src/audio/AudioSettingsDialog.test.tsx`
- Modify: `frontend/src/audio/live/AmbientCapture.tsx`
- Modify: `frontend/src/audio/live/AmbientCapture.test.tsx`

**Interfaces:**

- No type or prop changes.
- Every existing `InfoTip` in these components remains accessible, except the redundant Ambient tip may be removed because its explanation becomes visible copy.

- [ ] **Step 1: Add failing copy and safety tests**

Cover these observable contracts:

- Ambient idle heading is `Not Listening`.
- The next helper line explains live ambient transcription and excludes `Other languages are untested here`.
- The consent checkbox/disclosure remains immediately after the ambient summary.
- Speaker-label help says labels are automatic and must be checked.
- Engine tips state the device/hosted boundary and hosted Malaysian processing without GPU, CDN, model-weight, internal-pipeline, or legislative prose.
- Approval help states finality; the red-flag warning says review remains without explaining implementation policy.
- Analysis failure help never displays a raw technical error.

- [ ] **Step 2: Verify the focused tests fail**

Run the five affected test files. Confirm failures are caused by current verbose/technical copy and lower-case `listening`.

- [ ] **Step 3: Replace copy surgically**

Use short, direct copy. Preserve these meanings:

```text
Not Listening
Ambient Capture transcribes the consultation as it happens.
Speaker labels are automatic. Check them before submitting.
Runs on this device. Audio is not uploaded.
Sends audio to ILMU in Malaysia. Review the transcript carefully.
Approval finalises this note. It cannot be edited later.
<N> red flags still need review. You can still approve.
Analysis failed. Try again.
Add a transcript first.
```

Noise and quiet-speech tips should each be no more than two short sentences. Remove `languageLine` and any now-unused language-label imports/constants only if this change makes them unused.

- [ ] **Step 4: Verify focused tests pass**

Run the affected tests and check for no console or accessibility warnings introduced by the changes.

---

### Task 3: Completeness Checklist CTA And Dialog

**Files:**

- Modify: `frontend/src/review/ChecklistPanel.test.tsx`
- Modify: `frontend/src/review/ChecklistPanel.tsx`

**Interfaces:**

- `ChecklistPanel` continues to consume `clinicalFacts`, `operational`, and optional `evidenceLinks`.
- Remove `defaultOpen`.
- Add no exported component or shared abstraction.

- [ ] **Step 1: Write failing dialog tests**

Test with real `ChecklistPanel` markup:

- The screen shows a button named Completeness Checklist with the established count.
- No `aria-expanded` disclosure contract remains.
- Clicking opens a labelled dialog, moves focus to Close, and exposes every canonical section/item.
- Closing hides the dialog from the accessibility tree.
- The dialog carries `data-print="block"`; the CTA carries `data-print="hide"`.
- Long values retain the existing shrink/truncation classes and badge-only rows retain their width floor.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
bun run --cwd frontend vitest run src/review/ChecklistPanel.test.tsx
```

Expected: current disclosure toggles inline content and no checklist dialog exists.

- [ ] **Step 3: Implement the native dialog**

Keep entry derivation and `ChecklistRow` unchanged. Extract one local checklist-body render function/component. Add local open state and a dialog ref, open with `showModal()`, focus Close after content becomes available, and clear state on close.

Use the Conversation dialog grammar:

```text
glass-panel
h-[min(85vh,48rem)]
w-[min(56rem,calc(100vw-2rem))]
max-w-none
rounded-float
backdrop:bg-scrim
backdrop:backdrop-blur-sm
```

Use a fixed header with title/count/Close and a single `overflow-y-auto bg-sunken p-6` reading area. Render checklist sections as opaque content surfaces. Keep one body instance in the dialog and expose it for print with `data-print="block"`.

- [ ] **Step 4: Verify focused tests pass**

Run ChecklistPanel tests. Then run ConsultationReview tests after Task 1 removes `defaultOpen`.

---

### Task 4: Conversation-Style CatatAI Surfaces

**Files:**

- Modify: `frontend/src/copilot/CatatAI.test.tsx`
- Modify: `frontend/src/copilot/CatatAI.tsx`

**Interfaces:**

- Preserve the existing `CatatAI` props and all copilot state/data behavior.
- Do not alter `useCopilot`, messages, proposals, chips, composer actions, demo restrictions, or portal placement.

- [ ] **Step 1: Write failing surface-contract tests**

After opening the real panel, assert the docked shell uses `glass-panel`, its reading area uses `bg-sunken`, and its footer remains an opaque surface. Expand it and assert the dialog uses the Conversation dimensions `h-[min(85vh,48rem)]` and `w-[min(56rem,calc(100vw-2rem))]`.

Retain existing tests for composer, expand control, close behavior, and demo mode.

- [ ] **Step 2: Verify the new tests fail**

Run:

```bash
bun run --cwd frontend vitest run src/copilot/CatatAI.test.tsx
```

Expected: current docked shell is `glass`, current scroller lacks `bg-sunken`, and expanded dimensions differ.

- [ ] **Step 3: Apply the Conversation surface grammar**

Change only classes and structural wrappers needed for:

- `glass-panel` docked shell with a neutral edge.
- Conversation-sized expanded dialog.
- Conversation-like header spacing and divider.
- Sunken opaque message scroller.
- Opaque composer/footer with top divider.

Do not redefine the body component inside render and do not add memoization for simple values.

- [ ] **Step 4: Verify focused tests pass**

Run CatatAI tests and confirm every prior interaction test still passes.

---

### Task 5: Combined Review And Release Verification

**Files:**

- Review every file changed by Tasks 1–4.
- Do not change files outside #295 unless a failing check proves it necessary.

- [ ] **Step 1: Review the combined diff**

Check file ownership, no stray files, no leaked machine paths, no rejected Devin tool calls, no API/backend changes, and no weakened visible disclosure.

- [ ] **Step 2: Run focused frontend tests**

Run all test files touched by the four workers.

- [ ] **Step 3: Run repository verification**

Run:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
npx react-doctor@latest --verbose --diff
npx impeccable detect
git diff --check origin/main...HEAD
```

- [ ] **Step 4: Exercise the UI in a real browser**

Verify Draft SOAP/Malaysian switching, checklist open/close/focus/scroll, Ambient idle copy and consent order, and both CatatAI sizes in light and dark themes at desktop and mobile widths.

- [ ] **Step 5: Open and merge the PR**

Push the feature branch, open a PR closing #295, wait for every required check to pass, squash-merge, delete the branch, and verify the resulting `main` workflows/deployment.
