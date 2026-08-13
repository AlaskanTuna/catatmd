import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('../lib/llm/index.js', () => ({
  getLLMClient: () => ({ provider: 'qwen', model: 'qwen-flash', generate }),
}))

import { getClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { corpusIdsFor } from '../guidelines/index.js'
import type { GenerateRequest } from '../lib/llm/types.js'
import { generateSuggestions } from './index.js'

const content =
  'Doctor: What brings you in? Patient: [PATIENT_1] here, cough 3 days.' as Deidentified

const firstCorpusId = corpusIdsFor(getClinicalProfile().guidelineCorpus)[0]

const emptyResponse = { outOfScope: false, redFlags: [], suggestions: [] }

beforeEach(() => {
  generate.mockReset()
  generate.mockResolvedValue(emptyResponse)
})

async function capturedRequest(): Promise<GenerateRequest<unknown>> {
  await generateSuggestions(content)
  const [request] = generate.mock.calls.at(-1) as [GenerateRequest<unknown>]
  return request
}

describe('generateSuggestions — call shape', () => {
  it('calls the LLM client egress point with the suggestions_and_red_flags operation', async () => {
    const request = await capturedRequest()

    expect(request.operation).toBe('suggestions_and_red_flags')
    expect(request.schemaName).toBe('suggestions_and_red_flags')
    expect(request.content).toBe(content)
  })

  it('returns the client response unchanged', async () => {
    const response = {
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'Symptomatic management is appropriate.',
          citations: [{ guidelineId: firstCorpusId }],
        },
      ],
    }
    generate.mockResolvedValue(response)

    await expect(generateSuggestions(content)).resolves.toEqual(response)
  })
})

describe('generateSuggestions — schema-enforced citation rejection (docs/trd.md §11)', () => {
  it('rejects a citation naming a guideline id outside the corpus', async () => {
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

  it('accepts a citation naming a guideline id inside the corpus', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'x',
          citations: [{ guidelineId: firstCorpusId }],
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects a suggestion with zero citations', async () => {
    const request = await capturedRequest()

    const result = request.schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [{ id: 's1', text: 'x', citations: [] }],
    })

    expect(result.success).toBe(false)
  })
})

describe('generateSuggestions — red flags cannot impersonate the rule engine (docs/trd.md §10)', () => {
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

describe('generateSuggestions — outOfScope signal (docs/trd.md §19 row 7)', () => {
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

describe('generateSuggestions — system prompt content', () => {
  it('states red-flag candidates are candidates only and can never override the rule engine', async () => {
    const request = await capturedRequest()

    expect(request.system).toMatch(/candidates? only/i)
    expect(request.system).toMatch(/never (override|suppress|downgrade)/i)
  })

  it('serialises every selected profile corpus id into the system prompt', async () => {
    const request = await capturedRequest()

    for (const id of corpusIdsFor(getClinicalProfile().guidelineCorpus)) {
      expect(request.system).toContain(id)
    }
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
