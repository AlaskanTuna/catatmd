import { describe, expect, it } from 'vitest'
import { buildLexicalQuery } from './query.js'

describe('buildLexicalQuery', () => {
  it('drops English and Malay stop words', () => {
    const q = buildLexicalQuery(
      'The patient has a fever and cough but I am not sure untuk doktor pesakit',
      3,
    )
    expect(q).not.toContain('the')
    expect(q).not.toContain('and')
    expect(q).not.toContain('untuk')
    expect(q).not.toContain('doktor')
    expect(q).toContain('fever')
    expect(q).toContain('cough')
  })

  it('drops de-identification tokens, bracketed or not', () => {
    const q = buildLexicalQuery('Doctor: [PATIENT_1] [NRIC_1] has fever. patient_2 also cough.', 5)
    expect(q).not.toContain('patient')
    expect(q).not.toContain('nric')
    expect(q).not.toMatch(/\d/)
    expect(q).toContain('fever')
    expect(q).toContain('cough')
  })

  it('strips punctuation and digits from terms', () => {
    const q = buildLexicalQuery('Fever, cough; sore-throat123!?', 5)
    const terms = q.split(' | ')
    for (const term of terms) {
      expect(term).toMatch(/^[a-z]+$/)
    }
    expect(terms).toContain('fever')
    expect(terms).toContain('cough')
    expect(terms).toContain('sore')
    expect(terms).toContain('throat')
  })

  it('orders terms by descending frequency', () => {
    const q = buildLexicalQuery('cough cough cough fever fever headache', 3)
    const terms = q.split(' | ')
    expect(terms[0]).toBe('cough')
    expect(terms[1]).toBe('fever')
  })

  it('returns an empty string when nothing survives', () => {
    expect(buildLexicalQuery('a an the dan yang', 10)).toBe('')
  })

  it('respects the limit', () => {
    const q = buildLexicalQuery('fever cough headache sore throat fatigue myalgia congestion', 4)
    expect(q.split(' | ')).toHaveLength(4)
  })

  it('lower-cases input before selecting terms', () => {
    const q = buildLexicalQuery('FEVER COUGH', 5)
    expect(q).toBe('cough | fever')
  })
})
