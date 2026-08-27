import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'

const PATIENT = {
  id: 'patient-1',
  name: 'Aisha Rahman',
  nric: '900101-14-5678',
  age: 36,
  gender: 'female',
  erasedAt: null,
  createdAt: '2026-08-27T06:00:00.000Z',
  updatedAt: '2026-08-27T06:00:00.000Z',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('patient API', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('safe-parses the patient directory envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        patients: [
          {
            ...PATIENT,
            nric: undefined,
            consultationCount: 2,
            lastSeenAt: '2026-08-26T06:00:00.000Z',
          },
        ],
      }),
    )

    await expect(api.listPatients()).resolves.toEqual([
      expect.objectContaining({ id: 'patient-1', consultationCount: 2 }),
    ])
  })

  it('rejects an invalid successful patient response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ patients: [{ ...PATIENT, consultationCount: -1, lastSeenAt: null }] }),
    )

    await expect(api.listPatients()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    })
  })

  it('creates a patient without an authorization header', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ patient: PATIENT }, 201))

    await api.createPatient({ name: 'Aisha Rahman', age: 36, gender: 'female' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/patients',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ name: 'Aisha Rahman', age: 36, gender: 'female' }),
      }),
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('safe-parses a patched patient envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ patient: { ...PATIENT, age: 37 } }))

    await expect(api.patchPatient('patient-1', { age: 37 })).resolves.toEqual(
      expect.objectContaining({ id: 'patient-1', age: 37 }),
    )
  })

  it('safe-parses a patient profile and its consultation history', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        patient: {
          ...PATIENT,
          consultations: [
            {
              id: 'consultation-1',
              status: 'approved',
              title: 'Acute cough',
              createdAt: '2026-08-26T06:00:00.000Z',
              updatedAt: '2026-08-26T06:00:00.000Z',
            },
          ],
        },
      }),
    )

    await expect(api.getPatient('patient-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'patient-1',
        consultations: [expect.objectContaining({ id: 'consultation-1' })],
      }),
    )
  })
})

describe('consultation patient filing', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('includes an optional patient id when creating a consultation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        consultation: {
          id: 'consultation-1',
          status: 'draft',
          title: null,
          createdAt: '2026-08-27T06:00:00.000Z',
          updatedAt: '2026-08-27T06:00:00.000Z',
          transcript: { source: 'paste', turns: [{ speaker: 'patient', text: 'Cough.' }] },
          analysis: null,
          editedNote: null,
          approvedAt: null,
          approvedBy: null,
          acknowledgedRedFlagIds: [],
          reviewedGapIds: [],
          redFlagDispositions: [],
          gapDispositions: [],
        },
      }),
    )

    await api.createConsultation(
      { source: 'paste', turns: [{ speaker: 'patient', text: 'Cough.' }] },
      'patient-1',
    )

    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({ patientId: 'patient-1' })
  })
})
