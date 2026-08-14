import {
  type ConsultationAnalysis,
  ConsultationAnalysisSchema,
  type ConsultationDetail,
  ConsultationDetailSchema,
  type ConsultationListItem,
  ConsultationListItemSchema,
  type DispositionInput,
  type EraseConsultationsResult,
  EraseConsultationsResultSchema,
  ErrorEnvelopeSchema,
  type Fixture,
  FixtureSchema,
  type GuidelineChunk,
  GuidelineChunkSchema,
  type SoapNote,
  type Transcript,
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
const FixturesEnvelope = z.object({ fixtures: z.array(FixtureSchema) })
const GuidelinesEnvelope = z.object({ guidelines: z.array(GuidelineChunkSchema) })

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

  listConsultations: (): Promise<ConsultationListItem[]> =>
    request('/consultations', ListEnvelope).then((r) => r.consultations),

  getConsultation: (id: string): Promise<ConsultationDetail> =>
    request(`/consultations/${id}`, ConsultationEnvelope).then((r) => r.consultation),

  createConsultation: (transcript: Transcript): Promise<ConsultationDetail> =>
    request('/consultations', ConsultationEnvelope, {
      method: 'POST',
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
      editedNote?: Partial<SoapNote>
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

  history: (id: string): Promise<AuditEvent[]> =>
    request(`/consultations/${id}/history`, HistoryEnvelope).then((r) => r.events),

  fixtures: (): Promise<Fixture[]> =>
    request('/fixtures', FixturesEnvelope).then((r) => r.fixtures),

  guidelines: (): Promise<GuidelineChunk[]> =>
    request('/guidelines', GuidelinesEnvelope).then((r) => r.guidelines),

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
