import { FixtureSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURE_RUBRICS, FIXTURES } from './index.js'

const fullText = (fixtureId: string) =>
  FIXTURES.find((f) => f.id === fixtureId)
    ?.transcript.turns.map((t) => t.text)
    .join(' ') ?? ''

describe('FIXTURES', () => {
  it('every fixture parses against FixtureSchema', () => {
    for (const fixture of FIXTURES) {
      expect(FixtureSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('every transcript is provenanced as source: fixture', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.transcript.source).toBe('fixture')
    }
  })

  it('every fixture has at least one doctor turn and one patient turn', () => {
    for (const fixture of FIXTURES) {
      const speakers = fixture.transcript.turns.map((t) => t.speaker)
      expect(speakers).toContain('doctor')
      expect(speakers).toContain('patient')
    }
  })

  it('every fixture has a unique id', () => {
    const ids = FIXTURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('urti-gap-heavy', () => {
  const text = fullText('urti-gap-heavy')

  it('never mentions haemoptysis, in any spelling or paraphrase', () => {
    expect(text).not.toMatch(/haemoptysis|hemoptysis|coughing.*blood|blood.*cough/i)
  })

  it('leaves at least three genuinely distinct topics unraised', () => {
    const unraisedTopics: Record<string, RegExp> = {
      haemoptysis: /haemoptysis|hemoptysis|blood/i,
      chestPain: /chest pain/i,
      dyspnoea: /breath(less|ing difficulty)|dyspnoea|dyspnea/i,
      oxygenSaturation: /oxygen saturation|spo2|sats?\b/i,
      respiratoryRate: /respiratory rate/i,
    }
    const unraisedCount = Object.values(unraisedTopics).filter(
      (pattern) => !pattern.test(text),
    ).length
    expect(unraisedCount).toBeGreaterThanOrEqual(3)
  })
})

describe('urti-diagnosis-not-assessed', () => {
  it('never names a condition', () => {
    const text = fullText('urti-diagnosis-not-assessed')
    expect(text).not.toMatch(
      /infection|pharyngitis|tonsillitis|bronchitis|\bURTI\b|upper respiratory tract/i,
    )
  })
})

describe('FIXTURE_RUBRICS', () => {
  it('carries exactly one rubric per fixture, in lockstep by id', () => {
    const fixtureIds = new Set(FIXTURES.map((f) => f.id))
    const rubricIds = FIXTURE_RUBRICS.map((r) => r.fixtureId)
    expect(new Set(rubricIds)).toEqual(fixtureIds)
    expect(rubricIds.length).toBe(fixtureIds.size)
  })
})
