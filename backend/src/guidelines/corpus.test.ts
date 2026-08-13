import {
  CitationSchema,
  GuidelineChunkSchema,
  makeSuggestionsAndRedFlagsSchema,
} from '@shared/types'
import { describe, expect, it } from 'vitest'
import { corpusIds, GUIDELINE_CORPUS } from './corpus.js'

describe('guideline corpus', () => {
  it('has 10-15 chunks scoped to adult acute cough / sore throat / URTI', () => {
    expect(GUIDELINE_CORPUS.length).toBeGreaterThanOrEqual(10)
    expect(GUIDELINE_CORPUS.length).toBeLessThanOrEqual(15)
  })

  it('validates every chunk against GuidelineChunkSchema', () => {
    for (const chunk of GUIDELINE_CORPUS) {
      expect(GuidelineChunkSchema.safeParse(chunk).success).toBe(true)
    }
  })

  it('never puts a quote on a chunk whose licence forbids verbatim reuse', () => {
    for (const chunk of GUIDELINE_CORPUS) {
      if (!chunk.verbatimAllowed) {
        expect(chunk.quote).toBeUndefined()
      }
    }
  })

  it('does not blend two publishers in one chunk summary (docs/trd.md §11)', () => {
    const publishers = [...new Set(GUIDELINE_CORPUS.map((chunk) => chunk.publisher))]
    for (const chunk of GUIDELINE_CORPUS) {
      const otherPublishers = publishers.filter((publisher) => publisher !== chunk.publisher)
      for (const otherPublisher of otherPublishers) {
        expect(chunk.summary).not.toContain(otherPublisher)
      }
    }
  })

  it('has no duplicate ids', () => {
    const ids = GUIDELINE_CORPUS.map((chunk) => chunk.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects an adversarial response citing a guideline ID outside the corpus', () => {
    const schema = makeSuggestionsAndRedFlagsSchema(corpusIds)
    const adversarial = {
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 'sugg-1',
          text: 'Consider antibiotics per invented guidance.',
          citations: [{ guidelineId: 'invented-guideline-id-that-does-not-exist' }],
        },
      ],
    }

    expect(schema.safeParse(adversarial).success).toBe(false)
  })

  it('rejects a free-text reference with no guideline ID', () => {
    const freeText = { quote: 'According to general medical knowledge, antibiotics may help.' }
    expect(CitationSchema.safeParse(freeText).success).toBe(false)

    const schema = makeSuggestionsAndRedFlagsSchema(corpusIds)
    const adversarial = {
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 'sugg-1',
          text: 'Consider antibiotics.',
          citations: [{ quote: 'According to general medical knowledge, antibiotics may help.' }],
        },
      ],
    }

    expect(schema.safeParse(adversarial).success).toBe(false)
  })

  it('accepts a response citing a real corpus ID', () => {
    const schema = makeSuggestionsAndRedFlagsSchema(corpusIds)
    const valid = {
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 'sugg-1',
          text: 'Consider antibiotics per Modified Centor scoring.',
          citations: [{ guidelineId: corpusIds[0] }],
        },
      ],
    }

    expect(schema.safeParse(valid).success).toBe(true)
  })
})
