import type { ConsultationAnalysis, GapSource, InformationGap } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { ALL_GAP_CHECKLIST } from './checklist.js'
import { withGapProvenance } from './provenance.js'

const NOTE = {
  subjective: 'Cough.',
  objective: 'Clear.',
  assessment: 'Under review.',
  plan: 'Supportive.',
}

function analysisWithGaps(gaps: InformationGap[]): ConsultationAnalysis {
  return {
    note: NOTE,
    gaps,
    redFlags: [],
    suggestions: [],
  }
}

describe('withGapProvenance', () => {
  it('passes a null analysis through unchanged', () => {
    expect(withGapProvenance(null)).toBeNull()
  })

  it('fills a missing source from the checklist', () => {
    const gap: InformationGap = {
      id: 'fever',
      question: 'Has the patient had a fever?',
      rationale: 'Fever status is not documented.',
      priority: 'medium',
    }

    const result = withGapProvenance(analysisWithGaps([gap]))
    const entry = ALL_GAP_CHECKLIST.find((e) => e.id === 'fever')
    if (entry === undefined) throw new Error('missing checklist entry')

    expect(result?.gaps.at(0)?.source).toEqual(entry.source)
    expect(result?.gaps.at(0)?.source).not.toBe(entry.source)
  })

  it('copies an unsourced checklist reason onto a legacy gap', () => {
    const gap: InformationGap = {
      id: 'cough-duration',
      question: 'How long has the cough been present?',
      rationale: 'Duration is not documented.',
      priority: 'medium',
    }

    const result = withGapProvenance(analysisWithGaps([gap]))
    const entry = ALL_GAP_CHECKLIST.find((e) => e.id === 'cough-duration')
    if (entry === undefined) throw new Error('missing checklist entry')

    expect(result?.gaps.at(0)?.source).toEqual(entry.source)
  })

  it('leaves an existing source alone', () => {
    const source: GapSource = { kind: 'guideline', guidelineIds: ['custom-guideline'] }
    const gap: InformationGap = {
      id: 'fever',
      question: 'Has the patient had a fever?',
      rationale: 'Fever status is not documented.',
      priority: 'medium',
      source,
    }

    const result = withGapProvenance(analysisWithGaps([gap]))

    expect(result?.gaps.at(0)?.source).toBe(source)
  })

  it('leaves a model-authored gap with an unknown id untouched', () => {
    const gap: InformationGap = {
      id: 'model-gap',
      question: 'A model-authored question.',
      rationale: 'No checklist entry backs this.',
      priority: 'low',
    }

    const result = withGapProvenance(analysisWithGaps([gap]))

    expect(result?.gaps.at(0)?.source).toBeUndefined()
  })

  it('does not mutate the input analysis', () => {
    const gap: InformationGap = {
      id: 'fever',
      question: 'Has the patient had a fever?',
      rationale: 'Fever status is not documented.',
      priority: 'medium',
    }
    const analysis = analysisWithGaps([gap])
    const before = JSON.stringify(analysis)

    withGapProvenance(analysis)

    expect(JSON.stringify(analysis)).toBe(before)
  })

  it('returns the input unchanged when analysis is not an object', () => {
    expect(withGapProvenance('not-an-object' as unknown as ConsultationAnalysis)).toBe(
      'not-an-object',
    )
  })

  it('returns the input unchanged when gaps is not an array', () => {
    const malformed = {
      note: NOTE,
      redFlags: [],
      suggestions: [],
      gaps: 'not-an-array',
    }

    expect(withGapProvenance(malformed as unknown as ConsultationAnalysis)).toEqual(malformed)
  })
})
