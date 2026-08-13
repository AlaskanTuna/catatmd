import type { InformationGap, SoapNote } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { stripDiagnosticProse } from './diagnostic-guard.js'

const note = (assessment: string): SoapNote => ({
  subjective: 'S',
  objective: 'O',
  assessment,
  plan: 'P',
})

const gap = (id: string, question: string, rationale: string): InformationGap => ({
  id,
  question,
  rationale,
  priority: 'medium',
})

describe('stripDiagnosticProse (docs/prd.md §10)', () => {
  it('leaves an assessment that summarises findings without naming a diagnosis', () => {
    const input = note('Cough and sore throat for 3 days, throat erythematous on exam.')
    const result = stripDiagnosticProse(input, [])

    expect(result.note.assessment).toBe(input.assessment)
    expect(result.suppressedFieldIds).toEqual([])
  })

  it('blanks an assessment that states a diagnosis, rather than losing the analysis', () => {
    const result = stripDiagnosticProse(
      note('Diagnosis: viral upper respiratory tract infection.'),
      [],
    )

    expect(result.note.assessment).toBe('')
    expect(result.suppressedFieldIds).toEqual(['note.assessment'])
    // The rest of the note must survive — one bad field is not the whole run.
    expect(result.note.subjective).toBe('S')
    expect(result.note.plan).toBe('P')
  })

  it('drops a gap whose rationale implies a differential, keeping the others', () => {
    const result = stripDiagnosticProse(note(''), [
      gap('g1', 'Any exposure history?', 'Differential includes bacterial pharyngitis.'),
      gap('g2', 'No respiratory rate recorded.', 'Needed to characterise severity.'),
    ])

    expect(result.gaps.map((g) => g.id)).toEqual(['g2'])
    expect(result.suppressedFieldIds).toEqual(['gap.g1'])
  })

  it('records field ids only, never the diagnostic content', () => {
    const result = stripDiagnosticProse(note('Impression: likely viral.'), [])

    expect(result.suppressedFieldIds.join(' ')).toContain('note.assessment')
    expect(result.suppressedFieldIds.join(' ')).not.toContain('viral')
  })
})
