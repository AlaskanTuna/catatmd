import type { ClinicalSuggestion } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { filterUnsafeModelSuggestions } from './safety.js'

const suggestion = (
  id: string,
  text: string,
  quotes: readonly (string | undefined)[] = [undefined],
): ClinicalSuggestion => ({
  id,
  text,
  citations: quotes.map((quote) => ({
    guidelineId: 'guideline-1',
    ...(quote === undefined ? {} : { quote }),
  })),
})

describe('filterUnsafeModelSuggestions', () => {
  it('preserves safe cited suggestions in their original order', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('safe-1', 'Consider documenting the duration of symptoms.'),
      suggestion('safe-2', 'Consider checking the recorded observations.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe-1', 'safe-2'])
    expect(result.suppressedSuggestionIds).toEqual([])
  })

  it('suppresses diagnostic conclusions in suggestion text', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('diagnostic', 'Diagnosis: acute bronchitis.'),
      suggestion('asserted-diagnostic', 'This is pneumonia.'),
      suggestion('consistent-diagnostic', 'Findings are consistent with acute cystitis.'),
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual([
      'model-suggestion-1',
      'model-suggestion-2',
      'model-suggestion-3',
    ])
  })

  it('suppresses diagnostic language in every defined citation quote', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('quoted-diagnostic', 'Consider the documented findings.', [
        undefined,
        'The diagnosis is clinical.',
      ]),
      suggestion('safe', 'Consider documenting the review interval.', ['Review the record.']),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
  })

  it.each([
    'Prescribe nitrofurantoin.',
    'Rx amoxicillin.',
    'Do prescribe nitrofurantoin.',
    'Do start amoxicillin now.',
    'Should start amoxicillin immediately.',
    'Plan: prescribe nitrofurantoin.',
    'Start aspirin.',
    'Give insulin.',
    'Take amoxicillin.',
    'Use the salbutamol inhaler.',
    'The clinician should administer salbutamol.',
  ])('suppresses the autonomous medication order %s', (text) => {
    const result = filterUnsafeModelSuggestions([suggestion('model-authored-id', text)])

    expect(result.suggestions).toEqual([])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
  })

  it('suppresses autonomous medication orders and bare dose regimens', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('order', 'Prescribe amoxicillin 500 mg three times daily.'),
      suggestion('regimen', 'Amoxicillin 500 mg three times daily.'),
      suggestion('colon-regimen', 'Paracetamol: 500 mg three times daily.'),
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual([
      'model-suggestion-1',
      'model-suggestion-2',
      'model-suggestion-3',
    ])
  })

  it('suppresses named medication orders without a dose', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('named-order', 'Start amoxicillin.'),
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
  })

  it.each([
    'Do not prescribe antibiotics routinely.',
    'Consider prescribing antibiotics only if indicated.',
    'Do not start aspirin routinely.',
    'Do not take amoxicillin.',
    'Do not use antibiotics routinely.',
    'Consider starting insulin only if indicated.',
    'The clinician should not administer salbutamol routinely.',
    'Prescribing antibiotics is not routinely recommended.',
    'What dose of amoxicillin 500 mg is the patient currently taking?',
    'Do you currently take amoxicillin?',
    'Should the patient continue taking amoxicillin?',
    'Ask whether the patient was advised to start aspirin.',
    'Confirm whether the patient already took amoxicillin 250.5 mg.',
  ])('retains the non-autonomous medication wording %s', (text) => {
    const result = filterUnsafeModelSuggestions([suggestion('safe-model-id', text)])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe-model-id'])
    expect(result.suppressedSuggestionIds).toEqual([])
  })

  it('does not let a safe clause hide an autonomous order that follows it', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion(
        'mixed-model-id',
        'Do not prescribe antibiotics routinely, but start amoxicillin now.',
      ),
    ])

    expect(result.suggestions).toEqual([])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
  })

  it('does not let a trailing question hide an earlier autonomous order', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('mixed-model-id', 'Take amoxicillin now; do you understand?'),
    ])

    expect(result.suggestions).toEqual([])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
  })

  it('suppresses an unsafe citation quote without recording its prose', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('quoted-regimen', 'Consider the treatment context.', ['500 mg twice daily.']),
    ])

    expect(result.suggestions).toEqual([])
    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
    expect(JSON.stringify(result)).not.toContain('500 mg')
  })

  it('never carries a model-authored identifier into suppression metadata', () => {
    const unsafeId = '[PATIENT_1] reports burning urination and a new fever.'
    const result = filterUnsafeModelSuggestions([suggestion(unsafeId, 'Prescribe nitrofurantoin.')])

    expect(result.suppressedSuggestionIds).toEqual(['model-suggestion-1'])
    expect(JSON.stringify(result.suppressedSuggestionIds)).not.toContain(unsafeId)
  })
})
