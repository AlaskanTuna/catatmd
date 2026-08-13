import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertOwnedConsultation } from './authz.js'
import { HttpError } from './http-error.js'
import { prisma } from './prisma.js'

vi.mock('./prisma.js', () => ({
  prisma: { consultation: { findFirst: vi.fn() } },
}))

/**
 * A stand-in table rather than a canned return value: the point of these tests
 * is that the `doctorId` filter is actually applied, and a mock that ignores
 * the `where` clause would pass no matter what the helper did.
 */
const ROWS = [
  { id: 'consult-aisyah', doctorId: 'doctor-aisyah' },
  { id: 'consult-lim', doctorId: 'doctor-lim' },
  { id: 'consult-guest', doctorId: 'guest' },
]

beforeEach(() => {
  vi.mocked(prisma.consultation.findFirst).mockImplementation(
    (async (args: { where: { id: string; doctorId: string } }) =>
      ROWS.find((r) => r.id === args.where.id && r.doctorId === args.where.doctorId) ??
      null) as never,
  )
})

describe('assertOwnedConsultation', () => {
  it('returns the consultation to its owner', async () => {
    await expect(assertOwnedConsultation('consult-aisyah', 'doctor-aisyah')).resolves.toMatchObject(
      { id: 'consult-aisyah' },
    )
  })

  it('scopes the query on doctorId, not just id', async () => {
    await assertOwnedConsultation('consult-aisyah', 'doctor-aisyah').catch(() => {})

    expect(prisma.consultation.findFirst).toHaveBeenCalledWith({
      where: { id: 'consult-aisyah', doctorId: 'doctor-aisyah' },
    })
  })

  it('raises 404 — never 403 — when the consultation belongs to another doctor', async () => {
    const err = await assertOwnedConsultation('consult-aisyah', 'doctor-lim').catch((e) => e)

    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(404)
    expect(err.status).not.toBe(403)
  })

  it('is indistinguishable between "not owned" and "does not exist"', async () => {
    const notOwned = await assertOwnedConsultation('consult-aisyah', 'doctor-lim').catch((e) => e)
    const missing = await assertOwnedConsultation('no-such-id', 'doctor-lim').catch((e) => e)

    // An attacker comparing the two responses must learn nothing about whether
    // the id is real — same status, same code, same message.
    expect(notOwned.status).toBe(missing.status)
    expect(notOwned.code).toBe(missing.code)
    expect(notOwned.message).toBe(missing.message)
  })

  describe('guest isolation (#29)', () => {
    it("hides a seeded doctor's consultation from the guest account", async () => {
      const err = await assertOwnedConsultation('consult-aisyah', 'guest').catch((e) => e)

      expect(err).toBeInstanceOf(HttpError)
      expect(err.status).toBe(404)
    })

    it("hides the guest's consultation from a seeded doctor", async () => {
      const err = await assertOwnedConsultation('consult-guest', 'doctor-aisyah').catch((e) => e)

      expect(err).toBeInstanceOf(HttpError)
      expect(err.status).toBe(404)
    })
  })
})
