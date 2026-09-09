import type { ConsultationAnalysis } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { modernizeCitationId, withLegacyCitations } from './legacy.js'

const LEGACY_CASES = [
  ['moh-nag-2024-a10-modified-centor', 'doc:moh-nag-2024'],
  ['moh-nag-2024-c1-acute-pharyngitis', 'doc:moh-nag-2024'],
  ['moh-nag-2024-c1-viral-vs-bacterial', 'doc:moh-nag-2024'],
  ['moh-nag-2024-c3-acute-bronchitis', 'doc:moh-nag-2024'],
  ['moh-nag-2024-c4-uncomplicated-urti', 'doc:moh-nag-2024'],
  ['moh-nag-2024-acute-uti-scope', 'doc:moh-nag-2024'],
  ['abdullah-2024-mcisaac-criteria', 'doc:abdullah-2024-idr-sore-throat'],
  ['abdullah-2024-mcisaac-threshold', 'doc:abdullah-2024-idr-sore-throat'],
  ['abdullah-2024-safety-netting', 'doc:abdullah-2024-idr-sore-throat'],
  ['ooi-2022-urti-epidemiology', 'doc:ooi-2022-mfp-urti'],
  ['ooi-2022-antibiotic-prescribing', 'doc:ooi-2022-mfp-urti'],
] as const

describe('modernizeCitationId', () => {
  it.each(LEGACY_CASES)('maps %s to %s', (id, expected) => {
    expect(modernizeCitationId(id)).toBe(expected)
  })

  it('leaves a retrieved chunk id untouched', () => {
    expect(modernizeCitationId('moh-nag-2024-p348-c1')).toBe('moh-nag-2024-p348-c1')
  })

  it('leaves an unrelated id untouched', () => {
    expect(modernizeCitationId('retrieved-cpg-p3')).toBe('retrieved-cpg-p3')
  })
})

describe('withLegacyCitations', () => {
  const base = {
    note: {
      subjective: 'S',
      objective: 'O',
      assessment: 'A',
      plan: 'P',
    },
  } as const

  it('rewrites a red flag, a gap and a suggestion citation', () => {
    const analysis = {
      ...base,
      redFlags: [
        {
          id: 'rf-1',
          label: 'Emergency red flag',
          severity: 'emergency' as const,
          evidence: 'cannot swallow',
          source: 'rule' as const,
          ruleId: 'r1',
          guidelineIds: ['moh-nag-2024-a10-modified-centor'],
        },
      ],
      gaps: [
        {
          id: 'g1',
          question: 'Duration?',
          rationale: 'Needed',
          priority: 'high' as const,
          source: { kind: 'guideline' as const, guidelineIds: ['abdullah-2024-mcisaac-criteria'] },
        },
      ],
      suggestions: [
        {
          id: 's1',
          text: 'Safety-net advice',
          citations: [{ guidelineId: 'ooi-2022-urti-epidemiology' }],
        },
      ],
    } as unknown as ConsultationAnalysis

    const modern = withLegacyCitations(analysis) as ConsultationAnalysis

    expect(modern.redFlags[0]?.guidelineIds).toEqual(['doc:moh-nag-2024'])
    expect(modern.gaps[0]?.source).toEqual({
      kind: 'guideline',
      guidelineIds: ['doc:abdullah-2024-idr-sore-throat'],
    })
    expect(modern.suggestions[0]?.citations).toEqual([{ guidelineId: 'doc:ooi-2022-mfp-urti' }])
  })

  it('collapses two NAG chunk ids into one doc reference', () => {
    const analysis = {
      ...base,
      redFlags: [
        {
          id: 'rf-1',
          label: 'Emergency red flag',
          severity: 'emergency' as const,
          evidence: 'cannot swallow',
          source: 'rule' as const,
          ruleId: 'r1',
          guidelineIds: ['moh-nag-2024-c1-acute-pharyngitis', 'moh-nag-2024-c3-acute-bronchitis'],
        },
      ],
      gaps: [],
      suggestions: [],
    } as unknown as ConsultationAnalysis

    const modern = withLegacyCitations(analysis) as ConsultationAnalysis

    expect(modern.redFlags[0]?.guidelineIds).toEqual(['doc:moh-nag-2024'])
  })

  it('leaves unrelated citations unchanged', () => {
    const analysis = {
      ...base,
      redFlags: [
        {
          id: 'rf-1',
          label: 'Red flag',
          severity: 'advisory' as const,
          evidence: 'x',
          source: 'rule' as const,
          ruleId: 'r1',
          guidelineIds: ['retrieved-cpg-p3'],
        },
      ],
      gaps: [],
      suggestions: [],
    } as unknown as ConsultationAnalysis

    const modern = withLegacyCitations(analysis) as ConsultationAnalysis

    expect(modern.redFlags[0]?.guidelineIds).toEqual(['retrieved-cpg-p3'])
  })
})
