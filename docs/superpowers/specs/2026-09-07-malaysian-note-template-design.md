# Malaysian Medical-Record Template Design

## Context

Issue #222 adds the Malaysian medical-record order—Presenting Complaint (PC), History of Presenting Complaint (HPC), Past Medical History (PMH), Social History (SH), and Family History (FH)—alongside SOAP.

The existing `SoapNote` stores all five history concepts in one free-text `subjective` field. The fixed clinical-fact checklist also has no Family History field. A frontend-only split would therefore be heuristic and could label stated information as unestablished. This design adds an explicit, editable structure while retaining the existing SOAP contract for compatibility.

## Goals

- Let a doctor switch one consultation between SOAP and Malaysian layouts.
- Keep one canonical set of history content so the two layouts cannot drift.
- Preserve clinician editing, AI provenance, explicit approval, printing, and clipboard export.
- Render transcript-silent categories as `Not established`, never omit them.
- Persist the selected layout and version the mapping used by an analysis.
- Keep all model egress behind the existing de-identification gate and `LLMClient`.

## Non-Goals

- Changing the red-flag, guideline, suggestion, or approval logic.
- Inferring categories in the browser from prose or transcript keywords.
- Migrating historical consultations by re-running their transcripts through an LLM.
- Adding another provider call.

## Canonical Note Shape

Add a shared `MedicalRecordNoteSchema` with eight strings:

- `presentingComplaint`
- `historyOfPresentingComplaint`
- `pastMedicalHistory`
- `socialHistory`
- `familyHistory`
- `objective`
- `assessment`
- `plan`

The existing note-generation call emits this shape instead of an undifferentiated SOAP Subjective field. The API stores the five-category original on `ConsultationAnalysis` and derives the existing `SoapNote` projection from it:

- SOAP Subjective is a deterministic composition of PC, HPC, PMH, SH, and FH.
- SOAP Objective, Assessment, and Plan use the same canonical fields directly.
- The Malaysian layout renders the five history categories first, followed by Objective, Assessment, and Plan so no clinical content disappears when switching layouts.

`ConsultationAnalysis.note` remains a `SoapNote` for compatibility. The new canonical note is optional on the API-facing analysis schema so consultations created by an older analysis version still parse safely.

## Editing And Provenance

Add `editedMedicalRecordNote` to the consultation record. For newly analysed consultations it is the editable source of truth:

- Editing any Malaysian section updates the canonical edited note.
- Editing SOAP Objective, Assessment, or Plan updates the same canonical field.
- Editing SOAP Subjective opens the five categorized history fields rather than accepting an un-splittable aggregate.
- The API derives and stores `editedNote` in the same transaction, preserving current consumers and preventing the SOAP and Malaysian forms from diverging.

Provenance remains comparison-based. Each displayed section compares the clinician value with the corresponding AI original. SOAP Subjective is marked edited when any of its five canonical history fields differs.

Approved consultations remain read-only. The existing approval state transition and checks are unchanged.

## Template Selection And Export

Add a shared `NoteTemplateSchema` with `soap` and `malaysian`, and persist it on `Consultation` with `soap` as the default.

The review page places a compact two-option selector above the note. It follows `docs/DESIGN.md`: solid content surface, 10px control radius, restrained accent for the selected option, and no hidden safety content.

- The selector is presentation state, not clinical content, so it may be changed after approval.
- Copy Note formats the currently selected layout.
- Export prints the currently selected layout; the selector itself is hidden in print.
- An empty canonical field renders and copies as `Not established`.
- Demo Mode keeps the choice in memory and performs no persistence.

## Persistence And Audit

Add two consultation columns:

- `noteTemplate`, defaulting to `soap`.
- `editedMedicalRecordNote`, nullable JSON.

The consultation PATCH contract accepts template selection independently from clinical edits. A template-only patch is allowed after approval and writes a `consultation.template_selected` audit event containing only the closed-set template identifier.

Add the Malaysian template mapping version to `getActiveClinicalVersions`. Each completed analysis therefore records which canonical-field-to-SOAP projection produced the note, beside the red-flag list, gap checklist, guideline corpus, and clinical profile versions.

## Compatibility

Older consultations without the canonical note continue to render and edit their existing SOAP note unchanged. If the Malaysian layout is selected for one of these records, each unavailable history category says `Not recorded by this analysis version`; it must not claim `Not established`, because the older analysis did not test that fact.

No migration reprocesses stored transcript or note text. The database migration only adds nullable/defaulted columns.

## Verification

Tests will prove:

- Shared schemas accept all five categories and reject invalid template identifiers.
- The note pipeline derives SOAP from the canonical fields and uses no new egress path.
- Empty new-analysis categories display and copy as `Not established`.
- Legacy consultations distinguish unavailable categorization from unestablished content.
- Edits update both the canonical record and SOAP projection atomically.
- Template choice persists, remains changeable after approval, and emits metadata without clinical text.
- Copy and print use the selected order.
- AI/edited markers and the existing approval guard remain intact.

The full lint, typecheck, test, build, React audit, and `npx impeccable detect` checks run before the PR is opened.
