import { describe, expect, it } from 'vitest'
import { GAP_CHECKLIST } from '../gaps/index.js'
import { GUIDELINE_CORPUS } from '../guidelines/index.js'
import { ALL_REDFLAG_TRIGGERS, RED_FLAG_LIST_VERSION, REDFLAG_TRIGGERS } from '../redflags/index.js'
import { ACTIVE_CLINICAL_VERSIONS, ACTIVE_PROFILE_VERSIONS } from './index.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

describe('clinical content versions (issue #16)', () => {
  it('covers the three versioned artefacts and the default clinical profile', () => {
    expect(Object.keys(ACTIVE_CLINICAL_VERSIONS).sort()).toEqual([
      'clinicalProfile',
      'gapChecklist',
      'guidelineCorpus',
      'redFlagList',
    ])
  })

  for (const [artefact, version] of Object.entries(ACTIVE_CLINICAL_VERSIONS)) {
    it(`gives ${artefact} a version id and an effective date`, () => {
      expect(version.id).not.toHaveLength(0)
      expect(version.effectiveDate).toMatch(ISO_DATE)
      expect(Number.isNaN(Date.parse(version.effectiveDate))).toBe(false)
    })
  }

  it('gives each artefact a distinct id, so a stamp names one thing', () => {
    const ids = Object.values(ACTIVE_CLINICAL_VERSIONS).map((version) => version.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * `evaluate.test.ts` asserts the triggers agree with each other. This asserts
   * they agree with the version that actually gets stamped, which is the pair
   * that can drift once the two are edited separately.
   */
  it('stamps the same rule-list version that every trigger carries', () => {
    // ALL_REDFLAG_TRIGGERS, so the UTI triggers' stamps are pinned too (#150).
    for (const trigger of ALL_REDFLAG_TRIGGERS) {
      expect(trigger.listVersion).toBe(RED_FLAG_LIST_VERSION.id)
    }

    expect(ACTIVE_CLINICAL_VERSIONS.redFlagList).toBe(RED_FLAG_LIST_VERSION)
  })

  it('versions artefacts that are actually populated', () => {
    expect(REDFLAG_TRIGGERS.length).toBeGreaterThan(0)
    expect(GAP_CHECKLIST.length).toBeGreaterThan(0)
    expect(GUIDELINE_CORPUS.length).toBeGreaterThan(0)
  })

  it('includes a version for every selectable clinical profile', () => {
    expect(Object.keys(ACTIVE_PROFILE_VERSIONS).length).toBeGreaterThan(1)
    for (const version of Object.values(ACTIVE_PROFILE_VERSIONS)) {
      expect(version.id).not.toHaveLength(0)
      expect(version.effectiveDate).toMatch(ISO_DATE)
    }
  })
})
