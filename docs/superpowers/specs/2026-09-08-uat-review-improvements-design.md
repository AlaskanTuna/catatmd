# UAT Review Improvements Design

## Goal

Adopt the safe, non-duplicative parts of PR #273 on top of current `main`, while correcting the consultation hero controls reported after deployment.

## Adopted Scope

- Rewrite deterministic missing-information copy as neutral questions a GP can ask next. Existing assertion-state gating remains authoritative: established or denied facts do not reappear.
- Group the completeness checklist using the canonical Malaysian note projection already shipped in #272: Presenting Complaint, History of Presenting Complaint, Past Medical History, Social History, Family History, Objective, Assessment and Plan. Empty sections are not rendered.
- Scope CatatAI's guideline context to the clinical profile persisted with the analysis, with the existing adult acute URTI profile as the legacy fallback.
- Add a post-decode guard that removes model-authored suggestions containing diagnostic or autonomous prescribing prose. It checks suggestion text and optional model-authored citation quotes, retains safe cited suggestions, and records suppressed suggestion IDs—not content—in the analysis audit event.
- Make approved-state Copy Note and Export actions use the same large dimensions as Consultation Settings.
- Place contextual information visually inside Analyze Consultation and Approve Note. The tooltip trigger remains a sibling of the action button in the DOM so controls are not nested and the explanation remains reachable when the action is disabled.

## Explicit Exclusions

- No deterministic differential or “Clinical Differentiation” output. Issue #226 remains the decision gate.
- No Modified Centor or McIsaac implementation. Issue #221 owns a clinician-completed, evidence-linked calculator design.
- No safety-netting claims attributed to Abdullah et al. 2024.
- No replacement note-export utilities or stale consultation action bar from PR #273.
- No new clinical-profile picker in this change.

## Data Flow And Safety

The suggestions LLM call still passes only a branded de-identified payload through `LLMClient`. Its ID-constrained schema decodes first; the new pure guard then checks every model-authored text field. Suppression never touches deterministic red flags and records only suggestion IDs in `AuditEvent.metadata`.

CatatAI resolves the analysis profile before serialising the guideline corpus. Legacy analyses with no profile ID use the existing default profile. No client-provided profile value is trusted on this read path.

## UI Behaviour

The hero CTA wrapper reserves room inside the visible button boundary for an independently focusable tooltip trigger. A tooltip appears only for an analysis error, a missing transcript, an unacknowledged-red-flag warning, or approval confirmation detail. Copy Note, Export and Consultation Settings all use `size="lg"`.

## Verification

- Backend tests cover profile-specific CatatAI corpus selection, safe/unsafe suggestion filtering and audit metadata without PHI.
- Gap tests prove neutral question wording, state gating and checklist versioning.
- Frontend tests cover canonical checklist groups and hero actions in draft, awaiting-review and approved states.
- Full lint, typecheck, test, build, React Doctor and Impeccable checks run before the PR is opened.
