import type { Transcript } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../lib/api.js'
import { installPreviewStub, PREVIEW_MARKER } from './stub.js'

/*
 * Driven through the real client on purpose. `api.ts` safe-parses every
 * response against the shared schemas, so a handler whose shape drifts fails
 * here as `invalid_response` exactly as the preview would fail on screen.
 */

const STRIDOR: Transcript = {
  source: 'asr_live',
  turns: [
    { speaker: 'doctor', text: 'Any trouble breathing?' },
    {
      speaker: 'patient',
      text: "Yes, breathing feels very tight, and there's a noisy high-pitched sound when I breathe in. I cannot swallow, even my own saliva, I am drooling.",
    },
  ],
}

const ROUTINE: Transcript = {
  source: 'paste',
  labelsReviewed: true,
  turns: [
    { speaker: 'doctor', text: 'What brings you in today?' },
    { speaker: 'patient', text: 'A cough for three days and a mild sore throat.' },
  ],
}

let network: ReturnType<typeof vi.fn<typeof fetch>>
let uninstall: () => void

const apiCalls = () =>
  network.mock.calls.filter(([input]) =>
    new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    ).pathname.startsWith('/api/'),
  )

beforeEach(() => {
  network = vi.fn<typeof fetch>(async () => new Response('from the network'))
  vi.stubGlobal('fetch', network)
  uninstall = installPreviewStub()
})

afterEach(() => {
  expect(apiCalls()).toEqual([])
  uninstall()
  vi.unstubAllGlobals()
})

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('preview stub: session', () => {
  it('starts signed in, signs out, and signs back in', async () => {
    await expect(api.session()).resolves.toEqual({
      user: expect.objectContaining({ email: 'preview@example.invalid', name: 'Dr Preview' }),
    })

    await api.signOut()
    await expect(api.session()).resolves.toBeNull()
    expect((await rejection(api.listConsultations())).status).toBe(401)

    await api.signIn('preview@example.invalid', 'anything')
    await expect(api.session()).resolves.not.toBeNull()
    await api.signOut()
    await expect(api.signInGuest()).resolves.toEqual({ ok: true })
    await api.signOut()
    await api.signUp('preview@example.invalid', 'anything', 'Dr Preview')
    await expect(api.listConsultations()).resolves.toHaveLength(5)
  })
})

describe('preview stub: consultations', () => {
  it('seeds the demo plan and reads every record back', async () => {
    const list = await api.listConsultations()
    expect(list.map((row) => row.status).sort()).toEqual([
      'approved',
      'awaiting_review',
      'awaiting_review',
      'awaiting_review',
      'draft',
    ])

    for (const row of list) {
      const detail = await api.getConsultation(row.id)
      expect(detail.id).toBe(row.id)
      if (detail.status === 'draft') expect(detail.analysis).toBeNull()
      else expect(detail.analysis?.note.assessment).toContain('Preview placeholder')
      if (detail.status === 'approved') expect(detail.approvedBy).toBe('Dr Preview')
    }

    const flagged = await Promise.all(list.map((row) => api.getConsultation(row.id)))
    const ruleFlags = flagged.flatMap((detail) => detail.analysis?.redFlags ?? [])
    expect(ruleFlags.some((flag) => flag.source === 'rule' && flag.severity === 'emergency')).toBe(
      true,
    )
  })

  it('walks create, capture, analyse and approve through the real state machine', async () => {
    const [patient] = await api.listPatients()
    if (patient === undefined) throw new Error('no seeded patient')

    const created = await api.createConsultation(undefined, patient.id)
    expect(created).toMatchObject({ status: 'draft', captureMode: 'ambient', analysis: null })
    expect(created.patient).toEqual({ id: patient.id, name: patient.name })

    expect((await rejection(api.approve(created.id))).code).toBe('invalid_state')
    expect((await rejection(api.analyze(created.id))).code).toBe('invalid_state')

    const captured = await api.setTranscript(created.id, ROUTINE)
    expect(captured.captureMode).toBe('manual')
    await expect(api.transcriptCorrections(created.id)).resolves.toEqual({
      proposals: [],
      cleanup: 'disabled',
    })

    const analysed = await api.analyze(created.id)
    expect(analysed.status).toBe('awaiting_review')
    expect(analysed.analysis?.medicalRecordNote?.plan).toContain('Preview placeholder')
    expect((await rejection(api.setTranscript(created.id, ROUTINE))).status).toBe(409)

    const edited = await api.patch(created.id, { editedMedicalRecordNote: { plan: 'Fluids.' } })
    expect(edited.editedMedicalRecordNote?.plan).toBe('Fluids.')

    const approved = await api.approve(created.id)
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'Dr Preview' })
    expect((await rejection(api.approve(created.id))).status).toBe(409)
    expect((await rejection(api.analyze(created.id))).status).toBe(409)
    expect((await rejection(api.patch(created.id, { reviewedGapIds: ['x'] }))).status).toBe(409)
    await expect(api.patch(created.id, { title: 'Renamed' })).resolves.toMatchObject({
      title: 'Renamed',
    })

    const history = await api.history(created.id)
    expect(history.map((event) => event.action)).toContain('consultation.approved')
    await expect(api.notifications()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'consultation.approved', consultationId: created.id }),
      ]),
    )
    await expect(api.clearNotifications()).resolves.toBeNull()
    await expect(api.notifications()).resolves.toEqual([])

    await expect(api.eraseConsultations([created.id, 'missing'])).resolves.toEqual({
      erased: [created.id],
      failed: ['missing'],
    })
    expect((await rejection(api.getConsultation(created.id))).status).toBe(404)
  })

  it('runs the real engines on the routes that have one, and none of the model', async () => {
    const [first] = await api.listConsultations()
    if (first === undefined) throw new Error('no seeded consultation')

    const parsed = await api.parsePrescription(
      first.id,
      'amoxicilin 500 mg three times a day after food for five days',
    )
    expect(parsed.sig).toMatchObject({ dose: '500 mg', frequency: 'three-times-daily' })
    expect(parsed.candidates[0]).toMatchObject({ lexiconId: 'amoxicillin', heard: 'amoxicilin' })

    const flags = await api.liveFlags(first.id, STRIDOR, new AbortController().signal)
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((flag) => flag.source === 'rule')).toBe(true)

    const live = await api.liveAnalysis(first.id, ROUTINE, null, new AbortController().signal)
    expect(live.state.cycle).toBe(1)

    const ephemeral = await api.analyzeEphemeral(STRIDOR)
    expect(ephemeral.redFlags.length).toBeGreaterThan(0)
    expect(ephemeral.suggestions).toEqual([])
  })
})

describe('preview stub: patients', () => {
  it('creates, reads, edits and erases a patient', async () => {
    const before = await api.listPatients()
    const created = await api.createPatient({ name: 'Nur Aina', age: 29, gender: 'female' })
    await expect(api.listPatients()).resolves.toHaveLength(before.length + 1)

    const visit = await api.createConsultation(ROUTINE, created.id)
    await expect(api.getPatient(created.id)).resolves.toMatchObject({
      name: 'Nur Aina',
      consultations: [expect.objectContaining({ id: visit.id })],
    })
    await expect(api.patchPatient(created.id, { age: 30 })).resolves.toMatchObject({ age: 30 })

    await expect(api.erasePatient(created.id)).resolves.toEqual({
      patientId: created.id,
      erasedConsultationIds: [visit.id],
    })
    expect((await rejection(api.getPatient(created.id))).status).toBe(404)
    await expect(api.listPatients()).resolves.toHaveLength(before.length)
  })
})

describe('preview stub: what a preview cannot do', () => {
  it('answers every recogniser route as unavailable, the way the UI already reads', async () => {
    const config = await rejection(api.liveAsrConfig('ambient'))
    expect(config).toMatchObject({ status: 503, code: 'asr_unavailable' })
    const session = await rejection(
      api.createLiveSession(new AbortController().signal, 'dictation'),
    )
    expect(session.status).toBe(503)
  })

  it('stores no recording', async () => {
    const [first] = await api.listConsultations()
    if (first === undefined) throw new Error('no seeded consultation')
    expect((await rejection(api.putConsultationAudio(first.id, new Blob(['x'])))).status).toBe(503)
    await expect(api.getConsultationAudio(first.id)).resolves.toBeNull()
  })

  it('answers an unknown /api route with 501 rather than letting it through', async () => {
    const response = await fetch('/api/not-a-route', { method: 'POST' })
    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'not_in_preview' } })
  })
})

describe('preview stub: the network boundary', () => {
  it('keeps /api off the network whatever origin it names, and passes the rest through', async () => {
    const elsewhere = await fetch('https://catatmd-api.onrender.com/api/health')
    await expect(elsewhere.json()).resolves.toEqual({ status: 'ok', provider: 'preview-stub' })
    await expect(api.health()).resolves.toEqual({ status: 'ok', provider: 'preview-stub' })
    await expect(api.fixtures()).resolves.not.toHaveLength(0)
    await expect(api.guidelineDocuments()).resolves.not.toHaveLength(0)

    await fetch('/assets/font.woff2')
    expect(network).toHaveBeenCalledTimes(1)
    expect(network).toHaveBeenCalledWith('/assets/font.woff2', undefined)
  })

  it('marks the page once, and unmarks it on uninstall', () => {
    const badges = document.querySelectorAll(`[data-preview-stub="${PREVIEW_MARKER}"]`)
    expect(badges).toHaveLength(1)
    expect(badges[0]?.textContent).toMatch(/Synthetic Data/)

    uninstall()
    expect(document.querySelector(`[data-preview-stub="${PREVIEW_MARKER}"]`)).toBeNull()
    uninstall = installPreviewStub()
  })
})
