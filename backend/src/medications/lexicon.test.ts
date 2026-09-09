import { describe, expect, it } from 'vitest'
import { PROFILE_IDS } from '../clinical-profiles/types.js'
import { lexiconFor, MEDICATION_LEXICON, MEDICATION_LEXICON_VERSION } from './lexicon.js'

/**
 * The lexicon is a spelling aid, not a formulary (issue #311,
 * `docs/decisions.md` D-001). These tests are what stop it drifting into one.
 */

/** Brands a Malaysian GP says out loud. D-001 puts every one of them outside. */
const BRANDS = [
  'panadol',
  'augmentin',
  'ventolin',
  'zithromax',
  'uphamol',
  'clarinase',
  'zyrtec',
  'difflam',
  'strepsils',
  'brufen',
]

describe('the medication lexicon carries names and nothing else', () => {
  it('gives every entry exactly the four permitted keys', () => {
    // A fifth key is how a spelling aid becomes a formulary. Dose, indication,
    // interaction and recommendation data are all outside the boundary, and
    // each of them would arrive as a new key here first.
    for (const entry of MEDICATION_LEXICON) {
      expect(Object.keys(entry).sort(), entry.id).toEqual(['generic', 'id', 'profiles', 'synonyms'])
    }
  })

  it('names no brand', () => {
    // The rule most likely to erode, because brands are the words doctors
    // actually say. Excluding them costs real recall, and the doctor types
    // the name instead.
    const named = MEDICATION_LEXICON.flatMap(({ id, generic, synonyms }) => [
      id,
      generic,
      ...synonyms,
    ]).map((name) => name.toLowerCase())

    for (const brand of BRANDS) {
      expect(named, `${brand} is a brand name`).not.toContain(brand)
    }
  })

  it('holds no digits anywhere, so no dose can hide in a name', () => {
    for (const { id, generic, synonyms } of MEDICATION_LEXICON) {
      for (const name of [id, generic, ...synonyms]) {
        expect(name, id).not.toMatch(/\d/)
      }
    }
  })
})

describe('the medication lexicon is well formed', () => {
  it('has no duplicate id', () => {
    const ids = MEDICATION_LEXICON.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate name across entries', () => {
    // Two entries answering to one spelling would make the candidate the
    // doctor accepts depend on iteration order.
    const names = MEDICATION_LEXICON.flatMap(({ generic, synonyms }) => [generic, ...synonyms])

    expect(new Set(names).size).toBe(names.length)
  })

  it('scopes every entry to at least one real profile', () => {
    for (const { id, profiles } of MEDICATION_LEXICON) {
      expect(profiles.length, id).toBeGreaterThan(0)
      for (const profile of profiles) {
        expect(PROFILE_IDS, id).toContain(profile)
      }
    }
  })

  it('reaches both profiles, and lexiconFor narrows to each', () => {
    for (const profile of PROFILE_IDS) {
      const scoped = lexiconFor(profile)

      expect(scoped.length, profile).toBeGreaterThan(0)
      expect(scoped.length).toBeLessThan(MEDICATION_LEXICON.length)
      for (const entry of scoped) {
        expect(entry.profiles).toContain(profile)
      }
    }
  })

  it('carries a version defined in this file, dated', () => {
    expect(MEDICATION_LEXICON_VERSION.id).toBe('medication-lexicon-v1')
    expect(MEDICATION_LEXICON_VERSION.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
