import type { ClinicalSuggestion } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { filterUnsafeModelSuggestions } from './safety.js'

const suggestion = (
  id: string,
  text: string,
  quotes: readonly (string | undefined)[] = [],
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
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual(['diagnostic'])
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
    expect(result.suppressedSuggestionIds).toEqual(['quoted-diagnostic'])
  })

  it('suppresses autonomous medication orders and bare dose regimens', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('order', 'Prescribe amoxicillin 500 mg three times daily.'),
      suggestion('regimen', 'Amoxicillin 500 mg three times daily.'),
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual(['order', 'regimen'])
  })

  it('suppresses named medication orders without a dose', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('named-order', 'Start amoxicillin.'),
      suggestion('safe', 'Consider documenting the review interval.'),
    ])

    expect(result.suggestions.map(({ id }) => id)).toEqual(['safe'])
    expect(result.suppressedSuggestionIds).toEqual(['named-order'])
  })

  it('suppresses an unsafe citation quote without recording its prose', () => {
    const result = filterUnsafeModelSuggestions([
      suggestion('quoted-regimen', 'Consider the treatment context.', ['500 mg twice daily.']),
    ])

    expect(result.suggestions).toEqual([])
    expect(result.suppressedSuggestionIds).toEqual(['quoted-regimen'])
    expect(JSON.stringify(result)).not.toContain('500 mg')
  })
})
