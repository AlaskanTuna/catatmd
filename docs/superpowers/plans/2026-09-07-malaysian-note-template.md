# Malaysian Note Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable, per-consultation Malaysian medical-record layout whose content remains consistent with the existing SOAP note and whose selected order drives copy and print.

**Architecture:** The note-generation call emits one canonical eight-field `MedicalRecordNote`; the backend derives the compatibility `SoapNote` projection from it and keeps clinician edits synchronized in one transaction. The review page selects either a four-section SOAP projection or the eight-section Malaysian layout, while legacy analyses retain their existing SOAP path.

**Tech Stack:** TypeScript 5.9, Zod, Express 5, Prisma 6/Postgres, React 19, TanStack Query, Vitest, Tailwind 4.

## Global Constraints

- Every LLM-bound transcript remains de-identified before reaching `LLMClient`; this feature adds no provider call or egress path.
- Empty new-analysis fields render and copy exactly as `Not established`.
- Missing canonical data on an older analysis renders as `Not recorded by this analysis version`, never as an inferred negative.
- AI-generated versus clinician-edited provenance and explicit doctor approval remain unchanged.
- Template identifiers and audit metadata are closed sets and contain no transcript or note text.
- UI follows `docs/DESIGN.md`, including solid content surfaces, 10px controls, print-safe provenance, and no hidden safety content.

---

### Task 1: Shared Canonical Note Contract And SOAP Projection

**Files:**

- Create: `shared/src/note-templates.ts`
- Create: `shared/src/note-templates.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/index.test.ts`

**Interfaces:**

- Produces: `NoteTemplateSchema`, `MedicalRecordNoteSchema`, `NoteTemplate`, `MedicalRecordNote`.
- Produces: `toSoapNote(note: MedicalRecordNote): SoapNote`, `formatSoapSubjective(note: MedicalRecordNote): string`, `NOT_ESTABLISHED`.
- Consumed by: analysis, API persistence, clipboard formatting, and note editors.

- [x] **Step 1: Write failing shared-contract tests**

```ts
const note = MedicalRecordNoteSchema.parse({
  presentingComplaint: 'Cough.',
  historyOfPresentingComplaint: 'Three days, worsening.',
  pastMedicalHistory: '',
  socialHistory: 'Does not smoke.',
  familyHistory: '',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care.',
})

expect(toSoapNote(note)).toEqual({
  subjective:
    'Presenting Complaint\nCough.\n\nHistory of Presenting Complaint\nThree days, worsening.\n\nPast Medical History\nNot established\n\nSocial History\nDoes not smoke.\n\nFamily History\nNot established',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care.',
})
expect(NoteTemplateSchema.safeParse('malaysian').success).toBe(true)
expect(NoteTemplateSchema.safeParse('free-text').success).toBe(false)
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `bun run --cwd shared test -- src/note-templates.test.ts src/index.test.ts`

Expected: FAIL because the schemas and projection exports do not exist.

- [x] **Step 3: Implement the schemas and pure projection**

```ts
export const NoteTemplateSchema = z.enum(['soap', 'malaysian'])
export const MedicalRecordNoteSchema = z.object({
  presentingComplaint: z.string(),
  historyOfPresentingComplaint: z.string(),
  pastMedicalHistory: z.string(),
  socialHistory: z.string(),
  familyHistory: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
})
```

`formatSoapSubjective` renders all five headings in the declared order and substitutes `NOT_ESTABLISHED` only for blank canonical strings. `toSoapNote` delegates Subjective to that formatter and copies Objective, Assessment, and Plan.

- [x] **Step 4: Run the focused shared tests and verify GREEN**

Run: `bun run --cwd shared test -- src/note-templates.test.ts src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the shared contract**

```bash
git add shared/src/index.ts shared/src/index.test.ts shared/src/note-templates.ts shared/src/note-templates.test.ts
git commit -m "feat(notes): add Malaysian note contract"
```

---

### Task 2: Generate And Version The Canonical Note

**Files:**

- Create: `backend/src/note-templates/index.ts`
- Modify: `backend/src/analysis/index.ts`
- Modify: `backend/src/analysis/index.test.ts`
- Modify: `backend/src/analysis/prompt.ts`
- Modify: `backend/src/analysis/types.ts`
- Modify: `backend/src/clinical-versions/index.ts`
- Modify: `backend/src/clinical-profiles/index.test.ts`
- Modify: `backend/src/routes/consultations.ts`
- Test: `backend/src/routes/consultations.test.ts`

**Interfaces:**

- Consumes: `MedicalRecordNoteSchema`, `MedicalRecordNote`, `toSoapNote`.
- Produces: `NoteAndGapsResult.medicalRecordNote` and `ConsultationAnalysis.medicalRecordNote`.
- Produces: `MEDICAL_RECORD_TEMPLATE_VERSION` inside every active clinical-content stamp.

- [x] **Step 1: Write failing pipeline and version tests**

```ts
expect(result.medicalRecordNote.familyHistory).toBe('No relevant family history stated.')
expect(result.note.subjective).toContain('Family History\nNo relevant family history stated.')
expect(getActiveClinicalVersions(profile).medicalRecordTemplate).toEqual({
  id: 'malaysian-medical-record-v1',
  effectiveDate: '2026-09-07',
})
```

Add a route assertion proving `medicalRecordNote` strings are re-hydrated before persistence, just like SOAP strings.

- [x] **Step 2: Run focused backend tests and verify RED**

Run: `bun run --cwd backend test -- src/analysis/index.test.ts src/clinical-profiles/index.test.ts src/routes/consultations.test.ts`

Expected: FAIL because canonical output and the version stamp do not exist.

- [x] **Step 3: Change the existing note-generation response, prompt, and pipeline**

Make `NoteAndGapsResponseSchema.note` a `MedicalRecordNoteSchema`. In `analyseNote`, derive SOAP once and pass that projection through `stripDiagnosticProse`; mirror any guarded Assessment back into the canonical note before returning both forms.

Update the prompt to request the five explicit history categories plus Objective, Assessment, and Plan. Empty history categories must be empty strings at the model boundary; `Not established` is presentation copy, not model-authored clinical prose.

In `runAnalysis`, re-hydrate each canonical string with the request-scoped vault and persist both `medicalRecordNote` and the derived SOAP `note`. Do not log either value.

- [x] **Step 4: Add and aggregate the mapping version**

```ts
export const MEDICAL_RECORD_TEMPLATE_VERSION = {
  id: 'malaysian-medical-record-v1',
  effectiveDate: '2026-09-07',
} as const satisfies ClinicalArtefactVersion
```

Include it as `medicalRecordTemplate` in `ACTIVE_CLINICAL_VERSIONS` so the existing `analysis_completed` stamp picks it up automatically.

- [x] **Step 5: Run focused backend tests and verify GREEN**

Run: `bun run --cwd backend test -- src/analysis/index.test.ts src/clinical-profiles/index.test.ts src/routes/consultations.test.ts`

Expected: PASS.

- [x] **Step 6: Commit analysis and versioning**

```bash
git add shared/src/index.ts backend/src/analysis backend/src/clinical-versions backend/src/clinical-profiles/index.test.ts backend/src/note-templates backend/src/routes/consultations.ts backend/src/routes/consultations.test.ts
git commit -m "feat(notes): generate categorized medical records"
```

---

### Task 3: Persist Template Choice And Synchronized Clinician Edits

**Files:**

- Create: `prisma/migrations/20260907000000_add_note_template/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `shared/src/index.ts`
- Modify: `backend/src/audit/index.ts`
- Modify: `backend/src/audit/audit.test.ts`
- Modify: `backend/src/audit/erasure.ts`
- Modify: `backend/src/audit/erasure.test.ts`
- Modify: `backend/src/routes/consultations.ts`
- Modify: `backend/src/routes/consultations.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/demo/DemoTour.tsx`

**Interfaces:**

- Produces: `ConsultationDetail.noteTemplate: NoteTemplate` with rollout-safe `soap` fallback.
- Produces: `ConsultationDetail.editedMedicalRecordNote: MedicalRecordNote | null`.
- Produces: PATCH fields `noteTemplate?: NoteTemplate` and `editedMedicalRecordNote?: Partial<MedicalRecordNote>`.
- Produces: audit action `consultation.template_selected` with `{ template: NoteTemplate }` only.

- [x] **Step 1: Write failing API, finality, and audit tests**

```ts
expect(response.body.consultation.noteTemplate).toBe('malaysian')
expect(update.data).toMatchObject({
  noteTemplate: 'malaysian',
  editedMedicalRecordNote: expect.objectContaining({ familyHistory: 'Mother has asthma.' }),
  editedNote: expect.objectContaining({
    subjective: expect.stringContaining('Mother has asthma.'),
  }),
})
expect(audit.metadata).toEqual({ template: 'malaysian' })
```

Cover template-only PATCH after approval, rejection of clinical edits after approval, invalid template identifiers, and a missing-column fallback to `soap`.
Add an erasure assertion proving `editedMedicalRecordNote` is nulled with the other PHI-bearing consultation columns.

- [x] **Step 2: Run focused API and audit tests and verify RED**

Run: `bun run --cwd backend test -- src/routes/consultations.test.ts src/audit/audit.test.ts`

Expected: FAIL because the database projection, PATCH fields, and audit action do not exist.

- [x] **Step 3: Add the additive database migration and shared response fields**

```sql
CREATE TYPE "NoteTemplate" AS ENUM ('soap', 'malaysian');
ALTER TABLE "consultation"
  ADD COLUMN "noteTemplate" "NoteTemplate" NOT NULL DEFAULT 'soap',
  ADD COLUMN "editedMedicalRecordNote" JSONB;
```

Use nullish transforms in shared response schemas so a frontend deployed before the backend defaults absent `noteTemplate` to `soap` and absent edited canonical content to `null`.

- [x] **Step 4: Implement synchronized PATCH persistence**

For `editedMedicalRecordNote`, merge onto the existing edited canonical note or the AI original, validate the complete shape, derive `editedNote` with `toSoapNote`, and write both JSON columns in one Prisma update. Keep the legacy `editedNote` route for older analyses.

Treat a template-only patch like a title-only patch for the approval gate. Record only the template identifier in the audit event.

- [x] **Step 5: Regenerate Prisma and verify GREEN**

Run: `bun run prisma:generate`

Run: `bun run --cwd backend test -- src/routes/consultations.test.ts src/audit/audit.test.ts`

Expected: PASS.

- [x] **Step 6: Commit persistence and API contracts**

```bash
git add prisma shared/src/index.ts backend/src/audit backend/src/routes/consultations.ts backend/src/routes/consultations.test.ts frontend/src/lib/api.ts
git commit -m "feat(notes): persist consultation template choice"
```

---

### Task 4: Format Both Templates For Clipboard And Legacy Records

**Files:**

- Create: `frontend/src/lib/note-templates.ts`
- Create: `frontend/src/lib/note-templates.test.ts`
- Modify: `frontend/src/routes/ConsultationReview.tsx`
- Modify: `frontend/src/routes/ConsultationReview.test.tsx`

**Interfaces:**

- Produces: `formatNoteForClipboard(template, soapNote, medicalRecordNote): string`.
- Produces: `medicalRecordSections(note): Array<{ key; label; value }>` in fixed PC/HPC/PMH/SH/FH/O/A/P order.
- Consumed by: clipboard action and note renderer.

- [ ] **Step 1: Write failing formatter tests**

```ts
expect(formatNoteForClipboard('malaysian', soap, medical)).toBe(
  'Presenting Complaint\nCough.\n\n' +
    'History of Presenting Complaint\nThree days.\n\n' +
    'Past Medical History\nNot established\n\n' +
    'Social History\nDoes not smoke.\n\n' +
    'Family History\nNot established\n\n' +
    'Objective\nNormal observations.\n\n' +
    'Assessment\nAcute cough under review.\n\n' +
    'Plan\nSupportive care.',
)
```

Add a legacy test that returns `Not recorded by this analysis version` for each unavailable history category, while retaining Objective, Assessment, and Plan.

- [ ] **Step 2: Run formatter tests and verify RED**

Run: `bun run --cwd frontend test -- src/lib/note-templates.test.ts src/routes/ConsultationReview.test.tsx`

Expected: FAIL because the selected-template formatter does not exist.

- [ ] **Step 3: Implement the pure formatter and route copy through it**

SOAP output retains its existing four headings. Malaysian output always emits all eight headings and substitutes the correct empty or legacy copy. Remove `formatSoapNoteForClipboard` from the route after its tests move to the focused formatter module.

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run: `bun run --cwd frontend test -- src/lib/note-templates.test.ts src/routes/ConsultationReview.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit formatting behavior**

```bash
git add frontend/src/lib/note-templates.ts frontend/src/lib/note-templates.test.ts frontend/src/routes/ConsultationReview.tsx frontend/src/routes/ConsultationReview.test.tsx
git commit -m "feat(notes): format selected record template"
```

---

### Task 5: Add The Template Selector And Canonical Note Editor

**Files:**

- Create: `frontend/src/review/MedicalRecordNoteEditor.tsx`
- Create: `frontend/src/review/MedicalRecordNoteEditor.test.tsx`
- Create: `frontend/src/review/NoteTemplateSelector.tsx`
- Create: `frontend/src/review/NoteTemplateSelector.test.tsx`
- Modify: `frontend/src/review/NoteEditor.tsx`
- Modify: `frontend/src/routes/ConsultationReview.tsx`
- Modify: `frontend/src/routes/ConsultationReview.test.tsx`

**Interfaces:**

- `NoteTemplateSelector({ value, saving, onChange })` renders SOAP and Malaysian Medical Record options.
- `MedicalRecordNoteEditor({ note, aiNote, template, readOnly, saving, onSave })` renders the selected projection from one canonical note.
- `onSave(edited: Partial<MedicalRecordNote>): void` is the only new-analysis edit path.

- [ ] **Step 1: Write failing interaction and provenance tests**

Test that switching to Malaysian:

- persists `{ noteTemplate: 'malaysian' }`;
- renders all five required history headings in order;
- shows `Not established` for a blank category;
- copies in Malaysian order;
- keeps the approval control and AI provenance marker;
- prints only the selected note layout;
- allows an approved consultation to switch templates but not edit clinical fields.

Test that editing Family History sends `{ editedMedicalRecordNote: { familyHistory: 'Mother has asthma.' } }` and changes that section's marker to `You Edited This` after the response arrives.

- [ ] **Step 2: Run focused React tests and verify RED**

Run: `bun run --cwd frontend test -- src/review/MedicalRecordNoteEditor.test.tsx src/review/NoteTemplateSelector.test.tsx src/routes/ConsultationReview.test.tsx`

Expected: FAIL because the selector and canonical editor do not exist.

- [ ] **Step 3: Implement the selector and canonical editor**

Use accessible radio semantics for the two-option selector. In SOAP mode, render Subjective as the deterministic five-category composition and let its Edit action open the five labeled category fields. In Malaysian mode, render the eight canonical fields individually. Reuse the current `data-provenance` values and print classes.

For older analyses without `medicalRecordNote`, keep `NoteEditor` unchanged and render the explicit legacy unavailable state when Malaysian is selected.

- [ ] **Step 4: Wire stored and ephemeral consultation updates**

Route stored changes through `api.patch`. For Demo Mode, merge `noteTemplate` and `editedMedicalRecordNote` in memory and derive `editedNote` using the same shared helper. Update CatatAI proposals for Objective, Assessment, and Plan through the canonical patch path when canonical data exists; retain the legacy SOAP path for old analyses.

- [ ] **Step 5: Run focused React tests and verify GREEN**

Run: `bun run --cwd frontend test -- src/review/MedicalRecordNoteEditor.test.tsx src/review/NoteTemplateSelector.test.tsx src/routes/ConsultationReview.test.tsx`

Expected: PASS with no React warnings.

- [ ] **Step 6: Commit the review experience**

```bash
git add frontend/src/review frontend/src/routes/ConsultationReview.tsx frontend/src/routes/ConsultationReview.test.tsx
git commit -m "feat(notes): add Malaysian record view"
```

---

### Task 6: Documentation, Full Verification, And PR

**Files:**

- Modify: `docs/trd.md`
- Modify: `docs/README.md` only if an external reviewer needs the template behavior to understand the product.

**Interfaces:**

- Produces: reviewer-facing explanation of the two layouts and developer-facing schema, persistence, compatibility, and audit behavior.

- [ ] **Step 1: Update the canonical technical documentation**

Document the eight-field canonical note, SOAP projection, template PATCH field, two new database columns, template audit event, clinical-content version, and legacy behavior. Preserve README density rules if the README changes.

- [ ] **Step 2: Run formatting and static checks**

Run: `bun run lint`

Run: `bun run typecheck`

Run: `bunx prettier --check "**/*.{md,yml,yaml}"`

Expected: all pass.

- [ ] **Step 3: Run complete behavioral verification**

Run: `bun run test`

Run: `bun run build`

Expected: all suites and both production builds pass.

- [ ] **Step 4: Run deterministic React and visual-quality audits**

Run: `npx react-doctor@latest . --verbose`

Run: `npx impeccable detect`

Expected: no unresolved findings in the #222 UI diff. Do not waive an Impeccable finding without explicit human confirmation.

- [ ] **Step 5: Verify PHI and provider boundaries**

Run: `bun run --cwd backend test -- src/lib/logger.leak.test.ts src/lib/llm/no-stray-provider-sdk.test.ts src/acceptance/safety.test.ts`

Expected: no note text in audit/log output and no new provider SDK egress.

- [ ] **Step 6: Commit documentation and verification fixes**

```bash
git add docs backend frontend shared prisma
git commit -m "docs: document Malaysian note templates"
```

- [ ] **Step 7: Review the final diff and open the PR**

Push `feat/222-malaysian-note-template`, open a PR using `.github/PULL_REQUEST_TEMPLATE.md`, include `Closes #222`, and retain the Clinical-Safety Checklist because the diff touches analysis and audit behavior. Wait for required checks and obtain the Vercel preview deployment URL before handing off.
