# Consultation Settings And Recording Pause Design

## Context

PR #272 currently places the note-layout selector above the clinical note and stores Capture Mode as a device-wide Audio preference. The revised interaction moves both consultation-specific choices into one settings dialog opened from the review-page hero.

Press To Record currently offers only Start Recording and Stop and Transcribe. A doctor needs to pause without ending the recording or starting transcription.

The PR preview frontend calls the production API, so template writes fail until the matching backend and database migration are deployed. The product must continue to report that failure honestly rather than simulating persistence in the browser.

## Goals

- Put consultation-specific choices behind a clearly labelled gear action in the hero.
- Persist Clinical Note Layout and Capture Mode per consultation.
- Lock Capture Mode permanently after a transcript exists.
- Prevent a settings change from interrupting an active capture or transcription.
- Add true pause and resume behavior to Press To Record without changing Ambient capture.
- Keep device-wide microphone, transcription-engine, and noise controls in Audio Settings.

## Non-Goals

- Pausing or reconnecting an Ambient Soniox session.
- Allowing a transcript to be replaced or recorded again.
- Treating a selected capture mode as patient consent.
- Hiding or locally faking a failed server write during a staggered deployment.
- Changing analysis, approval, red-flag, citation, or LLM behavior.

## Hero Actions

The hero action row groups the current workflow CTA with any context it needs:

- Analyse Consultation owns its disabled or error explanation.
- Approve Note owns confirmation and unacknowledged-red-flag explanations.
- Routine explanatory tooltips are removed. A tooltip appears only when the CTA is disabled, failed, requires confirmation, or carries an unresolved-warning count.

A rounded-rectangle icon button sits immediately to the right of that workflow group. It uses a gear icon, the accessible name `Consultation Settings`, and opens the settings dialog. It remains available on approved consultations because Clinical Note Layout is presentation state and stays changeable after approval.

Copy Note, Export, and the narrow-screen Transcript action remain secondary hero actions. The settings button and every dialog control are hidden from print.

## Consultation Settings Dialog

Use a native `<dialog>` with the existing glass-panel, scrim, focus, Escape, and close-button patterns. It contains two sections.

### Clinical Note Layout

Two radio-style tiles select:

- SOAP
- Malaysian Medical Record

The choice is available in every consultation state. Before analysis it records how the eventual note should be presented; after approval it changes presentation only. The selector no longer appears above the clinical note.

### Capture Mode

Two radio-style tiles select:

- Ambient
- Press To Record

The default for existing and new consultations is Press To Record. Selection alone sends no audio and grants no consent; the existing per-patient consent gates remain the only paths that authorize hosted audio.

Once `transcript` is non-null, both tiles are disabled and visible helper text says that Capture Mode is locked after transcript capture. While recording, uploading, transcribing, or finishing is active, opening or saving Consultation Settings is temporarily unavailable so a component cannot unmount while it owns unsent audio.

### Save Behavior

The dialog keeps a draft and writes only changed fields in one consultation PATCH. Save is disabled when nothing changed or while the request is pending. Cancel and Escape discard the draft.

On success, the consultation query receives the returned record and the dialog closes. On failure, the dialog stays open, the persisted layout remains unchanged, and an inline alert explains that the settings could not be saved. No fallback claims the write succeeded.

## Persistence And Contracts

Add a shared `CaptureModeSchema` with `ambient` and `manual`. `ConsultationSchema` and `ConsultationDetailSchema` expose `captureMode`, defaulting rollout-safely to `manual` when an older response omits it.

Add a Prisma `CaptureMode` enum and non-null `Consultation.captureMode` column defaulting to `manual`. Because PR #272 is unmerged, extend its existing additive migration instead of creating a second migration for the same deployment unit.

The consultation PATCH schema accepts `captureMode`. The route rejects a Capture Mode write with `409 invalid_state` once a transcript exists. Note-layout changes remain allowed after transcript capture and approval.

`captureMode` is closed-set presentation and capture configuration, not PHI. Erasure may retain it. The submitted transcript source remains the authoritative audit record of which capture path actually handled audio.

## Device Audio Settings

Remove Capture Mode from `AudioSettings` and from `AudioSettingsDialog`. Existing local-storage objects may still contain a `mode` key; the parser ignores it, and the next Audio Settings save naturally writes only the remaining device-scoped fields:

- Transcription Engine
- Microphone
- Suppress Room Noise
- Boost Quiet Speech

`CapturePanel` receives the consultation mode and a callback from `ConsultationReview`. Its fallback from unavailable Ambient capture to Press To Record updates the consultation through the same PATCH path rather than changing a device preference.

## Press To Record Pause And Resume

Add `paused` to the manual recorder phase model. The recording card renders controls in this order:

1. Pause Recording while active, replaced by Resume Recording while paused.
2. Stop and Transcribe in both active and paused states.

Pause calls `MediaRecorder.pause()` only when its state is `recording`. Resume calls `MediaRecorder.resume()` only when its state is `paused`. The existing recorder, chunks, stream, and prewarmed transcription worker remain owned by the same run.

While paused:

- The elapsed timer freezes.
- The pulsing recording indicator is replaced by a neutral `Paused` status.
- The input meter remains visible because the microphone stream is still open.
- Visible helper text says that audio is not being added until recording resumes.
- Stop and Transcribe finalizes everything captured before the pause.

Unmount cleanup stops both active and paused recorders without dispatching transcription. Errors from unsupported or invalid recorder transitions leave the current state unchanged and surface the existing recording error treatment.

## Accessibility And Visual Rules

- The gear is a rounded rectangular CTA, never an unlabeled icon or pill.
- Dialog headings label the native dialog; the close button has an accessible name.
- Setting groups use fieldsets with radio semantics, keyboard focus rings, and text labels.
- Locked state uses `disabled` plus visible explanatory text, never color alone.
- Pause and Resume have distinct accessible names and icons; status is announced through the existing live region pattern.
- The modal follows `docs/DESIGN.md`: glass only for floating chrome, opaque tiles for selectable content, 22px modal radius, and 10px control radius.

## Verification

Tests will prove:

- The hero shows the gear in draft, awaiting-review, and approved states, with workflow tooltips only when needed.
- The settings dialog loads and saves both fields, preserves approved-note finality, and keeps failed writes visible without changing persisted state.
- Capture Mode PATCHes are accepted before a transcript and rejected afterwards.
- Existing consultations and older API responses default to Press To Record.
- Audio Settings no longer contains or persists Capture Mode.
- Ambient fallback updates the consultation rather than device storage.
- Press To Record pauses, freezes time, resumes the same recorder, and can stop from paused state without losing captured chunks.
- Ambient capture gains no pause control.
- Full lint, typecheck, test, build, React Doctor, Impeccable, and PHI/provider-boundary checks remain green for the change.
