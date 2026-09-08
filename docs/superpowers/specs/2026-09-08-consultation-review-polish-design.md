# Consultation Review Workspace Polish Design

**Issue:** #295  
**Status:** Approved on 8 September 2026

## Goal

Make the consultation review workspace immediately legible to a GP: the Draft note shape follows the selected format, supporting copy is short and non-technical, the completeness checklist opens as a clean reading surface, and CatatAI shares the Conversation dialog's visual grammar.

## Decisions

### Draft Note Shape

The existing settings mutation already returns the updated consultation and replaces the TanStack Query cache entry. The mismatch is presentational: the Draft path renders a parameterless `NotePlaceholder` whose four headings are hard-coded to SOAP.

Pass `detail.noteTemplate` into the placeholder and render either:

- SOAP: Subjective, Objective, Assessment, Plan.
- Malaysian Medical Record: Presenting Complaint, History of Presenting Complaint, Past Medical History, Social History, Family History, Objective, Assessment, Plan.

No API, schema, persistence, or analysis change is required.

### GP-Facing Supporting Copy

Every `InfoTip` reachable from `/consultations/:id` will use one or two short sentences in ordinary clinical-workflow language. Remove implementation vocabulary such as model weights, GPU, CDN, segment timing, internal service behavior, and legislation detail from tooltips.

Required facts remain visible where the doctor makes the decision:

- Whether audio leaves the device.
- Where hosted audio is processed.
- That explicit patient consent is required.
- That speaker labels and transcripts require review.
- That approval is final.

The Ambient idle state reads **Not Listening**. Its visible helper line says that Ambient Capture transcribes the consultation as it happens; it no longer lists tuned or untested languages. The consent gate remains directly below it.

### Completeness Checklist Dialog

Replace the expandable checklist body with one full-width CTA card showing:

- Completeness Checklist.
- The established count.
- A clear open affordance.

Activating it opens a native `<dialog>` using the Conversation modal's size, glass shell, header spacing, close action, scrollable sunken reading area, focus behavior, backdrop, and responsive bounds. Inside, checklist entries remain grouped in canonical medical-record order and use opaque clinical-content surfaces.

The checklist body is rendered once inside the dialog. A print override exposes that same body even when the dialog is closed, while the screen CTA is hidden. The obsolete `defaultOpen` behavior is removed; live capture shows the same updating CTA and dialog.

### CatatAI Surfaces

Preserve all CatatAI state, streaming, proposal, composer, docking, and demo behavior. Change only the surface grammar:

- Docked view uses the `glass-panel` shell and the same clear border hierarchy as Conversation.
- Expanded view uses Conversation's modal dimensions and header rhythm.
- The message scroller uses a sunken opaque reading ground.
- The composer/footer stays on an opaque surface with a clear top divider.
- Clinical or conversational content never relies on translucent glass for contrast.

## Accessibility And Responsive Behavior

- Native dialogs retain Escape dismissal, top-layer focus trapping, backdrop, and inert page behavior.
- Opening the checklist moves focus to its Close action.
- Every icon-only action keeps an accessible name and visible focus style.
- Dialogs fit within a 16px viewport gutter and keep one internal vertical scroller.
- Reduced-motion behavior and both themes remain unchanged.
- The checklist remains present in print.

## Verification

- A failing Draft test proves the Malaysian placeholder was previously SOAP-only.
- Component tests cover concise copy, title casing, absence of development language, checklist dialog opening/focus/complete content/print contract, and CatatAI shell structure.
- Focused tests run after each work package.
- The combined branch runs lint, typecheck, all tests, build, React Doctor, Impeccable, and browser checks before merge.
