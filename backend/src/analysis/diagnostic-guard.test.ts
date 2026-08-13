import type { InformationGap, SoapNote } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { LLMResponseError } from '../lib/llm/index.js'
import { assertNoDiagnosticProse } from './diagnostic-guard.js'

const note = (assessment: string): SoapNote => ({
  subjective: '',
  objective: '',
  assessment,
  plan: '',
})

const gap = (question: string, rationale: string): InformationGap => ({
  id: 'gap-1',
  question,
  rationale,
  priority: 'medium',
})

describe('assertNoDiagnosticProse (docs/prd.md §10)', () => {
  it('allows an assessment that summarises findings without naming a diagnosis', () => {
    expect(() =>
      assertNoDiagnosticProse(
        note('Cough and sore throat for 3 days, throat erythematous on exam.'),
        [],
      ),
    ).not.toThrow()
  })

  it('rejects an assessment that states a diagnosis', () => {
    expect(() =>
      assertNoDiagnosticProse(note('Diagnosis: viral upper respiratory tract infection.'), []),
    ).toThrow(LLMResponseError)
  })

  it('rejects a gap rationale that implies a differential', () => {
    expect(() =>
      assertNoDiagnosticProse(note(''), [
        gap('Any exposure history?', 'Differential includes bacterial pharyngitis.'),
      ]),
    ).toThrow(LLMResponseError)
  })

  it('names the offending field, never the diagnostic content, in the error', () => {
    const err = (() => {
      try {
        assertNoDiagnosticProse(note('Impression: likely viral.'), [])
      } catch (e) {
        return e
      }
    })()

    expect(err).toBeInstanceOf(LLMResponseError)
    expect((err as Error).message).toContain('note.assessment')
    expect((err as Error).message).not.toContain('viral')
  })
})
