# Consultation Settings And Recording Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move note layout and capture mode into consultation-level settings, persist both choices safely, and add pause/resume to Press To Record.

**Architecture:** Extend the shared and Prisma consultation contract with a rollout-safe `captureMode`, enforce its transcript lock in the API, and make `ConsultationReview` the owner of both settings. A focused native-dialog component edits those settings, while `CapturePanel` receives the persisted mode instead of reading it from device Audio Settings. Manual recording adds a `paused` phase around the existing `MediaRecorder` without replacing its stream, chunks, or worker.

**Tech Stack:** TypeScript 5.9, Zod, Prisma 6, Express 5, React 19, TanStack Query 5, Tailwind 4, Vitest, Testing Library

## Global Constraints

- Follow `docs/superpowers/specs/2026-09-07-consultation-settings-and-recording-pause-design.md` and `docs/DESIGN.md`.
- Capture Mode is per consultation and defaults to `manual`.
- Capture Mode is immutable once `transcript` is non-null.
- Changing a setting never implies patient consent and never sends audio.
- Pause applies only to Press To Record; Ambient capture is unchanged.
- No transcript, note, vault, or audio content enters logs or audit metadata.
- Keep the existing PR migration additive and apply it before the matching backend serves production traffic.

---

### Task 1: Add The Per-Consultation Capture-Mode Contract

**Files:**

- Modify: `shared/src/index.ts`
- Modify: `shared/src/note-templates.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/20260907000000_add_note_template/migration.sql`

**Interfaces:**

- Produces: `CaptureModeSchema = z.enum(['ambient', 'manual'])` and inferred `CaptureMode`.
- Produces: rollout-safe `Consultation.captureMode: CaptureMode`, defaulting an absent response to `manual`.
- Produces: Prisma `CaptureMode` enum and `Consultation.captureMode @default(manual)`.

- [x] **Step 1: Write failing shared-contract tests**

Add assertions to `shared/src/note-templates.test.ts`:

```ts
expect(CaptureModeSchema.safeParse('ambient').success).toBe(true)
expect(CaptureModeSchema.safeParse('manual').success).toBe(true)
expect(CaptureModeSchema.safeParse('continuous').success).toBe(false)

const consultation = ConsultationSchema.parse({
  id: 'c1',
  status: 'draft',
  title: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})
expect(consultation.captureMode).toBe('manual')
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `bun run --cwd shared test -- src/note-templates.test.ts`

Expected: FAIL because `CaptureModeSchema` and `Consultation.captureMode` do not exist.

- [x] **Step 3: Implement the shared and database contract**

In `shared/src/index.ts`, place the enum beside `NoteTemplateSchema`, add the rollout-safe field beside `noteTemplate`, and export the inferred type:

```ts
export const CaptureModeSchema = z.enum(['ambient', 'manual'])

captureMode: CaptureModeSchema.nullish().transform((value) => value ?? 'manual'),

export type CaptureMode = z.infer<typeof CaptureModeSchema>
```

In Prisma and the existing migration, add:

```prisma
enum CaptureMode {
  ambient
  manual
}

captureMode CaptureMode @default(manual)
```

```sql
CREATE TYPE "CaptureMode" AS ENUM ('ambient', 'manual');

ADD COLUMN "captureMode" "CaptureMode" NOT NULL DEFAULT 'manual',
```

- [x] **Step 4: Regenerate Prisma and verify GREEN**

Run: `bun run prisma:generate`

Run: `bun run --cwd shared test -- src/note-templates.test.ts`

Expected: Prisma generation succeeds and the focused shared tests pass.

- [x] **Step 5: Commit the contract**

```bash
git add shared/src/index.ts shared/src/note-templates.test.ts prisma/schema.prisma prisma/migrations/20260907000000_add_note_template/migration.sql
git commit -m "feat(consultations): add capture mode contract"
```

---

### Task 2: Persist Capture Mode And Enforce The Transcript Lock

**Files:**

- Modify: `backend/src/routes/consultations.ts`
- Modify: `backend/src/routes/consultations.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/demo/DemoTour.tsx`

**Interfaces:**

- Consumes: `CaptureModeSchema` and `CaptureMode` from Task 1.
- Produces: `api.patch(id, { captureMode })`.
- Produces: API invariant that any Capture Mode write after transcript capture returns `409 invalid_state`.

- [x] **Step 1: Write failing route tests**

Add cases under `state machine — patch` that prove:

```ts
expect(detail.captureMode).toBe('manual')

const changed = await call('PATCH', '/api/consultations/c1', { captureMode: 'ambient' })
expect(changed.status).toBe(200)
expect(store.get('c1')?.captureMode).toBe('ambient')

seed('draft', { transcript: TRANSCRIPT })
const locked = await call('PATCH', '/api/consultations/c1', { captureMode: 'ambient' })
expect(locked.status).toBe(409)
```

Also assert that a note-template-only PATCH still succeeds after a transcript exists.

- [x] **Step 2: Run the route tests and verify RED**

Run: `bun run --cwd backend test -- src/routes/consultations.test.ts -t "state machine — patch"`

Expected: FAIL because the route drops `captureMode` and does not enforce its lock.

- [x] **Step 3: Implement mapping, validation, persistence, and client typing**

Update `toDetail`, `PatchBodySchema`, `presentationOnly`, and the Prisma update data:

```ts
captureMode: row.captureMode ?? 'manual',

captureMode: CaptureModeSchema.optional(),

const presentationOnly = Object.keys(patch).every(
  (key) => key === 'title' || key === 'noteTemplate' || key === 'captureMode',
)

if (patch.captureMode !== undefined && consultation.transcript !== null) {
  throw new HttpError(409, 'invalid_state', 'Capture Mode is locked after transcript capture.')
}

...(patch.captureMode === undefined ? {} : { captureMode: patch.captureMode }),
```

Add `captureMode?: CaptureMode` to the frontend PATCH body. Set `captureMode: 'manual'` on the ephemeral consultation so the in-memory path satisfies the same contract.

- [x] **Step 4: Run focused backend and frontend type verification**

Run: `bun run --cwd backend test -- src/routes/consultations.test.ts -t "state machine — patch"`

Run: `bun run typecheck`

Expected: route tests and typechecking pass.

- [x] **Step 5: Commit persistence**

```bash
git add backend/src/routes/consultations.ts backend/src/routes/consultations.test.ts frontend/src/lib/api.ts frontend/src/demo/DemoTour.tsx
git commit -m "feat(consultations): persist capture mode"
```

---

### Task 3: Remove Capture Mode From Device Audio Settings

**Files:**

- Modify: `frontend/src/audio/audio-settings.ts`
- Modify: `frontend/src/audio/audio-settings.test.ts`
- Modify: `frontend/src/audio/AudioSettingsDialog.tsx`
- Modify: `frontend/src/audio/AudioSettingsDialog.test.tsx`

**Interfaces:**

- Produces: device-scoped `AudioSettings` containing only `deviceId`, `suppressNoise`, `boostQuietSpeech`, and `engine`.
- Preserves: parsing of older local-storage objects by ignoring their obsolete `mode` property.

- [x] **Step 1: Write failing Audio Settings tests**

Assert that the opened Audio dialog has no Capture Mode legend or Ambient button, while retaining Transcription Engine, Microphone, and Noise Handling. Update the local-storage test to seed a legacy object with `mode: 'ambient'` and expect the loaded result not to expose `mode`.

```ts
expect(screen.queryByRole('group', { name: 'Capture Mode' })).toBeNull()
expect(screen.getByRole('group', { name: 'Transcription Engine' })).toBeTruthy()
expect(loadAudioSettings()).not.toHaveProperty('mode')
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `bun run --cwd frontend test -- src/audio/audio-settings.test.ts src/audio/AudioSettingsDialog.test.tsx`

Expected: FAIL because Audio Settings still owns Capture Mode.

- [x] **Step 3: Remove the device-scoped mode**

Delete `mode` from `AudioSettings`, `DEFAULT_AUDIO_SETTINGS`, and `loadAudioSettings`. Remove the Capture Mode fieldset and its `Radio`, `Mic`, and `CaptureMode` imports from `AudioSettingsDialog`.

Keep all consent language tied to the remaining controls truthful. The dialog subtitle remains device-scoped.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `bun run --cwd frontend test -- src/audio/audio-settings.test.ts src/audio/AudioSettingsDialog.test.tsx`

Expected: both suites pass.

- [x] **Step 5: Commit Audio Settings cleanup**

```bash
git add frontend/src/audio/audio-settings.ts frontend/src/audio/audio-settings.test.ts frontend/src/audio/AudioSettingsDialog.tsx frontend/src/audio/AudioSettingsDialog.test.tsx
git commit -m "refactor(audio): keep device settings device scoped"
```

---

### Task 4: Add The Consultation Settings Dialog And Hero Gear

**Files:**

- Create: `frontend/src/review/ConsultationSettingsDialog.tsx`
- Create: `frontend/src/review/ConsultationSettingsDialog.test.tsx`
- Modify: `frontend/src/routes/ConsultationReview.tsx`
- Modify: `frontend/src/routes/ConsultationReview.test.tsx`
- Modify: `frontend/src/routes/CapturePanel.tsx`
- Modify: `frontend/src/routes/CapturePanel.test.tsx`
- Modify: `frontend/src/review/NoteTemplateSelector.tsx`
- Modify: `frontend/src/audio/AudioCapture.tsx`
- Modify: `frontend/src/audio/AudioCapture.test.tsx`

**Interfaces:**

- Produces: `ConsultationSettingsPatch = { noteTemplate?: NoteTemplate; captureMode?: CaptureMode }`.
- Produces: `ConsultationSettingsDialog({ ref, noteTemplate, captureMode, captureModeLocked, saving, error, onSave })`.
- Changes: `CapturePanel({ captureMode, onCaptureModeChange, onCaptureBusyChange, ... })`.
- Changes: `AudioCapture` reports every non-idle phase through `onBusyChange(active: boolean)`.

- [ ] **Step 1: Write failing dialog and route interaction tests**

The dialog tests must open the native dialog and prove:

```ts
expect(screen.getByRole('radio', { name: 'SOAP' })).toBeTruthy()
expect(screen.getByRole('radio', { name: 'Malaysian Medical Record' })).toBeTruthy()
expect(screen.getByRole('radio', { name: 'Ambient' })).toBeTruthy()
expect(screen.getByRole('radio', { name: 'Press To Record' })).toBeTruthy()
```

After selecting Malaysian and Ambient, Save calls:

```ts
onSave({ noteTemplate: 'malaysian', captureMode: 'ambient' })
```

With `captureModeLocked`, assert both Capture Mode radios are disabled and the lock explanation is visible. With an error, assert the dialog remains open and exposes a `role="alert"`.

The route tests must prove the old selector is absent from the Clinical Note section, the `Consultation Settings` gear opens the dialog in awaiting-review and approved states, and a successful save PATCHes both changed fields. Assert ordinary Analyse state has no informational tooltip when the CTA is enabled.

Add an `AudioCapture` test that observes `onBusyChange(true)` when recording starts and `onBusyChange(false)` when the component returns to idle. This callback is what prevents a hero-level mode switch from unmounting a recorder that owns unsent audio.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `bun run --cwd frontend test -- src/review/ConsultationSettingsDialog.test.tsx src/routes/ConsultationReview.test.tsx src/routes/CapturePanel.test.tsx`

Expected: FAIL because the dialog, hero gear, and consultation-owned Capture Mode do not exist.

- [ ] **Step 3: Implement the dialog**

Build a native dialog using the existing Audio/Help dialog patterns. Keep `NoteTemplateSelector` reusable inside the dialog by allowing its outer margin and `layered` context to be supplied rather than duplicating its option vocabulary.

The dialog computes and submits only changed values:

```ts
const changes: ConsultationSettingsPatch = {
  ...(draft.noteTemplate === noteTemplate ? {} : { noteTemplate: draft.noteTemplate }),
  ...(captureModeLocked || draft.captureMode === captureMode
    ? {}
    : { captureMode: draft.captureMode }),
}
```

Save is disabled when `Object.keys(changes).length === 0` or `saving` is true. Cancel resets the draft and closes. Render the supplied error inline with `role="alert"`.

- [ ] **Step 4: Make ConsultationReview own the settings mutation**

Add the gear immediately after the workflow CTA group. Remove the note-column selector. Keep only conditional workflow tips: missing transcript, analysis failure, approval confirmation, or unacknowledged red flags.

Use a dedicated settings mutation so errors stay in the dialog and successful writes close it:

```ts
const settings = useMutation({
  mutationFn: patchConsultation,
  onSuccess: (next) => {
    invalidate(next)
    settingsDialog.current?.close()
  },
})
```

The stored path calls `api.patch`; the ephemeral path merges both closed-set fields in memory. Pass `captureModeLocked={detail.transcript !== null}`.

- [ ] **Step 5: Make CapturePanel consume the consultation mode**

Replace `audio.mode` with the `captureMode` prop. `switchToManual` calls `onCaptureModeChange('manual')`; it no longer writes device storage. Add `onBusyChange` to `AudioCapture` and report `phase !== 'idle'` through it. Bubble that callback and Ambient Capture's existing `onLiveChange` through `onCaptureBusyChange` so the hero settings button is temporarily disabled while unsent audio is owned by a recorder, worker, upload, or stream.

- [ ] **Step 6: Run focused UI tests and verify GREEN**

Run: `bun run --cwd frontend test -- src/review/ConsultationSettingsDialog.test.tsx src/routes/ConsultationReview.test.tsx src/routes/CapturePanel.test.tsx`

Expected: all suites pass with no React warnings.

- [ ] **Step 7: Commit the settings experience**

```bash
git add frontend/src/review frontend/src/routes/ConsultationReview.tsx frontend/src/routes/ConsultationReview.test.tsx frontend/src/routes/CapturePanel.tsx frontend/src/routes/CapturePanel.test.tsx frontend/src/audio/AudioCapture.tsx frontend/src/audio/AudioCapture.test.tsx
git commit -m "feat(consultations): move settings into the hero"
```

---

### Task 5: Add Pause And Resume To Press To Record

**Files:**

- Modify: `frontend/src/audio/AudioCapture.tsx`
- Modify: `frontend/src/audio/AudioCapture.test.tsx`
- Modify: `frontend/src/audio/live/AmbientCapture.test.tsx`

**Interfaces:**

- Changes: manual `Phase` gains `paused`.
- Preserves: `AudioCapture` busy-state reporting added in Task 4.
- Preserves: one `MediaRecorder`, one stream, one chunk list, and one prewarmed worker across pause and resume.

- [ ] **Step 1: Extend the fake recorder and write failing pause tests**

Give `FakeMediaRecorder.state` the real union and drive its methods:

```ts
state: RecordingState = 'inactive'
pause = vi.fn(() => {
  this.state = 'paused'
})
resume = vi.fn(() => {
  this.state = 'recording'
})
```

Add tests proving:

- Pause Recording calls `pause`, displays `Paused`, and replaces itself with Resume Recording.
- Advancing fake timers while paused leaves the elapsed clock unchanged.
- Resume Recording calls `resume` and the clock continues from the frozen value.
- Stop and Transcribe from paused state uses the same recorder and transcribes its accumulated chunk.
- No Pause Recording control exists in `AmbientCapture.test.tsx`.

- [ ] **Step 2: Run the focused recorder tests and verify RED**

Run: `bun run --cwd frontend test -- src/audio/AudioCapture.test.tsx src/audio/live/AmbientCapture.test.tsx`

Expected: FAIL because the pause/resume controls and `paused` phase do not exist.

- [ ] **Step 3: Implement the paused phase and controls**

Add guarded handlers:

```ts
const pause = useCallback(() => {
  const media = recorder.current
  if (media?.state !== 'recording') return
  media.pause()
  setPhase('paused')
}, [])

const resume = useCallback(() => {
  const media = recorder.current
  if (media?.state !== 'paused') return
  media.resume()
  setPhase('recording')
}, [])
```

Render the same recording card for `recording` and `paused`. Freeze the existing timer naturally by keeping its interval conditional on `phase === 'recording'`. Keep Stop and Transcribe available in both states, replace the pulse with `Paused`, and show the visible sentence `Audio is not being added until recording resumes.`

Report all non-idle phases through `onBusyChange`, including paused and post-stop transcription phases. Ensure unmount cleanup stops a paused recorder without invoking its transcription callback.

- [ ] **Step 4: Run focused recorder and capture tests and verify GREEN**

Run: `bun run --cwd frontend test -- src/audio/AudioCapture.test.tsx src/audio/live/AmbientCapture.test.tsx src/routes/CapturePanel.test.tsx`

Expected: all tests pass; Ambient remains unchanged.

- [ ] **Step 5: Commit pause and resume**

```bash
git add frontend/src/audio/AudioCapture.tsx frontend/src/audio/AudioCapture.test.tsx frontend/src/audio/live/AmbientCapture.test.tsx frontend/src/routes/CapturePanel.tsx frontend/src/routes/CapturePanel.test.tsx
git commit -m "feat(audio): pause manual recording"
```

---

### Task 6: Document, Review, Verify, And Update PR #272

**Files:**

- Modify: `docs/trd.md`
- Modify: `docs/superpowers/plans/2026-09-07-consultation-settings-and-recording-pause.md`
- Modify: `docs/README.md` only if the external product narrative needs the new setting location.

**Interfaces:**

- Produces: developer-facing contract for per-consultation Capture Mode, transcript locking, device-setting separation, and manual pause behavior.
- Produces: updated PR #272 and a Vercel preview built from a clean archive of the final PR commit.

- [ ] **Step 1: Update canonical documentation**

Update the Consultation data table, PATCH contract, migration description, capture-mode ownership, Audio Settings description, and manual recording state machine in `docs/trd.md`. Keep migration ordering explicit.

- [ ] **Step 2: Format and run static verification**

Run: `bun run lint`

Run: `bun run typecheck`

Run: `bunx prettier --check docs/trd.md docs/superpowers/specs/2026-09-07-consultation-settings-and-recording-pause-design.md docs/superpowers/plans/2026-09-07-consultation-settings-and-recording-pause.md`

Expected: all commands pass, apart from already documented unrelated repository-wide lint warnings.

- [ ] **Step 3: Run complete behavioral verification**

Run: `bun run test`

Run: `bun run build`

Expected: all workspace tests and both production builds pass.

- [ ] **Step 4: Run UI and safety audits**

Run: `npx react-doctor@latest . --verbose --scope changed`

Run: `npx impeccable detect`

Run: `bun run --cwd backend test -- src/lib/logger.leak.test.ts src/lib/llm/no-stray-provider-sdk.test.ts src/acceptance/safety.test.ts`

Expected: no new actionable UI findings, no Impeccable findings, no note content in logs, and no provider-egress change.

- [ ] **Step 5: Commit documentation and verification updates**

```bash
git add docs/trd.md docs/superpowers/plans/2026-09-07-consultation-settings-and-recording-pause.md
git commit -m "docs: document consultation settings"
```

- [ ] **Step 6: Review and update the existing PR**

Review `origin/main...HEAD`, confirm generated Graphify files are excluded, push `feat/222-malaysian-note-template`, and update PR #272 to describe the hero settings dialog, per-consultation Capture Mode, and manual pause/resume. Retain the migration and clinical-safety checklists.

- [ ] **Step 7: Replace the preview deployment**

Create a clean archive from final `HEAD` outside the parent checkout, deploy it to the existing Vercel project, verify the deployment reaches `Ready`, and add the exact replacement preview URL to PR #272. Do not reuse the earlier parent-checkout deployment.
