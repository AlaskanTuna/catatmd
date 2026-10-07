import {
  CaptureModeSchema,
  type ConsultationAnalysis,
  ConsultationAnalysisSchema,
  type ConsultationDetail,
  ConsultationDetailSchema,
  type ConsultationListItem,
  ConsultationTitleSchema,
  CreatePatientInputSchema,
  DEMO_PLAN,
  type Disposition,
  type DispositionInput,
  DispositionInputSchema,
  EraseConsultationsInputSchema,
  type GuidelineDocument,
  LiveAnalysisStateSchema,
  MAX_LIVE_DELTA_CHARACTERS,
  MAX_LIVE_DELTA_TURNS,
  MAX_PRESCRIPTIONS,
  MAX_TRANSCRIPT_TURNS,
  type MedicalRecordNote,
  MedicalRecordNoteSchema,
  NOTIFICATION_FEED_LIMIT,
  NoteTemplateSchema,
  NotificationActionSchema,
  type NotificationItem,
  type Patient,
  type PatientListItem,
  PatientSchema,
  PrescriptionParseResponseSchema,
  PrescriptionSchema,
  RetentionPolicySchema,
  SoapNoteSchema,
  type Transcript,
  TranscriptSchema,
  toSoapNote,
  UpdatePatientInputSchema,
} from '@shared/types'
import { z } from 'zod'
import type { AuditEvent } from '../lib/api.js'
import {
  ALL_REDFLAG_TRIGGERS,
  evaluateRedFlags,
  FIXTURES,
  matchMedication,
  parseSigWithSpan,
  proposeMishearCorrections,
  scoresFor,
} from './engines.js'

/**
 * The API, answered in the browser for pull request previews.
 *
 * Every rule a doctor can observe is kept: the same state machine, the same
 * 404 for an erased record, approval only from review and only by an explicit
 * call. What is not kept is anything that needs a server: there is no model,
 * no recogniser, no recording store and no database, and each of those answers
 * the way a deployment without it does rather than pretending to have one.
 */

const PROFILE_ID = 'adult-acute-urti'
const URTI_TRIGGERS = ALL_REDFLAG_TRIGGERS.filter((trigger) =>
  trigger.profiles.includes(PROFILE_ID),
)

const PLACEHOLDER = 'Preview placeholder: no model runs in preview deployments.'

const DOCTOR = { id: 'preview-doctor', email: 'preview@example.invalid', name: 'Dr Preview' }

type StoredConsultation = Omit<ConsultationDetail, 'approvedBy' | 'patient'> & {
  patientId: string | null
  erasedAt: Date | null
}

type StoredEvent = AuditEvent & { consultationId: string | null }

class StubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } })

const conflict = (message: string) => new StubError(409, 'invalid_state', message)

function parse<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new StubError(400, 'invalid_body', message)
  return parsed.data
}

/**
 * Red flags from the real engine, and a note that says plainly it was not
 * written. Gaps and suggestions stay empty because both come from the model
 * pass, and the facts that would make the checklist meaningful are omitted so
 * the review screen reads them as not recorded rather than as all unassessed.
 */
function previewAnalysis(transcript: Transcript): ConsultationAnalysis {
  const medicalRecordNote: MedicalRecordNote = {
    presentingComplaint: PLACEHOLDER,
    historyOfPresentingComplaint: PLACEHOLDER,
    pastMedicalHistory: PLACEHOLDER,
    socialHistory: PLACEHOLDER,
    familyHistory: PLACEHOLDER,
    objective: PLACEHOLDER,
    assessment: PLACEHOLDER,
    plan: PLACEHOLDER,
  }
  return ConsultationAnalysisSchema.parse({
    note: toSoapNote(medicalRecordNote),
    medicalRecordNote,
    gaps: [],
    redFlags: evaluateRedFlags(transcript, URTI_TRIGGERS),
    suggestions: [],
    scores: scoresFor(transcript, PROFILE_ID),
  })
}

const LiveDeltaSchema = TranscriptSchema.refine(
  (delta) =>
    delta.turns.length <= MAX_LIVE_DELTA_TURNS &&
    delta.turns.reduce((sum, turn) => sum + turn.text.length, 0) <= MAX_LIVE_DELTA_CHARACTERS,
)

const PatchBodySchema = z
  .object({
    title: ConsultationTitleSchema.optional(),
    transcript: TranscriptSchema.optional(),
    editedNote: SoapNoteSchema.partial().optional(),
    editedMedicalRecordNote: MedicalRecordNoteSchema.partial().optional(),
    prescriptions: z.array(PrescriptionSchema).max(MAX_PRESCRIPTIONS).optional(),
    noteTemplate: NoteTemplateSchema.optional(),
    captureMode: CaptureModeSchema.optional(),
    acknowledgedRedFlagIds: z.array(z.string()).optional(),
    reviewedGapIds: z.array(z.string()).optional(),
    redFlagDispositions: z.array(DispositionInputSchema).optional(),
    gapDispositions: z.array(DispositionInputSchema).optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine((body) => body.transcript === undefined || Object.keys(body).length === 1)
  .refine((body) => body.editedNote === undefined || body.editedMedicalRecordNote === undefined)

function applyDispositions(
  stored: Disposition[],
  incoming: DispositionInput[],
  decidedAt: Date,
): Disposition[] {
  const next = new Map(stored.map((entry) => [entry.id, entry] as const))
  for (const decision of incoming) next.set(decision.id, { ...decision, decidedAt })
  return [...next.values()]
}

const SEED_PATIENTS = [
  { name: 'Kamal', nric: null, age: null, gender: 'male' },
  { name: 'Salmah binti Yusof', nric: null, age: null, gender: 'female' },
  { name: 'Ahmad bin Ismail', nric: '850523-14-5677', age: 41, gender: 'male' },
  { name: 'Aisha Rahman', nric: null, age: 36, gender: 'female' },
] as const

/** Which seeded patient each demo fixture is filed under, and the name it carries. */
const SEED_FILING: Readonly<Record<string, { patient?: string; title: string | null }>> = {
  'urti-gap-heavy': { patient: 'Kamal', title: 'Cough, sore throat and fever' },
  'urti-hard-red-flag': { patient: 'Salmah binti Yusof', title: 'Severe sore throat with stridor' },
  'urti-diagnosis-not-assessed': { title: 'Cough and sore throat' },
  'urti-identifier-dense-routine': { patient: 'Ahmad bin Ismail', title: 'Routine URTI review' },
  'urti-hard-uncertain': { title: null },
}

const HOUR = 60 * 60 * 1000

export function createPreviewBackend() {
  const consultations = new Map<string, StoredConsultation>()
  const patients = new Map<string, Patient>()
  const events: StoredEvent[] = []
  let signedIn = true
  let clearedAt = 0
  let adoptedYears: number | null = null
  let sequence = 0

  // Distinct in the first eight characters, which is what the list shows of an id.
  const nextId = (kind: string) => {
    sequence += 1
    return `pv${String(sequence).padStart(4, '0')}-${kind}`
  }

  const record = (action: string, consultationId: string | null, at = new Date()) => {
    events.push({ id: nextId('event'), action, consultationId, createdAt: at })
  }

  const ownedConsultation = (id: string) => {
    const row = consultations.get(id)
    if (row === undefined || row.erasedAt !== null) {
      throw new StubError(404, 'not_found', 'Consultation not found.')
    }
    return row
  }

  const ownedPatient = (id: string) => {
    const row = patients.get(id)
    if (row === undefined || row.erasedAt !== null) {
      throw new StubError(404, 'not_found', 'Patient not found.')
    }
    return row
  }

  const live = () => [...consultations.values()].filter((row) => row.erasedAt === null)

  const detail = (row: StoredConsultation): ConsultationDetail => {
    const patient = row.patientId === null ? undefined : patients.get(row.patientId)
    return ConsultationDetailSchema.parse({
      ...row,
      approvedBy: row.approvedAt === null ? null : DOCTOR.name,
      patient:
        patient === undefined || patient.erasedAt !== null
          ? null
          : { id: patient.id, name: patient.name },
    })
  }

  const listItem = (row: StoredConsultation): ConsultationListItem => ({
    id: row.id,
    status: row.status,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

  const byUpdatedDesc = (a: { updatedAt: Date }, b: { updatedAt: Date }) =>
    b.updatedAt.getTime() - a.updatedAt.getTime()

  const eraseConsultation = (row: StoredConsultation) => {
    const tombstone: Partial<StoredConsultation> = {
      title: null,
      transcript: null,
      analysis: null,
      editedNote: null,
      editedMedicalRecordNote: null,
      prescriptions: null,
      erasedAt: new Date(),
    }
    Object.assign(row, tombstone)
    record('consultation.erased', row.id)
  }

  const createConsultation = (
    transcript: Transcript | undefined,
    patientId: string | null,
    at = new Date(),
  ): StoredConsultation => {
    const row: StoredConsultation = {
      id: nextId('consultation'),
      status: 'draft',
      noteTemplate: 'soap',
      captureMode:
        transcript === undefined || transcript.source === 'asr_live' ? 'ambient' : 'manual',
      title: null,
      createdAt: at,
      updatedAt: at,
      transcript: transcript ?? null,
      analysis: null,
      editedNote: null,
      editedMedicalRecordNote: null,
      prescriptions: null,
      approvedAt: null,
      acknowledgedRedFlagIds: [],
      reviewedGapIds: [],
      redFlagDispositions: [],
      gapDispositions: [],
      patientId,
      erasedAt: null,
    }
    consultations.set(row.id, row)
    record('consultation.created', row.id, at)
    return row
  }

  const createPatient = (input: z.infer<typeof CreatePatientInputSchema>, at = new Date()) => {
    const stamp = at.toISOString()
    const patient = PatientSchema.parse({
      id: nextId('patient'),
      name: input.name,
      nric: input.nric ?? null,
      age: input.age ?? null,
      gender: input.gender ?? null,
      erasedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    })
    patients.set(patient.id, patient)
    return patient
  }

  const analyse = (row: StoredConsultation, at = new Date()) => {
    if (row.status === 'approved') {
      throw conflict('Analysis cannot start while the consultation is approved.')
    }
    if (row.status === 'analyzing') {
      throw conflict('Analysis is already running for this consultation.')
    }
    const transcript = TranscriptSchema.safeParse(row.transcript)
    if (!transcript.success) throw conflict('This consultation has no usable transcript.')

    record('consultation.analysis_started', row.id, at)
    row.analysis = previewAnalysis(transcript.data)
    row.status = 'awaiting_review'
    row.updatedAt = at
    record('consultation.analysis_completed', row.id, at)
  }

  /*
   * The approval transition, and the only route into `approved`. Seeding goes
   * through it too, so no record reaches that state by any other path.
   */
  const approve = (row: StoredConsultation, at = new Date()) => {
    if (row.status !== 'awaiting_review') {
      throw conflict(
        row.status === 'approved'
          ? 'This consultation is already approved.'
          : 'Only a consultation awaiting review can be approved.',
      )
    }
    if (row.analysis === null) throw conflict('This consultation has no analysis to approve.')
    row.status = 'approved'
    row.approvedAt = at
    row.updatedAt = at
    record('consultation.approved', row.id, at)
  }

  const seed = () => {
    const start = Date.now()
    const byName = new Map<string, Patient>(
      SEED_PATIENTS.map((input, index) => [
        input.name,
        createPatient(input, new Date(start - (10 - index) * 24 * HOUR)),
      ]),
    )

    DEMO_PLAN.forEach(({ fixtureId, target }, index) => {
      const fixture = FIXTURES.find((candidate) => candidate.id === fixtureId)
      if (fixture === undefined) return
      const filing = SEED_FILING[fixtureId]
      const opened = new Date(start - (DEMO_PLAN.length - index) * 7 * HOUR)
      const patientId =
        filing?.patient === undefined ? null : (byName.get(filing.patient)?.id ?? null)

      const row = createConsultation(fixture.transcript, patientId, opened)
      row.title = filing?.title ?? null
      if (target === 'draft') return
      analyse(row, new Date(opened.getTime() + 0.2 * HOUR))
      if (target === 'approved') approve(row, new Date(opened.getTime() + 0.5 * HOUR))
    })
  }

  const patchConsultation = (row: StoredConsultation, body: unknown) => {
    const patch = parse(PatchBodySchema, body, 'No valid changes supplied.')
    const presentationOnly = Object.keys(patch).every(
      (key) => key === 'title' || key === 'noteTemplate' || key === 'captureMode',
    )

    if (patch.captureMode !== undefined && row.transcript !== null) {
      throw conflict('Capture Mode is locked after transcript capture.')
    }

    if (patch.transcript !== undefined) {
      if (row.status !== 'draft') {
        throw conflict('The transcript can only be set before the consultation is analysed.')
      }
      row.transcript = patch.transcript
      if (patch.transcript.source !== 'asr_live') row.captureMode = 'manual'
      row.updatedAt = new Date()
      record('consultation.edited', row.id)
      return
    }

    if (!presentationOnly && row.status !== 'awaiting_review') {
      throw conflict(
        row.status === 'approved'
          ? 'An approved consultation is final and cannot be edited.'
          : 'This consultation is not open for review.',
      )
    }

    let editedNote = row.editedNote
    let editedMedicalRecordNote = row.editedMedicalRecordNote
    if (patch.editedMedicalRecordNote !== undefined) {
      const merged = MedicalRecordNoteSchema.safeParse({
        ...(row.editedMedicalRecordNote ?? row.analysis?.medicalRecordNote),
        ...patch.editedMedicalRecordNote,
      })
      if (!merged.success) throw conflict('This consultation has no categorized note to edit yet.')
      editedMedicalRecordNote = merged.data
      editedNote = toSoapNote(merged.data)
    }
    if (patch.editedNote !== undefined) {
      if (row.analysis?.medicalRecordNote !== undefined) {
        throw conflict('This categorized note must be edited by category.')
      }
      const merged = SoapNoteSchema.safeParse({
        ...(row.editedNote ?? row.analysis?.note),
        ...patch.editedNote,
      })
      if (!merged.success) throw conflict('This consultation has no note to edit yet.')
      editedNote = merged.data
    }

    const decidedAt = new Date()
    const changes: Partial<StoredConsultation> = {
      editedNote,
      editedMedicalRecordNote,
      updatedAt: decidedAt,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.noteTemplate === undefined ? {} : { noteTemplate: patch.noteTemplate }),
      ...(patch.captureMode === undefined ? {} : { captureMode: patch.captureMode }),
      ...(patch.prescriptions === undefined ? {} : { prescriptions: patch.prescriptions }),
      // Additive, as on the server: an acknowledgement is never withdrawn.
      ...(patch.acknowledgedRedFlagIds === undefined
        ? {}
        : {
            acknowledgedRedFlagIds: [
              ...new Set([...row.acknowledgedRedFlagIds, ...patch.acknowledgedRedFlagIds]),
            ],
          }),
      ...(patch.reviewedGapIds === undefined
        ? {}
        : { reviewedGapIds: [...new Set([...row.reviewedGapIds, ...patch.reviewedGapIds])] }),
      ...(patch.redFlagDispositions === undefined
        ? {}
        : {
            redFlagDispositions: applyDispositions(
              row.redFlagDispositions,
              patch.redFlagDispositions,
              decidedAt,
            ),
          }),
      ...(patch.gapDispositions === undefined
        ? {}
        : {
            gapDispositions: applyDispositions(
              row.gapDispositions,
              patch.gapDispositions,
              decidedAt,
            ),
          }),
    }
    Object.assign(row, changes)
  }

  const patientListItem = (patient: Patient): PatientListItem => {
    const visits = live()
      .filter((row) => row.patientId === patient.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      erasedAt: patient.erasedAt,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
      consultationCount: visits.length,
      lastSeenAt: visits[0]?.createdAt.toISOString() ?? null,
    }
  }

  const guidelineDocuments = (): GuidelineDocument[] => {
    const ingestedAt = new Date()
    const document = (
      fields: Pick<
        GuidelineDocument,
        'id' | 'title' | 'publisher' | 'year' | 'sourceUrl' | 'sourceLicence' | 'verbatimAllowed'
      > & { profiles: string[] },
    ): GuidelineDocument => ({
      ...fields,
      jurisdiction: 'MY',
      pageCount: 0,
      chunkCount: 0,
      ingestedAt,
    })
    return [
      document({
        id: 'abdullah-2024-idr-sore-throat',
        title:
          'Treatment of Acute Sore Throat in Malaysia: A Consensus of Multidisciplinary Recommendations Using Modified Delphi Methodology',
        publisher: 'Dove Medical Press',
        year: 2024,
        sourceUrl: 'https://doi.org/10.2147/IDR.S477038',
        sourceLicence: 'CC-BY-NC-3.0',
        verbatimAllowed: true,
        profiles: [PROFILE_ID],
      }),
      document({
        id: 'moh-nag-2024',
        title: 'National Antimicrobial Guideline (NAG) 2024, 4th Edition',
        publisher: 'Ministry of Health Malaysia',
        year: 2024,
        sourceUrl: 'https://sites.google.com/moh.gov.my/nag',
        sourceLicence: 'MOH-ARR',
        verbatimAllowed: false,
        profiles: [PROFILE_ID, 'adult-acute-uncomplicated-uti'],
      }),
      document({
        id: 'ooi-2022-mfp-urti',
        title:
          'Patient Profile and Antibiotic Use in a Dedicated Upper Respiratory Tract Infection Clinic Based in a Primary Healthcare Setting During COVID-19 Pandemic in Malaysia: A Cross Sectional Study',
        publisher: 'Malaysian Family Physician',
        year: 2022,
        sourceUrl: 'https://doi.org/10.51866/oa.38',
        sourceLicence: 'CC-BY-4.0',
        verbatimAllowed: true,
        profiles: [PROFILE_ID],
      }),
    ]
  }

  type Handler = (id: string, body: unknown) => Response
  const routes: { method: string; path: RegExp; handle: Handler }[] = []
  const on = (method: string, path: string, handle: Handler) => {
    routes.push({ method, path: new RegExp(`^${path.replace(':id', '([^/]+)')}$`), handle })
  }

  const asrUnavailable =
    (what: string): Handler =>
    () =>
      errorResponse(503, 'asr_unavailable', `${what} is not available in preview deployments.`)

  on('GET', '/auth/get-session', () => json(200, signedIn ? { user: DOCTOR } : null))
  for (const path of ['/auth/sign-in/email', '/auth/sign-up/email']) {
    on('POST', path, () => {
      signedIn = true
      return json(200, { user: DOCTOR })
    })
  }
  on('POST', '/auth/guest', () => {
    signedIn = true
    return json(200, { ok: true })
  })
  on('POST', '/auth/sign-out', () => {
    signedIn = false
    return json(200, { success: true })
  })

  on('GET', '/health', () => json(200, { status: 'ok', provider: 'preview-stub' }))

  on('GET', '/patients', () =>
    json(200, {
      patients: [...patients.values()]
        .filter((patient) => patient.erasedAt === null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(patientListItem),
    }),
  )
  on('POST', '/patients', (_id, body) => {
    const input = parse(CreatePatientInputSchema, body, 'A valid patient name is required.')
    return json(201, { patient: createPatient(input) })
  })
  on('GET', '/patients/:id', (id) => {
    const patient = ownedPatient(id)
    const visits = live()
      .filter((row) => row.patientId === patient.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(listItem)
    return json(200, { patient: { ...patient, consultations: visits } })
  })
  on('PATCH', '/patients/:id', (id, body) => {
    const input = parse(UpdatePatientInputSchema, body, 'Invalid patient details.')
    const patient = ownedPatient(id)
    const next = PatientSchema.parse({
      ...patient,
      ...Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value ?? null])),
      updatedAt: new Date().toISOString(),
    })
    patients.set(id, next)
    return json(200, { patient: next })
  })
  on('POST', '/patients/:id/erase', (id) => {
    const patient = ownedPatient(id)
    const filed = live().filter((row) => row.patientId === patient.id)
    for (const row of filed) eraseConsultation(row)
    const at = new Date().toISOString()
    patients.set(id, {
      ...patient,
      name: null,
      nric: null,
      age: null,
      gender: null,
      erasedAt: at,
      updatedAt: at,
    })
    return json(200, {
      erasure: { patientId: id, erasedConsultationIds: filed.map((row) => row.id) },
    })
  })

  on('GET', '/consultations', () =>
    json(200, { consultations: live().sort(byUpdatedDesc).map(listItem) }),
  )
  on('POST', '/consultations', (_id, body) => {
    const input = parse(
      z.object({ transcript: TranscriptSchema.optional(), patientId: z.string().nullish() }),
      body,
      'A valid transcript is required.',
    )
    if (input.patientId) ownedPatient(input.patientId)
    const row = createConsultation(input.transcript, input.patientId ?? null)
    return json(201, { consultation: detail(row) })
  })
  on('POST', '/consultations/erase', (_id, body) => {
    const { ids } = parse(EraseConsultationsInputSchema, body, 'Supply consultation ids to erase.')
    const erased: string[] = []
    const failed: string[] = []
    for (const id of ids) {
      const row = consultations.get(id)
      if (row === undefined || row.erasedAt !== null) {
        failed.push(id)
        continue
      }
      eraseConsultation(row)
      erased.push(id)
    }
    return json(200, { erased, failed })
  })
  on('POST', '/consultations/analyze-ephemeral', (_id, body) => {
    const { transcript } = parse(
      z.object({ transcript: TranscriptSchema }),
      body,
      'A valid transcript is required.',
    )
    return json(200, { analysis: previewAnalysis(transcript) })
  })
  on('GET', '/consultations/:id', (id) =>
    json(200, { consultation: detail(ownedConsultation(id)) }),
  )
  on('PATCH', '/consultations/:id', (id, body) => {
    const row = ownedConsultation(id)
    patchConsultation(row, body)
    return json(200, { consultation: detail(row) })
  })
  on('POST', '/consultations/:id/analyze', (id) => {
    const row = ownedConsultation(id)
    analyse(row)
    return json(200, { consultation: detail(row) })
  })
  on('POST', '/consultations/:id/approve', (id) => {
    const row = ownedConsultation(id)
    approve(row)
    return json(200, { consultation: detail(row) })
  })
  on('GET', '/consultations/:id/history', (id) => {
    ownedConsultation(id)
    return json(200, {
      events: events
        .filter((event) => event.consultationId === id)
        .map(({ id: eventId, action, createdAt }) => ({ id: eventId, action, createdAt })),
    })
  })
  /*
   * Answered as a deployment with no retention period answers. The client
   * keeps the take for the session on its own, so playback still works, and
   * the stub holds no recording it would then have to account for.
   */
  on('PUT', '/consultations/:id/audio', (id) => {
    ownedConsultation(id)
    return errorResponse(
      503,
      'audio_retention_unset',
      'Recording storage is disabled in preview deployments.',
    )
  })
  on('GET', '/consultations/:id/audio', (id) => {
    ownedConsultation(id)
    return errorResponse(404, 'not_found', 'No recording is available for this consultation.')
  })
  on('POST', '/consultations/:id/prescriptions/parse', (id, body) => {
    ownedConsultation(id)
    const { dictated } = parse(
      z.object({ dictated: z.string().min(1).max(2000) }),
      body,
      'A dictated medication phrase is required.',
    )
    const { sig, readTo } = parseSigWithSpan(dictated)
    return json(
      200,
      PrescriptionParseResponseSchema.parse({
        sig,
        sigReadTo: readTo,
        candidates: matchMedication(dictated, PROFILE_ID),
      }),
    )
  })
  on('POST', '/consultations/:id/transcript-corrections', (id) => {
    const row = ownedConsultation(id)
    if (row.status !== 'draft') {
      throw conflict(`Corrections cannot be proposed while the consultation is ${row.status}.`)
    }
    const transcript = TranscriptSchema.safeParse(row.transcript)
    if (!transcript.success) throw conflict('This consultation has no usable transcript.')
    return json(200, {
      proposals: proposeMishearCorrections(transcript.data).slice(0, MAX_TRANSCRIPT_TURNS),
      cleanup: 'disabled',
    })
  })
  on('POST', '/consultations/:id/live-flags', (id, body) => {
    ownedConsultation(id)
    const { delta } = parse(
      z.object({ delta: LiveDeltaSchema }),
      body,
      'A valid live transcript window is required.',
    )
    // The server's values, never the caller's: either could only weaken the engine.
    const window: Transcript = { ...delta, source: 'asr_live', labelsReviewed: false }
    return json(200, { redFlags: evaluateRedFlags(window, URTI_TRIGGERS) })
  })
  on('POST', '/consultations/:id/live-analysis', (id, body) => {
    ownedConsultation(id)
    const { previous } = parse(
      z.object({ delta: LiveDeltaSchema, previous: LiveAnalysisStateSchema.nullable() }),
      body,
      'A valid live transcript window is required.',
    )
    const opening = LiveAnalysisStateSchema.parse({
      cycle: 0,
      clinicalFacts: { symptoms: {}, history: {}, observations: {}, examination: {} },
      operational: {},
    })
    const state = previous ?? opening
    return json(200, {
      state: { ...state, cycle: state.cycle + 1 },
      gaps: [],
      discardedFieldIds: [],
    })
  })

  on('GET', '/asr/live-sessions/config', asrUnavailable('Ambient transcription'))
  on('POST', '/asr/live-sessions', asrUnavailable('Ambient transcription'))
  on('POST', '/asr/transcriptions', asrUnavailable('Hosted transcription'))
  on('POST', '/asr/draft-turns', asrUnavailable('Speaker labelling'))

  on('GET', '/fixtures', () => json(200, { fixtures: FIXTURES }))
  on('GET', '/guidelines/documents', () => json(200, { documents: guidelineDocuments() }))

  on('GET', '/notifications', () => {
    const notifications: NotificationItem[] = []
    for (const event of [...events].reverse()) {
      const action = NotificationActionSchema.safeParse(event.action)
      if (!action.success || event.createdAt.getTime() <= clearedAt) continue
      notifications.push({
        id: event.id,
        action: action.data,
        consultationId: event.consultationId,
        createdAt: event.createdAt,
      })
    }
    return json(200, { notifications: notifications.slice(0, NOTIFICATION_FEED_LIMIT) })
  })
  on('POST', '/notifications/clear', () => {
    clearedAt = Date.now()
    return new Response(null, { status: 204 })
  })

  on('GET', '/settings/retention', () => json(200, { retention: { adoptedYears } }))
  on('PATCH', '/settings/retention', (_id, body) => {
    adoptedYears = parse(RetentionPolicySchema, body, 'Retention must be whole years.').adoptedYears
    return json(200, { retention: { adoptedYears } })
  })

  const PROTECTED =
    /^\/(asr|consultations|fixtures|guidelines|notifications|patients|settings)(\/|$)/

  seed()

  return {
    /** `path` is the part after `/api`, e.g. `/consultations/abc`. */
    handle(method: string, path: string, body: unknown): Response {
      if (!signedIn && PROTECTED.test(path)) {
        return errorResponse(401, 'unauthenticated', 'Authentication required.')
      }
      for (const route of routes) {
        if (route.method !== method) continue
        const match = route.path.exec(path)
        if (match === null) continue
        try {
          return route.handle(decodeURIComponent(match[1] ?? ''), body)
        } catch (error) {
          if (error instanceof StubError) {
            return errorResponse(error.status, error.code, error.message)
          }
          console.error('preview stub handler failed', method, path, error)
          return errorResponse(500, 'internal_error', 'The preview stub could not answer this.')
        }
      }
      return errorResponse(
        501,
        'not_in_preview',
        `${method} /api${path} is not answered in preview deployments, which run without the API.`,
      )
    },
  }
}
