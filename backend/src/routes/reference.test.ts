import type { Server } from 'node:http'
import { GuidelineDocumentSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({
  prisma: { guidelineDocument: { findMany } },
}))

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

let server: Server
let origin: string

beforeAll(async () => {
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  origin = `http://127.0.0.1:${addr.port}`
})

afterAll(() => server.close())

beforeEach(() => {
  findMany.mockReset()
})

describe('GET /api/guidelines/documents', () => {
  it('returns parsed GuidelineDocument rows ordered by title', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'doc-a',
        title: 'A Guideline',
        publisher: 'MOH',
        year: 2023,
        sourceUrl: 'https://example.com/a',
        jurisdiction: 'MY',
        sourceLicence: 'MOH-ARR',
        sha256: 'a',
        storagePath: null,
        pageCount: 3,
        ingestedAt: new Date('2026-09-02T00:00:00.000Z'),
        _count: { chunks: 4 },
      },
      {
        id: 'doc-b',
        title: 'B Guideline',
        publisher: 'MOH',
        year: 2024,
        sourceUrl: 'https://example.com/b',
        jurisdiction: 'MY',
        sourceLicence: 'MOH-ARR',
        sha256: 'b',
        storagePath: null,
        pageCount: 5,
        ingestedAt: new Date('2026-09-01T00:00:00.000Z'),
        _count: { chunks: 12 },
      },
    ])

    const res = await fetch(`${origin}/api/guidelines/documents`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { documents: unknown[] }
    expect(body.documents).toHaveLength(2)
    expect((body.documents[0] as { title: string }).title).toBe('A Guideline')
    expect((body.documents[0] as { chunkCount: number }).chunkCount).toBe(4)
    expect((body.documents[1] as { chunkCount: number }).chunkCount).toBe(12)

    for (const document of body.documents) {
      expect(GuidelineDocumentSchema.safeParse(document).success).toBe(true)
    }
  })

  it('returns an empty list when no documents are ingested', async () => {
    findMany.mockResolvedValueOnce([])

    const res = await fetch(`${origin}/api/guidelines/documents`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { documents: unknown[] }
    expect(body.documents).toEqual([])
  })
})
