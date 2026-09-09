import type { GuidelineChunk } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('../lib/llm/index.js', () => ({
  getLLMClient: () => ({ provider: 'qwen', model: 'qwen-flash', generate }),
}))

import { getClinicalProfile } from '../clinical-profiles/index.js'
import { deidentify } from '../deid/index.js'
import type { GenerateRequest } from '../lib/llm/types.js'
import { generateSuggestions } from './index.js'

/**
 * Minted through the gate rather than cast into the brand (issue #86). The text
 * is already tokenised, so `deidentify` is a no-op on it and the fixture is
 * unchanged; what changes is that this no longer asserts the value came through
 * the gate, it demonstrates it.
 */
const { text: content } = deidentify(
  'Doctor: What brings you in? Patient: [PATIENT_1] here, cough 3 days.',
)

const sampleChunk: GuidelineChunk = {
  id: 'retrieved-cpg-p3',
  title: 'Clinical Practice Guideline, p. 3: Antibiotics',
  publisher: 'MOH',
  year: 2024,
  url: 'https://example.com/cpg',
  summary: 'Summary text.',
  sourceLicence: 'MOH-ARR',
  verbatimAllowed: true,
  documentId: 'doc-1',
  page: 3,
}

const citableId = sampleChunk.id

const emptyResponse = { outOfScope: false, redFlags: [], suggestions: [] }

beforeEach(() => {
  generate.mockReset()
  generate.mockResolvedValue(emptyResponse)
})

async function capturedRequest(
  retrieved: readonly GuidelineChunk[] = [],
): Promise<GenerateRequest<unknown>> {
  await generateSuggestions(content, getClinicalProfile(), retrieved)
  const [request] = generate.mock.calls.at(-1) as [GenerateRequest<unknown>]
  return request
}

describe('generateSuggestions - call shape', () => {
  it('calls the LLM client egress point with the suggestions_and_red_flags operation', async () => {
    const request = await capturedRequest()

    expect(request.operation).toBe('suggestions_and_red_flags')
    expect(request.schemaName).toBe('suggestions_and_red_flags')
    expect(request.content).toBe(content)
  })

  it('returns the client response unchanged when the corpus is non-empty', async () => {
    const response = {
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'Symptomatic management is appropriate.',
          citations: [{ guidelineId: citableId }],
        },
      ],
    }
    generate.mockResolvedValue(response)

    await expect(
      generateSuggestions(content, getClinicalProfile(), [sampleChunk]),
    ).resolves.toEqual({
      ...response,
      suppressedSuggestionIds: [],
    })
  })

  it('filters unsafe model suggestions after the decoded response and reports ids only', async () => {
    generate.mockResolvedValue({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 'unsafe-prescribing',
          text: 'Prescribe amoxicillin 500 mg three times daily.',
          citations: [{ guidelineId: citableId }],
        },
        {
          id: 'safe-consideration',
          text: 'Consider documenting the review interval.',
          citations: [{ guidelineId: citableId }],
        },
      ],
    })

    await expect(
      generateSuggestions(content, getClinicalProfile(), [sampleChunk]),
    ).resolves.toEqual({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 'safe-consideration',
          text: 'Consider documenting the review interval.',
          citations: [{ guidelineId: citableId }],
        },
      ],
      suppressedSuggestionIds: ['model-suggestion-1'],
    })
  })

  it('replaces a rejected model-authored id with a server-generated suppression id', async () => {
    const unsafeId = '[PATIENT_1] reports burning urination and a new fever.'
    generate.mockResolvedValue({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: unsafeId,
          text: 'Prescribe nitrofurantoin.',
          citations: [{ guidelineId: citableId }],
        },
      ],
    })

    const result = await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
    expect(JSON.stringify(result.suppressedSuggestionIds)).not.toContain(unsafeId)
  })
})

describe('generateSuggestions - empty corpus', () => {
  it('preserves the model outOfScope signal and red-flag candidates, with no suggestions', async () => {
    const redFlags = [
      {
        id: 'm1',
        label: 'Possible aspiration',
        severity: 'urgent',
        evidence: 'cannot swallow',
        source: 'model',
      },
    ]
    generate.mockResolvedValue({ outOfScope: false, redFlags, suggestions: [] })

    await expect(generateSuggestions(content)).resolves.toEqual({
      outOfScope: false,
      redFlags,
      suggestions: [],
      suppressedSuggestionIds: [],
    })
  })

  it('tells the model no citable corpus is available', async () => {
    const request = await capturedRequest()

    expect(request.system).toMatch(/no citable guideline corpus/i)
  })

  it('rejects any suggestion when the corpus is empty', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'x',
          citations: [{ guidelineId: 'not-a-real-corpus-id' }],
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('still allows model red-flag candidates with no corpus', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: true,
      redFlags: [
        {
          id: 'm1',
          label: 'Possible peritonsillar abscess',
          severity: 'urgent',
          evidence: 'cannot open mouth fully',
          source: 'model',
        },
      ],
      suggestions: [],
    })

    expect(result.success).toBe(true)
  })
})

describe('generateSuggestions - schema-enforced citation rejection (docs/trd.md §11)', () => {
  it('rejects a citation naming a guideline id outside the corpus', async () => {
    const request = await capturedRequest([sampleChunk])

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'x',
          citations: [{ guidelineId: 'not-a-real-corpus-id' }],
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a citation naming a guideline id inside the corpus', async () => {
    const request = await capturedRequest([sampleChunk])

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'x',
          citations: [{ guidelineId: citableId }],
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('accepts a retrieved chunk id and rejects a foreign id', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])
    const [request] = generate.mock.calls.at(-1) as [GenerateRequest<unknown>]

    expect(request.system).toContain(citableId)

    const accepted = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: citableId }] }],
    })
    expect(accepted.success).toBe(true)

    const rejected = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [{ id: 's2', text: 'x', citations: [{ guidelineId: 'foreign-id' }] }],
    })
    expect(rejected.success).toBe(false)
  })

  it('rejects a suggestion with zero citations', async () => {
    const request = await capturedRequest([sampleChunk])

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [{ id: 's1', text: 'x', citations: [] }],
    })

    expect(result.success).toBe(false)
  })
})

describe('generateSuggestions - red flags cannot impersonate the rule engine (docs/trd.md §10)', () => {
  it('rejects a red flag that claims source: "rule"', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [
        { id: 'x', label: 'x', severity: 'advisory', evidence: 'x', source: 'rule', ruleId: 'x' },
      ],
      suggestions: [],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a red flag with source: "model" and no ruleId', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [{ id: 'x', label: 'x', severity: 'advisory', evidence: 'x', source: 'model' }],
      suggestions: [],
    })

    expect(result.success).toBe(true)
  })
})

describe('generateSuggestions - outOfScope signal (docs/trd.md §19 row 7)', () => {
  it('accepts outOfScope: true with an empty suggestions array', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: true,
      redFlags: [],
      suggestions: [],
    })

    expect(result.success).toBe(true)
  })
})

describe('generateSuggestions - system prompt content', () => {
  it('states red-flag candidates are candidates only and can never override the rule engine', async () => {
    const request = await capturedRequest()

    expect(request.system).toMatch(/candidates? only/i)
    expect(request.system).toMatch(/never (override|suppress|downgrade)/i)
  })

  it('serialises every retrieved chunk id into the system prompt', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])
    const [request] = generate.mock.calls.at(-1) as [GenerateRequest<unknown>]

    expect(request.system).toContain(citableId)
  })

  it('instructs the model to never state a diagnosis', async () => {
    const request = await capturedRequest()

    expect(request.system).toMatch(/never state a diagnosis/i)
  })

  it('does not itself state or imply a diagnosis', async () => {
    const request = await capturedRequest()

    expect(request.system).not.toMatch(/\b(patient has|diagnosed with|suffering from)\b/i)
  })
})
