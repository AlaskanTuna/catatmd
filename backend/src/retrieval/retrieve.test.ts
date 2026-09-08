import { GuidelineChunkSchema } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deidentify } from '../deid/index.js'
import { retrieveGuidelines } from './retrieve.js'

const queryRaw = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())
const embed = vi.hoisted(() => vi.fn())
const info = vi.hoisted(() => vi.fn())
const warn = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: queryRaw,
    guidelineChunk: { findMany },
  },
}))

vi.mock('../lib/llm/index.js', () => ({
  getEmbeddingClient: () => ({ embed }),
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info, warn, debug: vi.fn(), error: vi.fn() },
}))

const { text: content } = deidentify('Doctor: the patient has a cough and fever for three days.')

function makeChunk(id: string, overrides: { page?: number; heading?: string } = {}) {
  return {
    id,
    documentId: 'doc-1',
    page: overrides.page ?? 1,
    ordinal: 0,
    heading: overrides.heading ?? null,
    text: `Summary for ${id}`,
    ocr: false,
    document: {
      id: 'doc-1',
      title: 'Malaysian URTI Guideline',
      publisher: 'MOH',
      year: 2024,
      sourceUrl: 'https://example.com/guideline',
      jurisdiction: 'MY',
      sourceLicence: 'MOH-ARR',
      sha256: 'abc',
      storagePath: null,
      pageCount: 10,
      ingestedAt: new Date(),
      profiles: ['adult-acute-urti'],
      verbatimAllowed: true,
    },
  }
}

beforeEach(() => {
  queryRaw.mockReset()
  findMany.mockReset()
  embed.mockReset()
  info.mockReset()
  warn.mockReset()
})

describe('retrieveGuidelines', () => {
  it('returns an empty array immediately when no chunks exist for the jurisdiction', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 0 }])

    const result = await retrieveGuidelines(content, { profileId: 'adult-acute-urti' })

    expect(result).toEqual([])
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(embed).not.toHaveBeenCalled()
  })

  it('fuses lexical and semantic ranks with reciprocal rank fusion', async () => {
    queryRaw
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([
        { id: 'lex1', score: 0.9 },
        { id: 'lex2', score: 0.8 },
      ])
      .mockResolvedValueOnce([
        { id: 'sem1', score: 0.95 },
        { id: 'lex1', score: 0.85 },
      ])

    embed.mockResolvedValueOnce([[0.1, 0.2, 0.3]])

    findMany.mockResolvedValueOnce([makeChunk('lex1'), makeChunk('sem1'), makeChunk('lex2')])

    const result = await retrieveGuidelines(content, {
      profileId: 'adult-acute-urti',
      limit: 3,
      jurisdiction: 'MY',
    })

    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe('lex1')
    expect(result[1]?.id).toBe('sem1')
    expect(result[2]?.id).toBe('lex2')

    const ids = findMany.mock.calls[0]?.[0]?.where?.id?.in as string[]
    expect(ids).toEqual(['lex1', 'sem1', 'lex2'])
  })

  it('falls back to lexical only when embedding fails', async () => {
    queryRaw
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ id: 'lex1', score: 0.9 }])

    embed.mockRejectedValueOnce(new Error('embedding unavailable'))

    findMany.mockResolvedValueOnce([makeChunk('lex1')])

    const result = await retrieveGuidelines(content, { profileId: 'adult-acute-urti' })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('lex1')
    expect(warn).toHaveBeenCalledWith(
      'embedding unavailable',
      expect.objectContaining({
        errorClass: 'retrieval_error',
        errorName: 'embedding_unavailable',
      }),
    )
  })

  it('validates every returned chunk against GuidelineChunkSchema', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 2 }]).mockResolvedValueOnce([{ id: 'c1', score: 0.8 }])

    embed.mockRejectedValueOnce(new Error('unavailable'))

    findMany.mockResolvedValueOnce([makeChunk('c1', { page: 5, heading: 'Antibiotics' })])

    const result = await retrieveGuidelines(content, { profileId: 'adult-acute-urti' })

    for (const chunk of result) {
      expect(GuidelineChunkSchema.safeParse(chunk).success).toBe(true)
    }
    expect(result[0]?.title).toBe('Malaysian URTI Guideline, p. 5: Antibiotics')
  })

  it('logs one info line with counts and duration', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ id: 'c1', score: 0.8 }])

    embed.mockRejectedValueOnce(new Error('unavailable'))

    findMany.mockResolvedValueOnce([makeChunk('c1')])

    await retrieveGuidelines(content, { profileId: 'adult-acute-urti' })

    const [message, fields] = info.mock.calls[0] ?? ['', {}]
    expect(message).toMatch(/candidateCount=1/)
    expect(message).toMatch(/lexicalCount=1/)
    expect(message).toMatch(/semanticCount=0/)
    expect(fields).toMatchObject({ stage: 'retrieval', count: 1 })
    expect(fields).toHaveProperty('durationMs')
  })

  it('drops candidates under the per-leg relevance floors instead of padding to the limit', async () => {
    queryRaw
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([
        { id: 'lex1', score: 0.4 },
        { id: 'weak-lex', score: 0.1 },
      ])
      .mockResolvedValueOnce([
        { id: 'sem1', score: 0.62 },
        { id: 'weak-sem', score: 0.31 },
      ])
    embed.mockResolvedValueOnce([[0.1, 0.2, 0.3]])
    findMany.mockResolvedValueOnce([makeChunk('lex1'), makeChunk('sem1')])

    const result = await retrieveGuidelines(content, { profileId: 'adult-acute-urti', limit: 6 })

    const ids = findMany.mock.calls[0]?.[0]?.where?.id?.in as string[]
    expect(ids).toEqual(['lex1', 'sem1'])
    expect(result.map((c) => c.verbatimAllowed)).toEqual([true, true])
  })

  it('returns nothing when every candidate is below the floors', async () => {
    queryRaw
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ id: 'weak-lex', score: 0.1 }])
      .mockResolvedValueOnce([{ id: 'weak-sem', score: 0.3 }])
    embed.mockResolvedValueOnce([[0.1, 0.2, 0.3]])

    const result = await retrieveGuidelines(content, { profileId: 'adult-acute-urti' })

    expect(result).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('scopes every query to the requested profile', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 0 }])

    await retrieveGuidelines(content, { profileId: 'adult-acute-uncomplicated-uti' })

    const values = queryRaw.mock.calls[0]?.slice(1) as unknown[]
    expect(values).toContain('adult-acute-uncomplicated-uti')
  })
})
