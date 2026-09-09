import { RedFlagCandidatesSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { CITABLE_DOCUMENT_IDS, parseDocumentRef } from '../guidelines/documents.js'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

const citableDocumentIds = new Set<string>(CITABLE_DOCUMENT_IDS)

/*
 * A trigger's `guidelineIds` is the only thing turning its prose
 * `clinicalSource` into guidance a doctor can open. A reference that does not
 * resolve renders as nothing on screen, so the citation silently disappears
 * rather than failing loudly. These tests are that failure.
 */
describe('trigger citations resolve against citable documents', () => {
  it.each(ALL_REDFLAG_TRIGGERS.map((trigger) => [trigger.id, trigger] as const))(
    '%s cites only citable documents',
    (_id, trigger) => {
      for (const guidelineId of trigger.guidelineIds) {
        const parsed = parseDocumentRef(guidelineId)
        expect(parsed, `${trigger.id} cites unparseable reference ${guidelineId}`).not.toBeNull()
        if (parsed === null) continue
        expect(
          citableDocumentIds.has(parsed.documentId),
          `${trigger.id} cites uncitable document ${parsed.documentId}`,
        ).toBe(true)
      }
    },
  )

  it('cites no document twice within one trigger', () => {
    for (const trigger of ALL_REDFLAG_TRIGGERS) {
      expect(new Set(trigger.guidelineIds).size).toBe(trigger.guidelineIds.length)
    }
  })

  /*
   * Pinned deliberately. The corpus carries no Malaysian numeric vital-sign
   * threshold, so this trigger fires on the clinician's own stated severity
   * instead of an invented cutoff. If someone later attaches a citation here,
   * that is a clinical claim needing review, not a tidy-up.
   */
  it('leaves vital-signs-concern uncited, because the corpus backs no threshold', () => {
    const trigger = ALL_REDFLAG_TRIGGERS.find((entry) => entry.id === 'vital-signs-concern')
    expect(trigger).toBeDefined()
    expect(trigger?.guidelineIds).toEqual([])
  })

  it('carries the trigger citations onto a fired flag', () => {
    const [trigger] = ALL_REDFLAG_TRIGGERS.filter((entry) => entry.guidelineIds.length > 0)
    expect(trigger).toBeDefined()
    const flags = evaluateRedFlags(
      { source: 'paste', turns: [{ speaker: 'patient', text: 'batuk berdarah' }] },
      ALL_REDFLAG_TRIGGERS,
    )
    for (const flag of flags) {
      const fired = ALL_REDFLAG_TRIGGERS.find((entry) => entry.id === flag.ruleId)
      expect(flag.guidelineIds).toEqual([...(fired?.guidelineIds ?? [])])
    }
  })
})

/*
 * A red flag is not a place a model may attach a citation. The suggestions half
 * is ID-constrained precisely so a fabricated reference fails validation; red
 * flags answer against a schema that has no citation field at all, which is the
 * stronger guarantee.
 *
 * Since #340 the two are separate calls, and the red-flag half never receives a
 * corpus in the first place. There is no longer an id it could cite even if the
 * schema let it.
 */
describe('the model cannot cite on a red flag', () => {
  it('strips guidelineIds a model puts on a red flag', () => {
    const parsed = RedFlagCandidatesSchema.parse({
      outOfScope: false,
      redFlags: [
        {
          id: 'model-1',
          label: 'Something the model noticed',
          severity: 'advisory',
          evidence: 'batuk berdarah',
          source: 'model',
          guidelineIds: ['moh-nag-2024-c3-acute-bronchitis'],
        },
      ],
    })

    expect(parsed.redFlags[0]).not.toHaveProperty('guidelineIds')
  })
})
