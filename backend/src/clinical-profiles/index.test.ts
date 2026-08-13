import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { ACTIVE_CLINICAL_VERSIONS, getActiveClinicalVersions } from '../clinical-versions/index.js'
import { GAP_CHECKLIST } from '../gaps/index.js'
import { GUIDELINE_CORPUS } from '../guidelines/index.js'
import { evaluateRedFlags, REDFLAG_TRIGGERS } from '../redflags/index.js'
import { getClinicalProfile } from './index.js'

describe('clinical profiles', () => {
  it('selects only membership-tagged content for adult acute uncomplicated urinary presentations', () => {
    const profile = getClinicalProfile('adult-acute-uncomplicated-uti')

    expect(profile.redFlagTriggers).not.toEqual(REDFLAG_TRIGGERS)
    expect(profile.gapChecklist).not.toEqual(GAP_CHECKLIST)
    expect(profile.guidelineCorpus).not.toEqual(GUIDELINE_CORPUS)
    expect(profile.redFlagTriggers).toHaveLength(7)
    expect(profile.gapChecklist).toHaveLength(5)
    expect(profile.guidelineCorpus).toHaveLength(1)
    expect(profile.redFlagTriggers.every((trigger) => trigger.profiles.includes(profile.id))).toBe(
      true,
    )
    expect(profile.gapChecklist.every((entry) => entry.profiles.includes(profile.id))).toBe(true)
    expect(profile.guidelineCorpus.every((chunk) => chunk.profiles.includes(profile.id))).toBe(true)
  })

  it('fires every deliberately broad UTI rule on its matching transcript evidence', () => {
    const fixtures: Record<string, Transcript> = {
      'vital-signs-concern': {
        source: 'fixture',
        turns: [{ speaker: 'doctor', text: 'The oxygen saturation is very low.' }],
      },
      'uti-systemic-features': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'I have fever and chills.' }],
      },
      'uti-flank-or-back-pain': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'There is pain in my lower back.' }],
      },
      'uti-systemic-deterioration': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'I feel extremely weak.' }],
      },
      'uti-pregnancy-mentioned': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'I might be pregnant.' }],
      },
      'uti-unable-to-pass-urine': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'I cannot pass urine.' }],
      },
      'uti-potentially-complicating-context': {
        source: 'fixture',
        turns: [{ speaker: 'patient', text: 'I have kidney disease.' }],
      },
    }
    const profile = getClinicalProfile('adult-acute-uncomplicated-uti')

    for (const trigger of profile.redFlagTriggers) {
      const flags = evaluateRedFlags(fixtures[trigger.id] as Transcript, profile.redFlagTriggers)
      expect(flags.some((flag) => flag.ruleId === trigger.id)).toBe(true)
    }
  })

  it('keeps the adult acute URTI content exactly as it was before profile selection', () => {
    const profile = getClinicalProfile('adult-acute-urti')

    expect(profile.redFlagTriggers).toEqual(REDFLAG_TRIGGERS)
    expect(profile.gapChecklist).toEqual(GAP_CHECKLIST)
    expect(profile.guidelineCorpus).toEqual(GUIDELINE_CORPUS.slice(0, 11))
  })

  it('includes the selected profile version in each analysis stamp', () => {
    for (const profileId of ['adult-acute-urti', 'adult-acute-uncomplicated-uti'] as const) {
      const profile = getClinicalProfile(profileId)
      const versions = getActiveClinicalVersions(profile)

      expect(versions).toMatchObject({
        ...ACTIVE_CLINICAL_VERSIONS,
        clinicalProfile: profile.version,
      })
      expect(versions.clinicalProfile).toBe(profile.version)
    }

    expect(
      getActiveClinicalVersions(getClinicalProfile('adult-acute-urti')).clinicalProfile.id,
    ).not.toBe(
      getActiveClinicalVersions(getClinicalProfile('adult-acute-uncomplicated-uti')).clinicalProfile
        .id,
    )
  })
})
