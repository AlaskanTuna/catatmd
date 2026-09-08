import { type GuidelineChunk, GuidelineChunkSchema } from '@shared/types'
import { sliceDeidentified } from '../deid/index.js'
import type { Deidentified } from '../deid/types.js'
import { getEmbeddingClient } from '../lib/llm/index.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { buildLexicalQuery } from './query.js'

const RRF_K = 60
const RANK_LIMIT = 20
const EMBEDDING_QUERY_MAX_CHARS = 6000

export interface RetrievalOptions {
  limit?: number
  jurisdiction?: string
}

export async function retrieveGuidelines(
  content: Deidentified,
  options: RetrievalOptions = {},
): Promise<GuidelineChunk[]> {
  const { limit = 6, jurisdiction = 'MY' } = options
  const startedAt = performance.now()

  const [countRow] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count
    FROM "guideline_chunk" c
    JOIN "guideline_document" d ON d."id" = c."documentId"
    WHERE d."jurisdiction" = ${jurisdiction}
  `
  if (countRow?.count === 0) return []

  const q = buildLexicalQuery(content)
  const lexical: Array<{ id: string; score: number }> = []
  if (q.length > 0) {
    lexical.push(
      ...(await prisma.$queryRaw<Array<{ id: string; score: number }>>`
        SELECT c."id", ts_rank_cd(c."tsv", to_tsquery('english', ${q})) AS score
        FROM "guideline_chunk" c
        JOIN "guideline_document" d ON d."id" = c."documentId"
        WHERE d."jurisdiction" = ${jurisdiction} AND c."tsv" @@ to_tsquery('english', ${q})
        ORDER BY score DESC
        LIMIT ${RANK_LIMIT}
      `),
    )
  }

  const semantic: Array<{ id: string; score: number }> = []
  try {
    const query = sliceDeidentified(content, EMBEDDING_QUERY_MAX_CHARS)[0]
    if (!query) throw new Error('empty embedding query')
    const vectors = await getEmbeddingClient().embed([query], 'guideline_retrieval')
    const vector = vectors[0]
    if (!vector) throw new Error('empty embedding response')
    const vectorLiteral = JSON.stringify(vector)
    semantic.push(
      ...(await prisma.$queryRaw<Array<{ id: string; score: number }>>`
        SELECT c."id", 1 - (c."embedding" <=> ${vectorLiteral}::vector) AS score
        FROM "guideline_chunk" c
        JOIN "guideline_document" d ON d."id" = c."documentId"
        WHERE d."jurisdiction" = ${jurisdiction} AND c."embedding" IS NOT NULL
        ORDER BY c."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${RANK_LIMIT}
      `),
    )
  } catch {
    logger.warn('embedding unavailable', {
      errorClass: 'retrieval_error',
      errorName: 'embedding_unavailable',
    })
  }

  const scores = new Map<string, number>()
  for (const [rank, row] of lexical.entries()) {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1))
  }
  for (const [rank, row] of semantic.entries()) {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1))
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)

  if (ranked.length === 0) {
    logger.info(
      `retrieval complete candidateCount=0 lexicalCount=${lexical.length} semanticCount=${semantic.length}`,
      { stage: 'retrieval', durationMs: Math.round(performance.now() - startedAt), count: 0 },
    )
    return []
  }

  const rows = await prisma.guidelineChunk.findMany({
    where: { id: { in: ranked } },
    include: { document: true },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))

  const chunks = ranked
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== null && row !== undefined)
    .map((chunk) => {
      const { document } = chunk
      const baseTitle = `${document.title}, p. ${chunk.page}`
      const title = chunk.heading ? `${baseTitle}: ${chunk.heading}` : baseTitle
      return GuidelineChunkSchema.parse({
        id: chunk.id,
        title,
        publisher: document.publisher,
        year: document.year,
        url: document.sourceUrl,
        summary: chunk.text,
        sourceLicence: document.sourceLicence,
        verbatimAllowed: true,
        documentId: chunk.documentId,
        page: chunk.page,
        ocr: chunk.ocr,
      })
    })

  logger.info(
    `retrieval complete candidateCount=${chunks.length} lexicalCount=${lexical.length} semanticCount=${semantic.length}`,
    {
      stage: 'retrieval',
      durationMs: Math.round(performance.now() - startedAt),
      count: chunks.length,
    },
  )

  return chunks
}
