import { describe, expect, test } from 'bun:test'
import { assertSuccessfulRun, installSafetyGuard } from './record.mjs'

const beats = [
  ...Array.from({ length: 10 }, (_, index) => ({ name: `shot-${index + 1}`, ms: index * 1000 })),
  { name: 'end', ms: 10000 },
]
const claims = beats.slice(0, -1).map((beat) => ({ beat: beat.name, ok: true }))

describe('shared shot gate', () => {
  test('requires every claim and no browser errors', () => {
    expect(() => assertSuccessfulRun(beats, claims, [])).not.toThrow()
    expect(() => assertSuccessfulRun(beats, claims.slice(1), [])).toThrow()
    expect(() => assertSuccessfulRun(beats, claims, ['console'])).toThrow()
  })

  test('allows transcript capture but blocks clinical PATCH and other mutations', async () => {
    let handler: (route: unknown) => Promise<void> = async () => {}
    let blocked = 0
    await installSafetyGuard(
      {
        route: async (_pattern: string, callback: typeof handler) => {
          handler = callback
        },
      },
      () => blocked++,
    )
    for (const [method, path, body, allowed] of [
      ['PATCH', '/api/consultations/demo', { transcript: {} }, true],
      ['PATCH', '/api/consultations/demo', { prescriptions: [] }, false],
      ['PATCH', '/api/consultations/demo', { transcript: {}, dispositions: [] }, false],
      ['POST', '/api/consultations/demo/approve', {}, false],
      ['DELETE', '/api/patients/demo', {}, false],
      ['POST', '/api/consultations/demo/analyze', {}, true],
      ['POST', '/api/patients', {}, true],
      ['POST', '/api/consultations', {}, true],
      ['GET', '/api/consultations/demo', null, true],
    ] as const) {
      let continued = false
      await handler({
        request: () => ({
          method: () => method,
          url: () => `https://example.invalid${path}`,
          postDataJSON: () => body,
        }),
        abort: async () => {},
        continue: async () => {
          continued = true
        },
      })
      expect(continued).toBe(allowed)
    }
    expect(blocked).toBe(4)
  })
})
