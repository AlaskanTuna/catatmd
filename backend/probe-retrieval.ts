import { deidentifyTranscript } from './src/deid/index.js'
import { FIXTURES } from './src/fixtures/index.js'
import { getEmbeddingClient } from './src/lib/llm/index.js'
import { prisma } from './src/lib/prisma.js'
import { buildLexicalQuery, retrieveGuidelines } from './src/retrieval/index.js'

for (const fixture of FIXTURES.slice(0, 3)) {
  const { text } = deidentifyTranscript(fixture.transcript)
  const q = buildLexicalQuery(text)
  const lex = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
    SELECT c."id", ts_rank_cd(c."tsv", to_tsquery('english', ${q})) AS score
    FROM "guideline_chunk" c JOIN "guideline_document" d ON d."id" = c."documentId"
    WHERE 'adult-acute-urti' = ANY(d."profiles") AND c."tsv" @@ to_tsquery('english', ${q})
    ORDER BY score DESC LIMIT 8`
  const [vec] = await getEmbeddingClient().embed([text.slice(0, 6000) as typeof text], 'probe')
  const v = JSON.stringify(vec)
  const sem = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
    SELECT c."id", 1 - (c."embedding" <=> ${v}::vector) AS score
    FROM "guideline_chunk" c JOIN "guideline_document" d ON d."id" = c."documentId"
    WHERE 'adult-acute-urti' = ANY(d."profiles") AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${v}::vector LIMIT 8`
  const out = await retrieveGuidelines(text, { profileId: 'adult-acute-urti' })
  console.log(`\n== ${fixture.id}: ${fixture.title ?? ''}`)
  console.log('lexical:', lex.map((r) => `${r.id}:${Number(r.score).toFixed(3)}`).join(' '))
  console.log('semantic:', sem.map((r) => `${r.id}:${Number(r.score).toFixed(3)}`).join(' '))
  console.log('returned:', out.map((c) => `${c.id} | ${c.title.slice(0, 70)}`).join('\n          '))
}
await prisma.$disconnect()
