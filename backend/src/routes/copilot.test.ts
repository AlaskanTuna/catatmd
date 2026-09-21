import type { Server } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeidentificationError } from '../deid/index.js'

const runCopilotTurn = vi.hoisted(() => vi.fn())

vi.mock('../copilot/index.js', () => ({ runCopilotTurn }))
vi.mock('../lib/authz.js', () => ({
  assertOwnedConsultation: vi.fn(async () => ({ id: 'consultation-1' })),
}))
vi.mock('../middleware/rate-limit.js', () => ({
  copilotRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('./consultations.js', () => ({
  doctorId: () => 'doctor-1',
  toDetailWithApprover: vi.fn(async () => ({ id: 'consultation-1' })),
}))

const { copilotRouter } = await import('./copilot.js')

let server: Server
let origin: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/consultations/:id/copilot', copilotRouter)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(() => server.close())

beforeEach(() => runCopilotTurn.mockReset())

describe('de-identification failure telemetry', () => {
  it.each([
    { failureStage: 'detector_failure' as const, payloadOrigin: 'current_message' as const },
    { failureStage: 'egress_block' as const, payloadOrigin: 'egress_turn' as const },
  ])(
    'logs only closed metadata for $failureStage at $payloadOrigin',
    async ({ failureStage, payloadOrigin }) => {
      const marker = '850523-14-5677'
      runCopilotTurn.mockImplementation(() =>
        (async function* () {
          yield* []
          throw new DeidentificationError(
            `synthetic failure containing ${marker}`,
            failureStage,
            payloadOrigin,
          )
        })(),
      )

      const lines: string[] = []
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        lines.push(String(chunk))
        return true
      })
      const response = await fetch(`${origin}/consultations/consultation-1/copilot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Summarise the consultation.', history: [] }),
      })
      const body = await response.text()
      spy.mockRestore()

      expect(response.status).toBe(200)
      expect(body).toContain(
        'The consultation could not be de-identified, so CatatAI was not called.',
      )
      const record = JSON.parse(lines[0] ?? '{}')
      expect(record).toMatchObject({
        consultationId: 'consultation-1',
        errorClass: 'deidentification_error',
        failureStage,
        payloadOrigin,
      })
      expect(lines.join('')).not.toContain(marker)
    },
  )
})
