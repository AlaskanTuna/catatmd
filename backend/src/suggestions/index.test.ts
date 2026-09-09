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

type Overrides = {
  outOfScope?: boolean
  redFlags?: unknown[]
  suggestions?: unknown[]
}

/**
 * The two halves answer different schemas since #340, so the mock dispatches on
 * the operation rather than returning one shape to both.
 */
function respond(overrides: Overrides = {}): void {
  generate.mockImplementation((request: GenerateRequest<unknown>) =>
    request.operation === 'red_flags'
      ? Promise.resolve({
          outOfScope: overrides.outOfScope ?? false,
          redFlags: overrides.redFlags ?? [],
        })
      : Promise.resolve({ suggestions: overrides.suggestions ?? [] }),
  )
}

function requestFor(operation: 'red_flags' | 'suggestions'): GenerateRequest<unknown> {
  const call = generate.mock.calls.find(
    ([request]) => (request as GenerateRequest<unknown>).operation === operation,
  )
  if (!call) throw new Error(`no ${operation} call was made`)
  return call[0] as GenerateRequest<unknown>
}

function operationsCalled(): string[] {
  return generate.mock.calls.map(([request]) => (request as GenerateRequest<unknown>).operation)
}

beforeEach(() => {
  generate.mockReset()
  respond()
})

describe('generateSuggestions - call shape', () => {
  it('reaches the provider only through the LLM client egress point, once per half', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    expect(operationsCalled().sort()).toEqual(['red_flags', 'suggestions'])
    expect(requestFor('red_flags').schemaName).toBe('red_flags')
    expect(requestFor('suggestions').schemaName).toBe('suggestions')
    expect(requestFor('red_flags').content).toBe(content)
    expect(requestFor('suggestions').content).toBe(content)
  })

  it('returns the client response unchanged when the corpus is non-empty', async () => {
    const suggestions = [
      {
        id: 's1',
        text: 'Symptomatic management is appropriate.',
        citations: [{ guidelineId: citableId }],
      },
    ]
    respond({ suggestions })

    await expect(
      generateSuggestions(content, getClinicalProfile(), [sampleChunk]),
    ).resolves.toEqual({
      outOfScope: false,
      redFlags: [],
      suggestions,
      suppressedSuggestionIds: [],
    })
  })

  it('filters unsafe model suggestions after the decoded response and reports ids only', async () => {
    respond({
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
    respond({
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
  /*
   * The saving that motivated the split (#340). The citable corpus is the
   * retrieved set, so nothing retrieved means no cited suggestion is possible.
   * That used to be a model call whose answer was discarded and replaced with
   * an empty array.
   */
  it('makes no suggestions call at all when nothing was retrieved', async () => {
    await generateSuggestions(content)

    expect(operationsCalled()).toEqual(['red_flags'])
  })

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
    respond({ redFlags })

    await expect(generateSuggestions(content)).resolves.toEqual({
      outOfScope: false,
      redFlags,
      suggestions: [],
      suppressedSuggestionIds: [],
    })
  })

  /*
   * An empty retrieval is not an out-of-scope consultation, and the review page
   * renders those as two different sentences. Deriving the signal from the
   * corpus would collapse that distinction.
   */
  it('does not report out of scope merely because nothing was retrieved', async () => {
    respond({ outOfScope: false })

    await expect(generateSuggestions(content)).resolves.toMatchObject({ outOfScope: false })
  })
})

describe('generateSuggestions - schema-enforced citation rejection (docs/trd.md §11)', () => {
  it('rejects a citation naming a guideline id outside the corpus', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    const result = requestFor('suggestions').schema.safeParse({
      suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: 'not-a-real-corpus-id' }] }],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a citation naming a guideline id inside the corpus', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    const result = requestFor('suggestions').schema.safeParse({
      suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: citableId }] }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects a suggestion with zero citations', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    const result = requestFor('suggestions').schema.safeParse({
      suggestions: [{ id: 's1', text: 'x', citations: [] }],
    })

    expect(result.success).toBe(false)
  })
})

describe('generateSuggestions - red flags cannot impersonate the rule engine (docs/trd.md §10)', () => {
  it('rejects a red flag that claims source: "rule"', async () => {
    await generateSuggestions(content)

    const result = requestFor('red_flags').schema.safeParse({
      outOfScope: false,
      redFlags: [
        { id: 'x', label: 'x', severity: 'advisory', evidence: 'x', source: 'rule', ruleId: 'x' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a red flag with source: "model" and no ruleId', async () => {
    await generateSuggestions(content)

    const result = requestFor('red_flags').schema.safeParse({
      outOfScope: false,
      redFlags: [{ id: 'x', label: 'x', severity: 'advisory', evidence: 'x', source: 'model' }],
    })

    expect(result.success).toBe(true)
  })
})

describe('generateSuggestions - outOfScope signal (docs/trd.md §19 row 7)', () => {
  it('accepts outOfScope: true from the half that always runs', async () => {
    await generateSuggestions(content)

    const result = requestFor('red_flags').schema.safeParse({ outOfScope: true, redFlags: [] })

    expect(result.success).toBe(true)
  })

  /*
   * One call could suppress its own suggestions when it judged the consultation
   * out of scope. Two concurrent calls cannot, because the citing half is never
   * told the verdict, so the suppression became deterministic here instead.
   */
  it('drops suggestions when the scope verdict says the corpus does not apply', async () => {
    respond({
      outOfScope: true,
      suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: citableId }] }],
    })

    await expect(
      generateSuggestions(content, getClinicalProfile(), [sampleChunk]),
    ).resolves.toMatchObject({ outOfScope: true, suggestions: [] })
  })

  it('keeps red-flag candidates even when the consultation is out of scope', async () => {
    const redFlags = [
      {
        id: 'm1',
        label: 'Possible peritonsillar abscess',
        severity: 'urgent',
        evidence: 'cannot open mouth fully',
        source: 'model',
      },
    ]
    respond({ outOfScope: true, redFlags })

    await expect(
      generateSuggestions(content, getClinicalProfile(), [sampleChunk]),
    ).resolves.toMatchObject({ redFlags })
  })
})

describe('generateSuggestions - system prompt content', () => {
  it('states red-flag candidates are candidates only and can never override the rule engine', async () => {
    await generateSuggestions(content)

    const system = requestFor('red_flags').system
    expect(system).toMatch(/candidates? only/i)
    expect(system).toMatch(/never (override|suppress|downgrade)/i)
  })

  /*
   * The input-token half of the split. Red-flag candidates are read out of the
   * transcript, not out of a guideline, so the retrieved set has no business in
   * this prompt and used to be serialised into it on every analysis.
   */
  it('never serialises the corpus into the red-flag prompt', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    expect(requestFor('red_flags').system).not.toContain(citableId)
    expect(requestFor('red_flags').system).not.toContain(sampleChunk.summary)
  })

  it('serialises every retrieved chunk id into the suggestions prompt', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    expect(requestFor('suggestions').system).toContain(citableId)
  })

  it('instructs the model to never state a diagnosis', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    expect(requestFor('suggestions').system).toMatch(/never state a diagnosis/i)
  })

  it('does not itself state or imply a diagnosis, on either half', async () => {
    await generateSuggestions(content, getClinicalProfile(), [sampleChunk])

    for (const operation of ['red_flags', 'suggestions'] as const) {
      expect(requestFor(operation).system).not.toMatch(
        /\b(patient has|diagnosed with|suffering from)\b/i,
      )
    }
  })
})
