import { describe, expect, it } from 'vitest'
import { GUIDELINE_CORPUS } from '../guidelines/corpus.js'
import { ALL_GAP_CHECKLIST, GapChecklistSourceSchema } from './checklist.js'

describe('gap checklist provenance', () => {
  it('rejects a citation id outside the guideline corpus', () => {
    expect(
      GapChecklistSourceSchema.safeParse({
        kind: 'guideline',
        guidelineIds: ['invented-guideline-id'],
      }).success,
    ).toBe(false)
  })

  it('makes every entry explicitly cited or explicitly unsourced', () => {
    for (const entry of ALL_GAP_CHECKLIST) {
      const parsed = GapChecklistSourceSchema.safeParse(entry.source)

      expect(parsed.success, `${entry.id} has invalid or missing provenance`).toBe(true)
      if (!parsed.success || parsed.data.kind === 'unsourced') continue

      for (const guidelineId of parsed.data.guidelineIds) {
        const guideline = GUIDELINE_CORPUS.find((chunk) => chunk.id === guidelineId)
        expect(guideline, `${entry.id} cites missing guideline ${guidelineId}`).toBeDefined()
        expect(
          entry.profiles.every((profileId) => guideline?.profiles.includes(profileId)),
          `${entry.id} cites a guideline that does not cover every entry profile`,
        ).toBe(true)
      }
    }
  })

  const ALLOWED_UNSOURCED_URTI_IDS: readonly string[] = [
    'haemoptysis',
    'smoking',
    'current-medications',
    'drug-allergies',
    'diagnosis',
    'mc-days',
    'referral',
    'follow-up',
  ]

  it('grounds every non-administrative adult-acute-urti prompt in a guideline', () => {
    for (const entry of ALL_GAP_CHECKLIST) {
      if (!entry.profiles.includes('adult-acute-urti')) continue
      if (ALLOWED_UNSOURCED_URTI_IDS.includes(entry.id)) continue

      expect(entry.source.kind, `${entry.id} must be sourced from a guideline`).toBe('guideline')
    }
  })
})
