import {
  type CaptureMode,
  type ConsultationAnalysis,
  ConsultationAnalysisSchema,
  type ConsultationDetail,
  ConsultationDetailSchema,
  type ConsultationListItem,
  ConsultationListItemSchema,
  type CreatePatientInput,
  type DispositionInput,
  type DraftTurn,
  DraftTurnsResponseSchema,
  type EraseConsultationsResult,
  EraseConsultationsResultSchema,
  type ErasePatientResult,
  ErasePatientResultSchema,
  ErrorEnvelopeSchema,
  type Fixture,
  FixtureSchema,
  type GuidelineChunk,
  GuidelineChunkSchema,
  type GuidelineDocument,
  GuidelineDocumentSchema,
  type HostedAsrResult,
  HostedAsrResultSchema,
  type LiveAnalysisResponse,
  LiveAnalysisResponseSchema,
  type LiveAnalysisState,
  type LiveAsrConfig,
  LiveAsrConfigSchema,
  LiveFlagsResponseSchema,
  type LiveSession,
  LiveSessionSchema,
  type MedicalRecordNote,
  type MishearProposal,
  type NoteTemplate,
  type NotificationItem,
  NotificationItemSchema,
  type Patient,
  type PatientDetail,
  PatientDetailSchema,
  type PatientListItem,
  PatientListItemSchema,
  PatientSchema,
  type RedFlag,
  type SoapNote,
  type Transcript,
  TranscriptCorrectionsResponseSchema,
  type UpdatePatientInput,
} from '@shared/types'
import { z } from 'zod'

/**
 * Dev proxies `/api` to the API on :3001; production points at the Render
 * origin. Cross-site in production, so `credentials: 'include'` is not
 * optional: the session cookie is `SameSite=None` and is simply not sent
 * without it (docs/trd.md §13).
 */
const BASE = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(payload)
    throw new ApiError(
      response.status,
      envelope.success ? envelope.data.error.code : 'unknown',
      envelope.success ? envelope.data.error.message : 'Something went wrong.',
    )
  }

  // Parsed, never partially trusted. A response that does not match the shared
  // contract is a bug worth surfacing, not something to render optimistically.
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(response.status, 'invalid_response', 'The API returned unexpected data.')
  }
  return parsed.data
}

const ConsultationEnvelope = z.object({ consultation: ConsultationDetailSchema })
const ListEnvelope = z.object({ consultations: z.array(ConsultationListItemSchema) })
const PatientListEnvelope = z.object({ patients: z.array(PatientListItemSchema) })
const PatientEnvelope = z.object({ patient: PatientSchema })
const PatientDetailEnvelope = z.object({ patient: PatientDetailSchema })
const ErasePatientEnvelope = z.object({ erasure: ErasePatientResultSchema })
const FixturesEnvelope = z.object({ fixtures: z.array(FixtureSchema) })
const GuidelinesEnvelope = z.object({ guidelines: z.array(GuidelineChunkSchema) })
const GuidelineDocumentsEnvelope = z.object({ documents: z.array(GuidelineDocumentSchema) })
const NotificationsEnvelope = z.object({ notifications: z.array(NotificationItemSchema) })

/**
 * Audit events, read only for the provenance stamp on the review screen.
 * `AuditEvent` is append-only and therefore the authority for what produced a
 * note; `analysis` is overwritten on re-analysis and is not (issue #31).
 */
const AuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  createdAt: z.coerce.date(),
  metadata: z.unknown().nullable().optional(),
})
const HistoryEnvelope = z.object({ events: z.array(AuditEventSchema) })

export type AuditEvent = z.infer<typeof AuditEventSchema>

export const api = {
  session: () =>
    request(
      '/auth/get-session',
      z
        .object({ user: z.object({ id: z.string(), email: z.string(), name: z.string() }) })
        .nullable(),
    ),

  signInGuest: () => request('/auth/guest', z.object({ ok: z.boolean() }), { method: 'POST' }),

  signIn: (email: string, password: string) =>
    request('/auth/sign-in/email', z.unknown(), {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signUp: (email: string, password: string, name: string) =>
    request('/auth/sign-up/email', z.unknown(), {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  signOut: () => request('/auth/sign-out', z.unknown(), { method: 'POST' }),

  listPatients: (): Promise<PatientListItem[]> =>
    request('/patients', PatientListEnvelope).then((r) => r.patients),

  createPatient: (body: CreatePatientInput): Promise<Patient> =>
    request('/patients', PatientEnvelope, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.patient),

  getPatient: (id: string): Promise<PatientDetail> =>
    request(`/patients/${id}`, PatientDetailEnvelope).then((r) => r.patient),

  patchPatient: (id: string, body: UpdatePatientInput): Promise<Patient> =>
    request(`/patients/${id}`, PatientEnvelope, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then((r) => r.patient),

  /**
   * Erases one patient record and every consultation filed under it.
   *
   * One id per call, matching the route: the cascade makes a single erasure
   * heavier than a consultation batch, and the server appends to the audit hash
   * chain per record, so a caller erasing several sends them one at a time.
   *
   * Resolves with the consultation ids that went with the patient, which is the
   * only way a caller can report the real blast radius after the fact.
   */
  erasePatient: (id: string): Promise<ErasePatientResult> =>
    request(`/patients/${id}/erase`, ErasePatientEnvelope, { method: 'POST' }).then(
      (r) => r.erasure,
    ),

  listConsultations: (): Promise<ConsultationListItem[]> =>
    request('/consultations', ListEnvelope).then((r) => r.consultations),

  getConsultation: (id: string): Promise<ConsultationDetail> =>
    request(`/consultations/${id}`, ConsultationEnvelope).then((r) => r.consultation),

  /**
   * Creates the record, optionally with a transcript already in hand.
   *
   * Both halves are used: a consultation is normally opened empty from a
   * patient profile and captured into afterwards, but the demo tour and any
   * caller holding a complete transcript can still supply one up front.
   */
  createConsultation: (transcript?: Transcript, patientId?: string): Promise<ConsultationDetail> =>
    request('/consultations', ConsultationEnvelope, {
      method: 'POST',
      body: JSON.stringify({
        ...(transcript ? { transcript } : {}),
        ...(patientId ? { patientId } : {}),
      }),
    }).then((r) => r.consultation),

  /** Captures into a record that already exists. Only valid while it is `draft`. */
  setTranscript: (id: string, transcript: Transcript): Promise<ConsultationDetail> =>
    request(`/consultations/${id}`, ConsultationEnvelope, {
      method: 'PATCH',
      body: JSON.stringify({ transcript }),
    }).then((r) => r.consultation),

  analyze: (id: string): Promise<ConsultationDetail> =>
    request(`/consultations/${id}/analyze`, ConsultationEnvelope, { method: 'POST' }).then(
      (r) => r.consultation,
    ),

  /**
   * Runs the real pipeline and persists nothing (issue #80).
   *
   * The whole gate runs: de-identification, the model call, the deterministic
   * rules engine, the evidence check. What it does not do is write a
   * `Consultation` or an `AuditEvent` carrying one, which is what makes Demo
   * Mode self-contained: there is no row to wipe when the tour ends, so the
   * cleanup problem never arises.
   *
   * That mattered because cleanup is not available. Issue #64 moved
   * `AuditEvent` to `onDelete: Restrict` so a delete cannot silently break the
   * tamper-evident hash chain, and the tombstone erasure replacing it has no
   * HTTP endpoint pending a retention decision. Creating rows the client could
   * not remove would have been worse than creating none.
   *
   * It sits under `/consultations` rather than at `/analyze` because
   * `requireSession` is mounted per prefix in `app.ts`: a new top-level prefix
   * would be unauthenticated by default.
   */
  analyzeEphemeral: (transcript: Transcript, profileId?: string): Promise<ConsultationAnalysis> =>
    request(
      '/consultations/analyze-ephemeral',
      z.object({ analysis: ConsultationAnalysisSchema }),
      {
        method: 'POST',
        body: JSON.stringify(profileId ? { transcript, profileId } : { transcript }),
      },
    ).then((r) => r.analysis),

  patch: (
    id: string,
    body: {
      title?: string | null
      editedNote?: Partial<SoapNote>
      editedMedicalRecordNote?: Partial<MedicalRecordNote>
      noteTemplate?: NoteTemplate
      captureMode?: CaptureMode
      acknowledgedRedFlagIds?: string[]
      reviewedGapIds?: string[]
      redFlagDispositions?: DispositionInput[]
      gapDispositions?: DispositionInput[]
    },
  ): Promise<ConsultationDetail> =>
    request(`/consultations/${id}`, ConsultationEnvelope, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then((r) => r.consultation),

  /**
   * Erases a selection (issue #114). A tombstone, not a delete: the clinical
   * content goes, the audit chain that references the consultation stays, so
   * the row cannot be removed without breaking tamper evidence.
   *
   * Partial success is normal rather than exceptional, so this resolves with
   * both lists instead of rejecting when some ids do not land.
   */
  eraseConsultations: (ids: string[]): Promise<EraseConsultationsResult> =>
    request('/consultations/erase', EraseConsultationsResultSchema, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  approve: (id: string): Promise<ConsultationDetail> =>
    request(`/consultations/${id}/approve`, ConsultationEnvelope, { method: 'POST' }).then(
      (r) => r.consultation,
    ),

  /**
   * Stores the consultation recording, so the doctor can still check a sentence
   * against it after the tab has been closed (#293).
   *
   * Raw bytes rather than JSON, because base64 would inflate a 25 MB recording
   * past the route's own cap for nothing. The header override is deliberate:
   * `request` defaults a body to `application/json`, and the route refuses
   * anything that is not `audio/*`.
   *
   * Failure is not surfaced to the doctor. The transcript is already saved by
   * this point, and a recording that did not store costs them the ability to
   * play a sentence back, not the consultation. A banner here would report a
   * problem they cannot act on in the middle of the work that matters.
   */
  putConsultationAudio: (id: string, recording: Blob): Promise<{ expiresAt: Date }> =>
    request(`/consultations/${id}/audio`, z.object({ expiresAt: z.coerce.date() }), {
      method: 'PUT',
      body: recording,
      headers: { 'Content-Type': recording.type || 'audio/webm' },
    }),

  /**
   * Fetches the stored recording, or null when there is none to fetch.
   *
   * Bespoke rather than routed through `request`, which parses every response
   * as JSON: this one is audio. A 404 is the ordinary answer, not an error,
   * because it covers both "never recorded" and "the retention window closed",
   * and neither is something to raise to a doctor reading a transcript.
   */
  getConsultationAudio: async (id: string): Promise<Blob | null> => {
    const response = await fetch(`${BASE}/api/consultations/${id}/audio`, {
      credentials: 'include',
    })
    if (response.status === 404) return null
    if (!response.ok) throw new ApiError(response.status, 'audio_failed', 'Could not load audio.')
    return response.blob()
  },

  history: (id: string): Promise<AuditEvent[]> =>
    request(`/consultations/${id}/history`, HistoryEnvelope).then((r) => r.events),

  fixtures: (): Promise<Fixture[]> =>
    request('/fixtures', FixturesEnvelope).then((r) => r.fixtures),

  /**
   * Relays one consultation recording to the hosted ASR path (issue #155).
   *
   * **The only call site needs two keys**: the device's hosted engine
   * preference, and an explicit per-consultation consent tick on the Record tab
   * (#254). The default path transcribes on the device and sends no audio
   * anywhere, so this function existing is not the same as it being reachable:
   * nothing calls it unless a doctor ticked the box for that consultation.
   *
   * `Content-Type` carries the recorder's own container type rather than a
   * guess, because that is what the relay's `express.raw({ type: 'audio/*' })`
   * matches on; a blob with no type is refused upstream with a 415 rather than
   * relabelled here into something it might not be.
   *
   * The signal is both the doctor's Cancel and the client-side upload bound.
   */
  transcribeHostedAsr: (blob: Blob, signal: AbortSignal): Promise<HostedAsrResult> =>
    request('/asr/transcriptions', HostedAsrResultSchema, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type },
      signal,
    }),

  /**
   * Drafts Doctor / Patient labels for a hosted transcript (#189).
   *
   * **Only ever called with text the relay above just returned**, so it sends
   * nothing that has not already left the device with consent. The on-device
   * path never calls this: its labels are drafted locally in
   * `audio/draft-turns.ts`, and a local recording's text going to any server
   * would break the Record tab's own promise. The backend de-identifies the
   * text before its LLM sees it and rejects any draft that fails to
   * reconstruct the input verbatim; a failure here is answered by falling
   * back to the unlabelled prose the caller already holds.
   */
  draftHostedTurns: (text: string, signal: AbortSignal): Promise<DraftTurn[]> =>
    request('/asr/draft-turns', DraftTurnsResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal,
    }).then((r) => r.turns),

  /**
   * Where ambient capture would send audio, and in which languages (#268).
   *
   * Read before anything is minted, because the consent copy has to name the
   * provider and the region before the doctor decides. Answers 503 on a
   * deployment with no ambient provider configured, which the capture surface
   * shows as a plain unavailability with a way back to Press To Record.
   */
  liveAsrConfig: (): Promise<LiveAsrConfig> =>
    request('/asr/live-sessions/config', LiveAsrConfigSchema),

  /**
   * Mints the short-lived key the browser uses to open its own recognition
   * stream (#268).
   *
   * **Only ever called once the patient has agreed and the microphone is
   * open.** The asserted consent in the body is what the API records; the gate
   * itself is the tick in `AmbientCapture`, which is remembered by nothing.
   *
   * The returned key authenticates one connection for about a minute and caps
   * the session it opens. It lives in the component's closure for the length
   * of one consultation and is never stored.
   */
  createLiveSession: (signal: AbortSignal): Promise<LiveSession> =>
    request('/asr/live-sessions', LiveSessionSchema, {
      method: 'POST',
      body: JSON.stringify({ consent: true }),
      signal,
    }),

  /**
   * The deterministic live pane: red flags over one window of a running
   * ambient consultation (#219).
   *
   * Runs no model, so it is the surface that can feel immediate. Called on
   * every closed segment, which is why it has a limiter of its own and why the
   * caller drops a cycle rather than queueing when one is already in flight.
   */
  liveFlags: (consultationId: string, delta: Transcript, signal: AbortSignal): Promise<RedFlag[]> =>
    request(`/consultations/${consultationId}/live-flags`, LiveFlagsResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ delta }),
      signal,
    }).then((r) => r.redFlags),

  /**
   * Suspected mishears in the stored transcript, for the doctor to judge (#308).
   *
   * Read-only despite the POST: it derives from a transcript the server already
   * holds and writes nothing. Accepting one is a plain `setTranscript` above,
   * which is why there is no accept call here to pair with it.
   */
  transcriptCorrections: (id: string): Promise<MishearProposal[]> =>
    request(`/consultations/${id}/transcript-corrections`, TranscriptCorrectionsResponseSchema, {
      method: 'POST',
    }).then((r) => r.proposals),

  /**
   * The model-backed live panes: the patient card and the missing-information
   * checklist (#219).
   *
   * **`previous` is the whole of what the last cycle returned, handed straight
   * back.** The running transcript is deliberately not part of it: the API
   * folds the delta into the previous state rather than re-reading the
   * consultation, so each cycle costs one window rather than a growing
   * transcript (docs/trd.md §20.8).
   */
  liveAnalysis: (
    consultationId: string,
    delta: Transcript,
    previous: LiveAnalysisState | null,
    signal: AbortSignal,
  ): Promise<LiveAnalysisResponse> =>
    request(`/consultations/${consultationId}/live-analysis`, LiveAnalysisResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ delta, previous }),
      signal,
    }),

  /**
   * The doctor's own recent completed work, derived from `AuditEvent` (#116).
   * Carries an id, an action enum and a consultation id, never free text.
   */
  notifications: (): Promise<NotificationItem[]> =>
    request('/notifications', NotificationsEnvelope).then((r) => r.notifications),

  /**
   * Hides the feed. Deletes nothing: it moves a per-user cursor, and every
   * audit row it stops showing is still in the append-only log.
   */
  clearNotifications: () => request('/notifications/clear', z.null(), { method: 'POST' }),

  guidelines: (): Promise<GuidelineChunk[]> =>
    request('/guidelines', GuidelinesEnvelope).then((r) => r.guidelines),

  guidelineDocuments: (): Promise<GuidelineDocument[]> =>
    request('/guidelines/documents', GuidelineDocumentsEnvelope).then((r) => r.documents),

  /**
   * `database` is absent in production by design, so a missing field must be
   * read as "no warning to give", never as a failure to check.
   */
  health: () =>
    request(
      '/health',
      z.object({
        status: z.string(),
        provider: z.string().optional(),
        database: z.enum(['local', 'remote', 'unreachable']).optional(),
      }),
    ),
}
