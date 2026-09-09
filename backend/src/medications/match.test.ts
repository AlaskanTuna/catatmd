import { describe, expect, it } from 'vitest'
import { MEDICATION_LEXICON } from './lexicon.js'
import { type MedicationCandidate, matchMedication, normalise } from './match.js'

/**
 * The safety argument for this module lives in these tests (issue #311).
 *
 * `docs/decisions.md` D-001 puts automatic substitution of a drug name
 * outside the boundary: "a candidate is offered; the doctor accepts it".
 * Look-alike sound-alike confusion is a leading medication-error class, and
 * ISMP names selection from a list as the control for exactly this. So the
 * matcher must propose, must quote what was actually said, and must never
 * produce a corrected string anywhere.
 */

const ids = (candidates: readonly MedicationCandidate[]) =>
  candidates.map(({ lexiconId }) => lexiconId)

describe('matchMedication never mutates the text it was given', () => {
  it('offers amoxicillin for a dictated amoxapine, and quotes amoxapine', () => {
    // The look-alike sound-alike pair D-001 names. Either the doctor said
    // amoxapine and was heard correctly, or said amoxicillin and was heard
    // wrongly, and nothing in this process can tell. Offering the candidate
    // is what puts that question in front of the only person who can answer
    // it. Silently applying it is the harm.
    const text = 'start amoxapine 250 mg twice daily'
    const candidates = matchMedication(text)
    const amoxicillin = candidates.find(({ lexiconId }) => lexiconId === 'amoxicillin')

    expect(amoxicillin).toBeDefined()
    expect(amoxicillin?.generic).toBe('amoxicillin')

    // The proposal is a separate field from what was heard, and what was
    // heard is cut from the untouched input.
    expect(amoxicillin?.heard).toBe('amoxapine')
    expect(text.slice(amoxicillin?.start, amoxicillin?.end)).toBe('amoxapine')
  })

  it('exposes no field that could carry a corrected string', () => {
    // This is the structural half of the rule. Adding a `corrected` or
    // `replacement` field would fail here before any reviewer had to notice
    // it in a diff.
    const [candidate] = matchMedication('amoxapine')

    expect(candidate).toBeDefined()
    expect(Object.keys(candidate as MedicationCandidate).sort()).toEqual([
      'end',
      'generic',
      'heard',
      'lexiconId',
      'score',
      'start',
    ])
  })

  it('leaves the input string identical', () => {
    const text = 'amoxapine 250 mg'
    matchMedication(text)

    expect(text).toBe('amoxapine 250 mg')
  })
})

describe('matchMedication proposes only against what was said', () => {
  it('offers nothing when no word resembles a drug name', () => {
    // D-001: "the system never proposes a drug the doctor did not say".
    // Every candidate is anchored to a span, so there is no path by which one
    // can be volunteered.
    expect(matchMedication('patient reviewed, follow up in one week if no better')).toEqual([])
  })

  it('offers nothing for the sig vocabulary itself', () => {
    // Without the stop-list, "makan tiga kali sehari" scores its own words
    // against the lexicon and fills the doctor's screen with noise.
    expect(matchMedication('makan tiga kali sehari, lepas makan, selama lima hari')).toEqual([])
  })

  it('reads one candidate from the English fixture, not a page of them', () => {
    const candidates = matchMedication('amoxicillin 500mg TDS after food for five days')

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.lexiconId).toBe('amoxicillin')
    expect(candidates[0]?.heard).toBe('amoxicillin')
  })
})

describe('matchMedication quotes the original across a length change', () => {
  it('cuts the span from the source, punctuation and capitals included', () => {
    // Normalisation lowercases and drops the hyphen, so the matched string is
    // shorter than the original. The index map is what lets the doctor still
    // be shown the characters that were actually recorded, which is the same
    // property `redflags/mishears.ts` exists to preserve.
    const text = 'Rx: Amoxy-cillin, 500 mg'
    const [candidate] = matchMedication(text)

    expect(candidate?.lexiconId).toBe('amoxicillin')
    expect(candidate?.heard).toBe('Amoxy-cillin')
    expect(text.slice(candidate?.start, candidate?.end)).toBe('Amoxy-cillin')
  })

  it('maps every normalised character back to a real source index', () => {
    const text = 'Rx: Amoxy-cillin, 500 mg'
    const { text: normalised, origin } = normalise(text)

    expect(origin).toHaveLength(normalised.length)
    expect(normalised).toBe('rx amoxy cillin 500 mg')
    for (const [index, character] of [...normalised].entries()) {
      const source = origin[index] as number
      expect(source).toBeGreaterThanOrEqual(0)
      expect(source).toBeLessThan(text.length)
      if (character !== ' ') expect(text[source]?.toLowerCase()).toBe(character)
    }
  })
})

describe('matchMedication scoping', () => {
  it('searches the whole lexicon when no profile is named', () => {
    // Defaulting to a profile would hide every urinary drug from a urinary
    // dictation, silently, on the one-argument form the issue specifies.
    const candidates = matchMedication('nitrofurantoin 100 mg')

    expect(candidates.map(({ lexiconId }) => lexiconId)).toContain('nitrofurantoin')
  })

  it('narrows to a profile when one is named', () => {
    expect(matchMedication('nitrofurantoin 100 mg', 'adult-acute-urti')).toEqual([])
    expect(
      matchMedication('nitrofurantoin 100 mg', 'adult-acute-uncomplicated-uti').map(
        ({ lexiconId }) => lexiconId,
      ),
    ).toContain('nitrofurantoin')
  })

  it('ranks deterministically rather than by lexicon order', () => {
    const first = matchMedication('amoxapine')
    const second = matchMedication('amoxapine')

    expect(ids(first)).toEqual(ids(second))
    expect(first.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < first.length; i++) {
      expect(first[i - 1]?.score).toBeGreaterThanOrEqual(first[i]?.score as number)
    }
  })

  it('recovers a name the recogniser split across words', () => {
    // Word boundaries are exactly what a recogniser invents. Sound is
    // compared with the spaces removed, which is what reaches this case.
    const candidates = matchMedication('give a zithro my sin 500 mg')

    expect(candidates.map(({ lexiconId }) => lexiconId)).toContain('azithromycin')
    expect(candidates.find(({ lexiconId }) => lexiconId === 'azithromycin')?.heard).toBe(
      'zithro my sin',
    )
  })
})

describe('every lexicon entry, not just the four named above', () => {
  // Hand-picked cases cover four drugs. These round-trip all of them, so the
  // twenty-seventh entry is checked on the day it is added rather than the
  // day someone notices. This is the shape of the risk the README names:
  // profile scoping cannot prevent a wrong-drug proposal, it only narrows
  // the field a proposal is drawn from.
  it.each(MEDICATION_LEXICON)('ranks $id first when its own name is dictated', (entry) => {
    for (const name of [entry.generic, ...entry.synonyms]) {
      const [top] = matchMedication(name)

      expect(top?.lexiconId, `${name} proposed ${top?.lexiconId ?? 'nothing'}`).toBe(entry.id)
    }
  })

  it.each(MEDICATION_LEXICON)(
    'proposes no other drug ahead of $id inside either profile',
    (entry) => {
      // Searching a drug name while scoped to a profile that does not hold it
      // is the case where a look-alike has no correct entry to beat. The
      // proposal is still allowed, because the doctor may have been misheard,
      // but it must never outrank the drug that was actually said.
      for (const profile of entry.profiles) {
        const [top] = matchMedication(entry.generic, profile)

        expect(top?.lexiconId, `${entry.generic} in ${profile}`).toBe(entry.id)
      }
    },
  )
})
