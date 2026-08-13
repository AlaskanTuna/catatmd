import {
  type ConsultationDetail,
  ConsultationDetailSchema,
  type ConsultationListItem,
  ConsultationListItemSchema,
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

  patch: (
    id: string,
    body: {
      editedNote?: Partial<SoapNote>
      acknowledgedRedFlagIds?: string[]
      reviewedGapIds?: string[]
    },
  ): Promise<ConsultationDetail> =>
    request(`/consultations/${id}`, ConsultationEnvelope, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then((r) => r.consultation),

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
}
