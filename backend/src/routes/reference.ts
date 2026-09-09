import { GuidelineDocumentSchema } from '@shared/types'
import { Router } from 'express'
import { FIXTURES } from '../fixtures/index.js'
import { prisma } from '../lib/prisma.js'

/**
 * Read-only reference surfaces (docs/trd.md §13). Fixtures are a compile-time
 * constant already validated in `fixtures/corpus.ts`. Documents are loaded from
 * the database and parsed on the way out.
 *
 * Session-guarded like every other clinical route; `requireSession` is mounted
 * on the relevant path prefixes in `app.ts`.
 */
export const referenceRouter = Router()

referenceRouter.get('/fixtures', (_req, res) => {
  res.json({ fixtures: FIXTURES })
})

referenceRouter.get('/guidelines/documents', async (_req, res) => {
  const rows = await prisma.guidelineDocument.findMany({
    orderBy: { title: 'asc' },
    include: { _count: { select: { chunks: true } } },
  })

  const documents = rows.map((row) =>
    GuidelineDocumentSchema.parse({
      ...row,
      chunkCount: row._count.chunks,
    }),
  )

  res.json({ documents })
})
