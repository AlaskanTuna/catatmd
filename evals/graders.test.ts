import type { ConsultationAnalysis, Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  gradeCitationValidity,
  gradeEvidenceGrounding,
  gradeFactCoverage,
  gradeRedFlagRecall,
  gradeRuleAttribution,
} from './graders.js'

/**
 * The graders are the part of this harness that can fail silently.
 *
 * A grader that always returns `passed: true` produces a green report on a
 * broken pipeline, which is worse than having no harness at all: it converts
 * "we do not know" into "we checked". So the graders are tested here, in CI,
 * for free, and each one is given an input it must reject.
 */

const transcript: Transcript = {
  source: 'fixture',
  turns: [
    { speaker: 'doctor', text: 'What brings you in today?' },
    { speaker: 'patient', text: 'Sore throat for three days, and I cannot swallow properly.' },
  ],
}

function analysis(over: Partial<ConsultationAnalysis> = {}): ConsultationAnalysis {
  return {
    note: { subjective: '', objective: '', assessment: '', plan: '' },
    gaps: [],
    redFlags: [],
    suggestions: [],
    ...over,
  } as ConsultationAnalysis
}

const ruleFlag = (ruleId: string) => ({
  id: `rf-${ruleId}`,
  label: 'x',
  severity: 'emergency' as const,
  evidence: 'cannot swallow',
  source: 'rule' as const,
  ruleId,
})

describe('red-flag recall', () => {
  it('fails when an expected rule hit is missing', () => {
    const finding = gradeRedFlagRecall(analysis(), ['swallowing-difficulty'])

    expect(finding.passed).toBe(false)
    expect(finding.detail).toContain('swallowing-difficulty')
  })

  it('passes when every expected rule hit is present', () => {
    const finding = gradeRedFlagRecall(
      analysis({ redFlags: [ruleFlag('swallowing-difficulty')] }),
      ['swallowing-difficulty'],
    )

    expect(finding.passed).toBe(true)
  })

  it('allows the model to add candidates beyond the expected set', () => {
    // The invariant is that the model may add and may never suppress, so this
    // is a subset check. Asserting equality here would turn legitimate output
    // into a failure and train everyone to ignore the report.
    const finding = gradeRedFlagRecall(
      analysis({
        redFlags: [
          ruleFlag('swallowing-difficulty'),
          { ...ruleFlag('extra'), source: 'model', ruleId: undefined },
        ],
      }),
      ['swallowing-difficulty'],
    )

    expect(finding.passed).toBe(true)
  })

  it('does not count a model-sourced flag towards recall', () => {
    // A suppression bug that re-badges a rule hit as model output would
    // otherwise pass recall while the deterministic guarantee is gone.
    const finding = gradeRedFlagRecall(
      analysis({ redFlags: [{ ...ruleFlag('swallowing-difficulty'), source: 'model' }] }),
      ['swallowing-difficulty'],
    )

    expect(finding.passed).toBe(false)
  })
})

describe('rule attribution', () => {
  it('fails when an expected rule hit arrives badged as model output', () => {
    const finding = gradeRuleAttribution(
      analysis({ redFlags: [{ ...ruleFlag('swallowing-difficulty'), source: 'model' }] }),
      ['swallowing-difficulty'],
    )

    expect(finding.passed).toBe(false)
  })

  it('ignores model candidates that are not expected rules', () => {
    const finding = gradeRuleAttribution(
      analysis({ redFlags: [{ ...ruleFlag('something-else'), source: 'model' }] }),
      ['swallowing-difficulty'],
    )

    expect(finding.passed).toBe(true)
  })
})

describe('citation validity', () => {
  it('fails on a citation outside the corpus', () => {
    const finding = gradeCitationValidity(
      analysis({
        suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: 'invented-2024' }] }],
      }),
      ['moh-nag-2024-urti'],
    )

    expect(finding.passed).toBe(false)
    expect(finding.detail).toContain('invented-2024')
  })

  it('passes when every citation resolves', () => {
    const finding = gradeCitationValidity(
      analysis({
        suggestions: [{ id: 's1', text: 'x', citations: [{ guidelineId: 'moh-nag-2024-urti' }] }],
      }),
      ['moh-nag-2024-urti'],
    )

    expect(finding.passed).toBe(true)
  })
})

describe('evidence grounding', () => {
  it('fails on an asserted span that is not in the transcript', () => {
    const finding = gradeEvidenceGrounding(
      analysis({
        clinicalFacts: {
          symptoms: { soreThroat: { state: 'PRESENT', evidence: 'high fever for a week' } },
          history: {},
          observations: {},
          examination: {},
        },
      } as Partial<ConsultationAnalysis>),
      transcript,
    )

    expect(finding.passed).toBe(false)
    expect(finding.detail).toContain('symptoms.soreThroat')
  })

  it('passes on a verbatim span, ignoring whitespace and case', () => {
    const finding = gradeEvidenceGrounding(
      analysis({
        clinicalFacts: {
          symptoms: { soreThroat: { state: 'PRESENT', evidence: 'Sore   throat for THREE days' } },
          history: {},
          observations: {},
          examination: {},
        },
      } as Partial<ConsultationAnalysis>),
      transcript,
    )

    expect(finding.passed).toBe(true)
  })

  it('ignores NOT_ASSESSED fields, which carry no span by design', () => {
    const finding = gradeEvidenceGrounding(
      analysis({
        clinicalFacts: {
          symptoms: { soreThroat: { state: 'NOT_ASSESSED' } },
          history: {},
          observations: {},
          examination: {},
        },
      } as Partial<ConsultationAnalysis>),
      transcript,
    )

    expect(finding.passed).toBe(true)
  })
})

describe('fact coverage', () => {
  it('reports established over total and never fails', () => {
    const finding = gradeFactCoverage(
      analysis({
        clinicalFacts: {
          symptoms: {
            soreThroat: { state: 'PRESENT', evidence: 'Sore throat for three days' },
            fever: { state: 'NOT_ASSESSED' },
          },
          history: {},
          observations: {},
          examination: {},
        },
      } as Partial<ConsultationAnalysis>),
    )

    expect(finding.detail).toContain('1/2')
    // Informational by design: a field the consultation never touched is
    // correctly NOT_ASSESSED, so there is no threshold to fail against.
    expect(finding.passed).toBe(true)
    expect(finding.severity).toBe('informational')
  })
})
