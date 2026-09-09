import type { ConsultationAnalysis } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { LEGACY_TO_DOCUMENT, modernizeCitationId, withLegacyCitations } from './legacy.js'

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

describe('the legacy map', () => {
  it('names exactly the eleven ids of guideline-corpus-v4 and nothing else', () => {
    expect(Object.keys(LEGACY_TO_DOCUMENT).sort()).toEqual(
      [
        'abdullah-2024-mcisaac-criteria',
        'abdullah-2024-mcisaac-threshold',
        'abdullah-2024-safety-netting',
        'moh-nag-2024-a10-modified-centor',
        'moh-nag-2024-acute-uti-scope',
        'moh-nag-2024-c1-acute-pharyngitis',
        'moh-nag-2024-c1-viral-vs-bacterial',
        'moh-nag-2024-c3-acute-bronchitis',
        'moh-nag-2024-c4-uncomplicated-urti',
        'ooi-2022-antibiotic-prescribing-patterns',
        'ooi-2022-urti-epidemiology',
      ].sort(),
    )
  })

  it('rewrites a bracketed legacy id inside suggestion prose', () => {
    const out = withLegacyCitations({
      redFlags: [],
      gaps: [],
      suggestions: [
        {
          id: 's1',
          text: '[moh-nag-2024-c1-viral-vs-bacterial] The transcript notes a temperature.',
          citations: [{ guidelineId: 'moh-nag-2024-c1-viral-vs-bacterial' }],
        },
      ],
    } as never) as { suggestions: { text: string }[] }
    expect(out.suggestions[0]?.text).toBe('[doc:moh-nag-2024] The transcript notes a temperature.')
  })
})
