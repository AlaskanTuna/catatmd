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
          guideline?.profiles.some((profileId) => entry.profiles.includes(profileId)),
          `${entry.id} cites a guideline from another clinical profile`,
        ).toBe(true)
      }
    }
  })
})
