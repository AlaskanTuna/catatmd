import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURES, LANGUAGE_SAMPLES } from '../fixtures/index.js'
import { MEDICATION_LEXICON } from '../medications/lexicon.js'
import { detect } from './detectors.js'
import { GIVEN_NAMES, HONORIFICS, NAME_STOPWORDS } from './gazetteer.js'
import {
  assertNoIdentifiers,
  deidentify,
  deidentifyTranscript,
  sliceDeidentified,
} from './index.js'
import { isStructurallyValidNric } from './nric.js'
import { RequestTokenVault } from './vault.js'

const labelsIn = (text: string) => [...new Set(detect(text).map((m) => m.label))].sort()

describe('detector inventory (docs/trd.md §9)', () => {
  it('detects a Malaysian NRIC', () => {
    expect(labelsIn('My IC number is 850523-14-5677.')).toContain('NRIC')
  })

  it('detects an unhyphenated MyKad number beside a Malay identity cue', () => {
    expect(labelsIn('Nombor kad pengenalan saya 900412086543.')).toContain('NRIC')
  })

  it('detects a structurally valid unhyphenated MyKad with no cue at all', () => {
    // Recall-first: transcription drops hyphens and puts the digits far from
    // the "IC" that introduced them, so validity alone must gate.
    expect(labelsIn('The number 900412086543 was on the form.')).toContain('NRIC')
  })

  it('still detects an invalid unhyphenated number when the context says it is an IC', () => {
    expect(labelsIn('His IC is 850523175677 lah.')).toContain('NRIC')
    expect(labelsIn('No. K/P 850523175677 tertera di kad.')).toContain('NRIC')
  })

  it('detects a date of birth behind a Malay birth cue', () => {
    expect(labelsIn('Tarikh lahir 23 Mac 1985, betul?')).toContain('DOB')
    expect(labelsIn('Dia dilahirkan pada 3 Ogos 1990.')).toContain('DOB')
  })

  it('detects a clinic record number behind a Malay record cue', () => {
    expect(labelsIn('Nombor pendaftaran KLC-004821 untuk fail.')).toContain('MRN')
    expect(labelsIn('No. fail KLC-004821 ya.')).toContain('MRN')
  })

  it('still mints a name introduced by saya after the Malay stopword additions', () => {
    expect(labelsIn('Nama saya Aisyah binti Osman.')).toContain('PATIENT')
    expect(labelsIn('Nanti cari saya Khairul di kaunter.')).toContain('PATIENT')
  })

  it('still detects weekday-named patients, whole span included', () => {
    // Khamis and Jumaat are attested Malay given names outside the gazetteer,
    // which is why they are not weekday stopwords: trimNameSpan would strip
    // them off the front of a patronymic span and leak them in cleartext.
    expect(labelsIn('Nama saya Khamis.')).toContain('PATIENT')
    const values = detect('Khamis bin Sulaiman datang tadi.')
      .filter((m) => m.label === 'PATIENT')
      .map((m) => m.value)
    expect(values).toContain('Khamis bin Sulaiman')
  })

  it('detects a Malaysian mobile number', () => {
    expect(labelsIn('You can call me at 012-3456789.')).toContain('PHONE')
  })

  it('detects an email address', () => {
    expect(labelsIn('Send the invoice to ahmad.ismail85@example.com')).toContain('EMAIL')
  })

  it('detects an address with a street keyword and postcode', () => {
    expect(
      labelsIn('I stay at No. 12, Jalan Meranti 5, Taman Desa Aman, 43000 Kajang, Selangor.'),
    ).toContain('ADDRESS')
  })

  it('detects a date of birth behind a birth cue', () => {
    expect(labelsIn('Date of birth 23 May 1985, correct?')).toContain('DOB')
  })

  it('detects a clinic record number behind a record cue', () => {
    expect(labelsIn('Registration no. KLC-004821 for the file.')).toContain('MRN')
  })

  it('detects a name introduced by an honorific', () => {
    expect(labelsIn('Morning Encik Ahmad, please have a seat.')).toContain('PATIENT')
  })

  it('detects a name joined by a Malaysian patronymic', () => {
    expect(labelsIn('The patient is Ahmad bin Ismail.')).toContain('PATIENT')
    expect(labelsIn('Refer Siti binti Rahman to ENT.')).toContain('PATIENT')
    expect(labelsIn('Patient Ramasamy a/l Muniandy came in.')).toContain('PATIENT')
  })

  it('detects a name after an introducer phrase', () => {
    expect(labelsIn('My name is Kavitha Balakrishnan.')).toContain('PATIENT')
  })
})

describe('precision — clinical content must survive', () => {
  it('does not tokenise a symptom-onset date', () => {
    const { text } = deidentify('Cough since 2 days ago, fever 38.9 degrees last night.')
    expect(text).toContain('2 days ago')
    expect(text).toContain('38.9')
  })

  it('does not tokenise a follow-up date that carries no birth cue', () => {
    const { text } = deidentify('Come back on 20/08/2026 if not better.')
    expect(text).toContain('20/08/2026')
  })

  it('does not tokenise clinical or common vocabulary shaped like a name', () => {
    const { text } = deidentify('Take Paracetamol QID. Come back Monday if the fever persists.')
    expect(text).toContain('Paracetamol')
    expect(text).toContain('Monday')
  })

  it('never takes a drug the medication lexicon holds for part of a name (#317)', () => {
    for (const { generic, synonyms } of MEDICATION_LEXICON) {
      for (const term of [generic, ...synonyms]) {
        // Each word as the detector reads one, and each part of a hyphenated one.
        for (const word of term.split(/\s+/).flatMap((word) => [word, ...word.split('-')])) {
          expect(NAME_STOPWORDS.has(word.toLowerCase().replace(/[^a-z]/g, '')), word).toBe(true)
        }
      }
    }
    // Before #317 only three drugs were listed, and the rest went into the token.
    expect(deidentify('Nitrofurantoin Siti binti Ahmad').text).toBe('Nitrofurantoin [PATIENT_1]')
  })

  it('derives no drug stopword that is also a name or an honorific (#317)', () => {
    // A lexicon change now edits the deny-list, so a synonym shaped like a name
    // would quietly stop that name being tokenised.
    const drugWords = MEDICATION_LEXICON.flatMap(({ generic, synonyms }) => [generic, ...synonyms])
      .flatMap((term) => term.split(/\s+/))
      .flatMap((word) => [word, ...word.split('-')])
      .map((word) => word.toLowerCase().replace(/[^a-z]/g, ''))
    const nameLike = new Set([...GIVEN_NAMES, ...HONORIFICS.map((title) => title.toLowerCase())])
    expect(drugWords.filter((word) => nameLike.has(word))).toEqual([])
  })

  it('does not tokenise an arbitrary twelve-digit reference number', () => {
    // Pins the 0.3 base for a structurally invalid bare run: no birth date, no
    // context, no token.
    //
    // The sentence used to have to avoid "invoice" and "clinic", because the
    // 'ic' cue matched as a substring inside them. Since #159 it does not, and
    // the pair of assertions below is the same sentence with each ending.
    const { text } = deidentify('Reference 123456789012 is printed on the receipt.')
    expect(text).toContain('123456789012')

    const near = deidentify('Reference 123456789012 is printed on the invoice.')
    expect(near.text).toContain('123456789012')
  })

  it('does not tokenise a Malay-month follow-up date that carries no birth cue', () => {
    const { text } = deidentify('Jumpa lagi 20 Ogos 2026 untuk susulan.')
    expect(text).toContain('20 Ogos 2026')
  })

  it('does not read an English word starting with a Malay month prefix as a date', () => {
    const { text } = deidentify('Date of birth noted; discharge 12 2024 planned.')
    expect(text).toContain('discharge 12 2024')
  })

  it('does not mint a name from saya followed by a Malay everyday word', () => {
    const { text } = deidentify('Boleh tulis surat untuk saya Doktor?')
    expect(text).toContain('Doktor')
  })

  it('keeps a Malay weekday in clinical content', () => {
    const { text } = deidentify('Datang balik jumpa saya Isnin depan.')
    expect(text).toContain('Isnin')
  })
})

describe('NRIC structural validation', () => {
  it('accepts a well-formed NRIC with a valid birth date and state code', () => {
    expect(isStructurallyValidNric('850523-14-5677')).toBe(true)
  })

  it('rejects an impossible birth date', () => {
    expect(isStructurallyValidNric('851345-14-5677')).toBe(false)
  })

  it('rejects an unassigned place-of-birth code', () => {
    expect(isStructurallyValidNric('850523-17-5677')).toBe(false)
  })

  it('accepts the unhyphenated form of a valid number', () => {
    expect(isStructurallyValidNric('900412086543')).toBe(true)
  })

  it('rejects an unhyphenated number with an impossible birth month', () => {
    expect(isStructurallyValidNric('901345086543')).toBe(false)
  })

  it('rejects a half-hyphenated hybrid neither detector can produce', () => {
    expect(isStructurallyValidNric('850523-145677')).toBe(false)
    expect(isStructurallyValidNric('85052314-5677')).toBe(false)
  })

  it('still detects a structurally invalid NRIC when the context says it is one', () => {
    // Precision must not cost recall: a mistyped IC is still an identifier.
    expect(labelsIn('His IC is 850523-17-5677 lah.')).toContain('NRIC')
  })
})

describe('tokenisation and the request-scoped vault', () => {
  it('mints stable tokens — the same value maps to the same token every time', () => {
    const { text } = deidentify(
      'Encik Ahmad bin Ismail came in. Ahmad bin Ismail has a cough. Tell Ahmad bin Ismail to rest.',
    )
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(tokens.length).toBeGreaterThanOrEqual(3)
    expect(new Set(tokens).size).toBe(1)
  })

  it('gives distinct people distinct tokens', () => {
    const vault = new RequestTokenVault()
    expect(vault.tokenFor('PATIENT', 'Ahmad bin Ismail')).toBe('[PATIENT_1]')
    expect(vault.tokenFor('PATIENT', 'Siti binti Rahman')).toBe('[PATIENT_2]')
    expect(vault.tokenFor('PATIENT', 'Ahmad bin Ismail')).toBe('[PATIENT_1]')
  })

  it('counts each label independently', () => {
    const vault = new RequestTokenVault()
    expect(vault.tokenFor('PATIENT', 'Ahmad')).toBe('[PATIENT_1]')
    expect(vault.tokenFor('NRIC', '850523-14-5677')).toBe('[NRIC_1]')
  })

  it('round-trips: rehydrate restores the original spans', () => {
    const original = 'Encik Ahmad bin Ismail, IC 850523-14-5677, phone 012-3456789.'
    const { text, vault } = deidentify(original)
    expect(text).not.toContain('850523-14-5677')
    expect(vault.rehydrate(text)).toBe(original)
  })

  it('round-trips an unhyphenated MyKad', () => {
    const original = 'IC saya 900412086543, doktor.'
    const { text, vault } = deidentify(original)
    expect(text).not.toContain('900412086543')
    expect(vault.rehydrate(text)).toBe(original)
  })

  it('rehydrates a token the model echoed back inside its own prose', () => {
    const { text, vault } = deidentify('Patient Ahmad bin Ismail has a cough.')
    const token = /\[PATIENT_\d+\]/.exec(text)?.[0] ?? ''
    expect(vault.rehydrate(`Advise ${token} to return in 3 days.`)).toBe(
      'Advise Ahmad bin Ismail to return in 3 days.',
    )
  })

  it('is request-scoped — two vaults never share state', () => {
    const a = deidentify('Encik Ahmad bin Ismail came in.')
    const b = deidentify('Encik Siti binti Rahman came in.')
    expect(a.vault.entries.size).toBe(1)
    expect(b.vault.entries.size).toBe(1)
    expect([...b.vault.entries.values()]).not.toContain('Ahmad bin Ismail')
  })

  it('reports detector labels only, never values', () => {
    const { detected } = deidentify('Encik Ahmad bin Ismail, IC 850523-14-5677.')
    expect(detected).toContain('NRIC')
    expect(detected.join(' ')).not.toContain('850523')
    expect(detected.join(' ')).not.toContain('Ahmad')
  })
})

describe('transcript-level de-identification', () => {
  const transcript: Transcript = {
    source: 'fixture',
    turns: [
      { speaker: 'doctor', text: 'Morning Encik Ahmad bin Ismail.' },
      { speaker: 'patient', text: 'My IC is 850523-14-5677 doctor.' },
      { speaker: 'doctor', text: 'Thanks Encik Ahmad bin Ismail, and your cough?' },
    ],
  }

  it('keeps one token per person across every turn', () => {
    const { text } = deidentifyTranscript(transcript)
    expect(new Set([...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])).size).toBe(1)
  })

  it('serialises as speaker-labelled turns', () => {
    const { text } = deidentifyTranscript(transcript)
    expect(text).toContain('Doctor:')
    expect(text).toContain('Patient:')
  })
})

describe('de-identification reaches a fixed point', () => {
  const longSyntheticEmail = 'synthetic.identifier.with.padding.for.context@example.test'

  it.each([
    {
      input: `Address ${longSyntheticEmail} Jalan Ampang 5`,
      leaked: 'Jalan Ampang 5',
      label: 'ADDRESS' as const,
    },
    {
      input: `IC ${longSyntheticEmail} 990231145677`,
      leaked: '990231145677',
      label: 'NRIC' as const,
    },
    {
      input: `Address ${longSyntheticEmail} ${'x'.repeat(33)} Jalan Ampang 5`,
      leaked: 'Jalan Ampang 5',
      label: 'ADDRESS' as const,
    },
  ])(
    're-gates an identifier promoted after an earlier replacement ($label)',
    ({ input, leaked, label }) => {
      const result = deidentify(input)

      expect(result.text).not.toContain(leaked)
      expect(result.detected).toEqual(expect.arrayContaining(['EMAIL', label]))
      expect(() => assertNoIdentifiers(result.text, 'copilot_turn')).not.toThrow()
      expect(result.vault.rehydrate(result.text)).toBe(input)
    },
  )

  it('does not promote an arbitrary reference number after masking nearby text', () => {
    const result = deidentify(`Invoice ${longSyntheticEmail} reference 990231145677`)

    expect(result.text).toContain('990231145677')
    expect(result.detected).toEqual(['EMAIL'])
    expect(() => assertNoIdentifiers(result.text, 'copilot_turn')).not.toThrow()
  })
})

describe('the egress guard — fail closed (docs/trd.md §19 row 2)', () => {
  it('blocks a payload that never passed through the gate', () => {
    // Simulates the §5 provenance gap: a value branded outside deid/.
    const smuggled = 'Patient Ahmad bin Ismail, IC 850523-14-5677' as never
    expect(() => assertNoIdentifiers(smuggled, 'note_and_gaps')).toThrow(/Egress blocked/)
  })

  it('passes a payload that did', () => {
    const { text } = deidentify('Patient Ahmad bin Ismail, IC 850523-14-5677, cough 3 days.')
    expect(() => assertNoIdentifiers(text, 'note_and_gaps')).not.toThrow()
  })

  it('never puts an identifier value in the exception message', () => {
    const smuggled = 'Patient Ahmad bin Ismail, IC 850523-14-5677' as never
    try {
      assertNoIdentifiers(smuggled, 'note_and_gaps')
      expect.unreachable('guard should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain('850523')
      expect(message).not.toContain('Ahmad')
      expect(message).toMatch(/NRIC|PATIENT/)
      expect(error).toMatchObject({
        failureStage: 'egress_block',
        payloadOrigin: 'egress_content',
      })
    }
  })

  it('does not mistake an already-minted token for an identifier', () => {
    expect(() => assertNoIdentifiers('[PATIENT_1] has a cough.' as never, 'op')).not.toThrow()
  })
})

describe('fixture integration — PRD §16 target: zero identifiers pass through', () => {
  const fixture = FIXTURES.find((f) => f.id === 'urti-identifier-dense-routine')

  it('has the identifier-dense fixture available', () => {
    expect(fixture).toBeDefined()
  })

  it('tokenises every seeded identifier in the fixture', () => {
    if (!fixture) throw new Error('fixture missing')
    const { text, detected } = deidentifyTranscript(fixture.transcript)

    for (const value of [
      'Ahmad bin Ismail',
      '850523-14-5677',
      '012-3456789',
      'ahmad.ismail85@example.com',
      'Jalan Meranti',
      'KLC-004821',
    ]) {
      expect(text, `"${value}" survived de-identification`).not.toContain(value)
    }

    // All seven classes, so a fixture reword that silently breaks one
    // detector's match cannot pass vacuously again (issue #148).
    expect(detected).toEqual(
      expect.arrayContaining(['ADDRESS', 'DOB', 'EMAIL', 'MRN', 'NRIC', 'PATIENT', 'PHONE']),
    )
  })

  it('leaves the fixture safe to send — the egress guard finds nothing', () => {
    if (!fixture) throw new Error('fixture missing')
    const { text } = deidentifyTranscript(fixture.transcript)
    expect(() => assertNoIdentifiers(text, 'note_and_gaps')).not.toThrow()
  })

  it('preserves the clinical content the note depends on', () => {
    if (!fixture) throw new Error('fixture missing')
    const { text } = deidentifyTranscript(fixture.transcript)
    expect(text).toContain('sore throat')
    expect(text).toContain('38.9')
  })
})

/**
 * The four detector defects closed together in one pass (#149, #159, #167, #174).
 *
 * One pass rather than four, because they live in one file and two of them are
 * in the same function's span logic. Fixing them separately would have meant
 * four rounds of regression risk in the module the whole PHI boundary rests on,
 * each blind to the others' edits to shared cue and span code.
 */
describe('name spans must not drop what the gazetteer does not recognise (#149)', () => {
  it('tokenises a patronymic name whole when the given name is outside the gazetteer', () => {
    // The leak. `trimNameSpan` anchored on the first token it recognised, so the
    // anchor landed on `Ismail` and `Zarul` went to the model in cleartext.
    // `assertNoIdentifiers` could not catch it: the egress guard re-runs these
    // same detectors and shared the blind spot.
    //
    // NOTE ON THE SENTENCE. It carries no introducer phrase, and that is the
    // whole point. The first draft of this test used "Nama saya Zarul bin
    // Ismail", which passes with the bug still in place: the introducer path
    // matches `Zarul` on its own, so the name never reaches the model even
    // though the patronymic span dropped it. A test for a span bug has to use a
    // sentence where the span is the only thing that can catch the name.
    const { text } = deidentify('Zarul bin Ismail datang hari ini.')
    expect(text).not.toContain('Zarul')
    expect(text).toMatch(/\[PATIENT_\d+\]/)
  })

  it('tokenises the same name whole mid-sentence, with no cue in front of it', () => {
    const { text } = deidentify('The patient Zarul bin Ismail has a cough.')
    expect(text).not.toContain('Zarul')
  })

  it('gives one token to a name an introducer also matches', () => {
    // The masking path from the note above, asserted rather than relied on.
    // Before the fix this sentence produced `[PATIENT_2] bin [PATIENT_1]`: the
    // introducer caught the given name, the patronymic span caught the family
    // name, and one person arrived at the model as two people.
    const { text } = deidentify('Nama saya Zarul bin Ismail.')
    expect(text).not.toContain('Zarul')
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(new Set(tokens).size).toBe(1)
  })

  it('still drops an honorific rather than tokenising it', () => {
    // The behaviour the anchor existed to produce, which must survive the fix.
    const { text } = deidentify('Encik Ahmad bin Ismail datang hari ini.')
    expect(text).toContain('Encik')
    expect(text).not.toContain('Ahmad')
  })

  it('keeps one token across honorific, bare and verb-led mentions of one person', () => {
    // Token stability is what the anchor was really protecting. Keeping an
    // unrecognised leading word inside the span costs it, so the words that
    // introduce a name in dictated prose are stopwords instead (gazetteer.ts).
    const { text } = deidentify(
      'Encik Ahmad bin Ismail came in. Ahmad bin Ismail has a cough. Tell Ahmad bin Ismail to rest.',
    )
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(tokens.length).toBeGreaterThanOrEqual(3)
    expect(new Set(tokens).size).toBe(1)
  })
})

describe('an unmarked name is caught wherever it sits in its run (#413)', () => {
  it.each([
    ['Today Siti Aminah came in.', 'Today'],
    ['Okay Siti Aminah, any fever?', 'Okay'],
    ['Paracetamol Siti Aminah 500 mg', 'Paracetamol'],
    ['Clinic Tan Wei Ming review.', 'Clinic'],
    ['Cough Ahmad Faizal since Monday.', 'Cough'],
  ])('tokenises the name in %j and keeps the word before it', (sentence, kept) => {
    // The run's first word used to be read before trimming, so any capitalised
    // word in front of a name sent the whole name to the model in cleartext.
    const { text } = deidentify(sentence)
    expect(text).toContain(kept)
    expect(text).toMatch(/\[PATIENT_\d+\]/)
    expect(text).not.toMatch(/Siti|Aminah|Ahmad|Faizal|Wei Ming/)
  })

  it('keeps one token for one person, and mints none for a word in front of a name', () => {
    const repeated = deidentify('Okay Siti came. Also Siti came.').text
    expect(new Set(repeated.match(/\[PATIENT_\d+\]/g)).size).toBe(1)
    expect(deidentify('Then Nur Aina Sofea binti Zulkifli came in.').text).toMatch(
      /^Then \[PATIENT_\d+\] came in\.$/,
    )
    // A brand is outside the medication lexicon, so it is listed itself.
    expect(deidentify('Panadol Siti Aminah takes it.').text).toMatch(/^Panadol \[PATIENT_\d+\]/)
  })

  it('takes an unrecognised word in front of a name into the token rather than leak it', () => {
    // Recall over precision, as #149 rules: the word may be a name element the
    // gazetteer does not know.
    for (const sentence of ['Zarul Siti Aminah came in.', 'Fever Siti Aminah came in today.']) {
      expect(deidentify(sentence).text).not.toMatch(/Zarul|Siti|Aminah/)
    }
  })
})

describe('a name is not cut where a long capitalised run splits (#416)', () => {
  it.each([
    ['Kopi Teh Nasi Zarul Ahmad came.', /Zarul|Ahmad/],
    ['Said Wrote Asked Zarul Ahmad came.', /Zarul|Ahmad/],
    ['Kopi Teh Nasi Siti Zarul came.', /Siti|Zarul/],
    ['Kopi Teh Nasi Zarul Qaseh Ahmad came.', /Zarul|Qaseh|Ahmad/],
  ])('tokenises every element of the name in %j', (sentence, name) => {
    expect(deidentify(sentence).text).not.toMatch(name)
  })

  it('covers a four-word name whole wherever its run happens to start', () => {
    const name = 'Zarul Qaseh Ahmad Damia'
    for (const lead of ['', 'Kopi ', 'Kopi Teh ', 'Kopi Teh Nasi ', 'Kopi Teh Nasi Roti ']) {
      expect(deidentify(`${lead}${name} came.`).text).not.toMatch(/Zarul|Qaseh|Ahmad|Damia/)
    }
  })

  it('gives one person one token across the old run boundary', () => {
    const { text } = deidentify('Kopi Teh Nasi Siti Aminah came.')
    expect(text.match(/\[PATIENT_\d+\]/g)).toHaveLength(1)
  })

  it.each([
    ['Seen By Nurse Siti Encik Zarul Damia Qaseh today.', /Siti|Zarul|Damia|Qaseh/],
    ['Kopi Teh Nasi Siti Dr Zarul Damia Qaseh came.', /Siti|Zarul|Damia|Qaseh/],
    ['Siti Kopi Dr Zarul Damia came.', /Siti|Zarul|Damia/],
  ])('keeps what a longer span leaves uncovered at the end of %j', (sentence, name) => {
    // A shorter span losing to a longer one kept only its uncovered prefix
    // (#183). Its uncovered end is a name element just as often.
    expect(deidentify(sentence).text).not.toMatch(name)
  })

  it.each([
    ['Seen By Nurse\nSiti Qaseh came.', /Siti|Qaseh/],
    ['Seen By Nurse\r\nSiti Qaseh came.', /Siti|Qaseh/],
    ['Seen By Nurse\n\nSiti Qaseh came.', /Siti|Qaseh/],
    ['Siti  Qaseh came.', /Siti|Qaseh|h came/],
  ])('places the token on the name however %j spaces its words', (sentence, name) => {
    // The span was rejoined with single spaces and found again by `indexOf`,
    // which missed wherever the words were not one space apart.
    expect(deidentify(sentence).text).not.toMatch(name)
  })

  it.each([
    ['Siti Qa- Qaseh came.', /Qa-|Qaseh/],
    ["Siti Firdaus' Qaseh came.", /Firdaus|Qaseh/],
  ])('carries a run past a word ending in a hyphen or apostrophe in %j', (sentence, name) => {
    expect(deidentify(sentence).text).not.toMatch(name)
  })

  it("anchors on a known name with a possessive on it, as in Siti's", () => {
    expect(deidentify("Siti's cough is worse.").text).not.toMatch(/Siti/)
  })

  it('scans a long run of hyphen-ended words in linear time', () => {
    const started = performance.now()
    detect('A- '.repeat(40_000))
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('takes up to three words a side into the token, which costs a Title-Cased header', () => {
    // The price of covering a four-word name wherever its run starts. Main lost
    // the four words sharing a fixed window with the known name; this loses up
    // to three each side of it. `Low` is a surname, so headers meet it.
    expect(
      deidentify('Assessment Acute Upper Respiratory Tract Infection Low Risk Features').text,
    ).toBe('Assessment Acute Upper [PATIENT_1]')
  })

  it('reaches no further than three words from the known name', () => {
    expect(deidentify('Kopi Teh Nasi Roti Siti came.').text).toMatch(
      /^Kopi \[PATIENT_\d+\] came\.$/,
    )
  })
})

describe('context cues match words, not substrings (#159)', () => {
  it.each(['invoice', 'notice', 'receipt'])(
    'does not boost an invalid twelve-digit number near %s',
    (word) => {
      // The actual bug: `ic` fired *inside* these words. None of them is a
      // clinical term, so none is a cue, and a reference number beside one is
      // left alone.
      expect(labelsIn(`Reference 123456789012 appears on the ${word}.`)).not.toContain('NRIC')
    },
  )

  it.each(['clinic', 'medical record', 'physician'])(
    'does boost an invalid twelve-digit number near %s, deliberately',
    (word) => {
      // These read the other way, and the third audit is why this test now
      // asserts the opposite of what it first did.
      //
      // Substring matching masked these by accident, and fixing the substring
      // bug removed the accident: "At the clinic, 990231145677 was recorded"
      // sent all twelve digits to the provider where main had masked them. A
      // structurally invalid NRIC scores 0.3 and needs a cue, and it is not
      // only an invoice number: it is the ordinary shape of a real NRIC that
      // transcription got wrong, which hosted ASR makes more likely.
      //
      // So these are cues on purpose now rather than by accident. In a clinical
      // transcript a long digit run beside them is more likely an identifier
      // than a reference, and a recall loss on the boundary outranks a
      // precision gain.
      expect(labelsIn(`At the ${word}, 990231145677 was recorded.`)).toContain('NRIC')
    },
  )

  it('still boosts on a real cue standing as its own word', () => {
    // The precision fix must not cost the recall it was protecting.
    expect(labelsIn('His ic is 850523-14-5677.')).toContain('NRIC')
    expect(labelsIn('Nombor kad pengenalan saya 900412086543.')).toContain('NRIC')
  })

  it('keeps every ADDRESS cue that main caught as a substring', () => {
    // ADDRESS scores 0.45 without a cue, under the threshold, so a cue that
    // stops matching is a whole street address leaving the boundary. The third
    // audit found seven of these; the inflections and the Malay clitic forms
    // are enumerated rather than inferred.
    for (const sentence of [
      'Dia beralamat di Jalan Ampang 5.',
      'Tinggalnya di Jalan Ampang 5.',
      'Duduknya di Jalan Ampang 5.',
      'Their addresses include Jalan Ampang 5.',
      'She addressed it to Jalan Ampang 5.',
      'Addressing mail to Jalan Ampang 5.',
      'Postcodes for Jalan Ampang 5.',
    ]) {
      expect(labelsIn(sentence), sentence).toContain('ADDRESS')
    }
  })
})

describe('MRN detection tolerates conversational phrasing (#174)', () => {
  it('still misses a record number introduced with filler words between cue and value', () => {
    // KNOWN BAD, pinned deliberately. #174 stays open.
    //
    // The filler run this asks for was written on this branch and taken back
    // out after two audit rounds. It matched the phrasing below, which is the
    // ordinary dictated form and worth having. It also masked clinical values
    // inside a single sentence: "MRN unknown so I gave 500 mg" tokenised the
    // dose, and narrowing the run twice never closed that, because a bounded
    // run of ordinary words is exactly what sits between a cue and an unrelated
    // number in ordinary prose.
    //
    // Masking a dose is a regression against a detector that was previously
    // only incomplete, and dose is what the model red-flag pass reasons over.
    // Recall here is not worth a false negative there.
    expect(labelsIn('Registration number for our clinic file is KLC-004821.')).not.toContain('MRN')
  })

  it('does not mask a dose behind a record cue in the same sentence', () => {
    // The reason the filler run is not here. Pinned so a future #174 attempt
    // has to solve this rather than rediscover it.
    for (const sentence of [
      'MRN unknown so I gave 500 mg.',
      'Patient number not yet issued give her 500 mg.',
      'I checked the MRN then wrote 1000 mg.',
    ]) {
      expect(labelsIn(sentence), sentence).not.toContain('MRN')
    }
  })

  it('detects a record number carrying more than one hyphen group, whole', () => {
    // Asserted on the output text rather than the label, because the label
    // alone passes with the single-group pattern too: that one matched
    // `RC-2026` and left `-00842` sitting in the prose, which is a partly
    // tokenised identifier and worse than an untouched one.
    const { text } = deidentify('Patient number RC-2026-00842 on file.')
    expect(text).not.toContain('00842')
    expect(text).toMatch(/\[MRN_\d+\]/)
  })

  it('still detects the adjacent form', () => {
    expect(labelsIn('MRN KLC-004821 please.')).toContain('MRN')
  })

  // The precision half. `.claude/rules/security.md`: lowering an effective
  // threshold needs a precision test, not just a recall one.
  it('does not let a cue reach a number in the next clause', () => {
    expect(labelsIn('Registration number is not on file, the dose is 500 mg daily.')).not.toContain(
      'MRN',
    )
  })

  it('does not let a cue reach a number in the next sentence', () => {
    expect(labelsIn('MRN unknown. Paracetamol 1000 mg was given.')).not.toContain('MRN')
  })

  it('does not reach past the bounded filler run', () => {
    expect(
      labelsIn('Registration number for our clinic paper file is really KLC-004821.'),
    ).not.toContain('MRN')
  })

  it('leaves an ordinary dose alone', () => {
    expect(labelsIn('Paracetamol 500 mg three times a day.')).not.toContain('MRN')
  })
})

describe('a possessive is the same person (#167)', () => {
  it('gives one token to a name and its possessive form', () => {
    const { text } = deidentify("Siti Nurhaliza came in. Siti Nurhaliza's fever has settled.")
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(tokens.length).toBeGreaterThanOrEqual(2)
    expect(new Set(tokens).size).toBe(1)
  })

  it('leaves the possessive marker in the prose rather than swallowing it', () => {
    // The token replaces the name only. Eating the `'s` would leave the note
    // reading "[PATIENT_1] fever has settled" after rehydration.
    const { text } = deidentify("Siti Nurhaliza's fever has settled.")
    expect(text).toMatch(/\[PATIENT_\d+\]'s fever/)
  })

  it('does not strip an apostrophe from inside a name', () => {
    // `O'Brien` and `Nur'ain` carry an apostrophe that is part of the name, not
    // a possessive. Only a trailing one is a possessive.
    const { text } = deidentify("Nama saya Nur'ain binti Rahman.")
    expect(text).not.toContain("Nur'ain")
    expect(text).toMatch(/\[PATIENT_\d+\]/)
  })
})

/**
 * Regressions this PR introduced and then fixed, pinned so they cannot return.
 *
 * A phi-boundary-auditor pass on the first draft found three of these, every one
 * a recall loss on the boundary caused by a change whose stated purpose was
 * precision. They are grouped together because they share a lesson rather than
 * a mechanism: **in this module, tightening a match is never precision-only.**
 * Several base scores sit below `ACCEPT_THRESHOLD` and depend on a context cue
 * to clear it, so a cue that stops matching is not a lower score, it is an
 * identifier leaving the trust boundary.
 */
describe('regressions introduced by this PR, now pinned', () => {
  it('keeps ADDRESS cues working in their inflected forms', () => {
    // The worst of them. Word-boundary matching killed `lives`, `lived`,
    // `living`, `stays` and `staying`, and ADDRESS scores 0.45 without a cue,
    // under the 0.5 threshold. Every address in a sentence phrased this way,
    // which is the ordinary phrasing, went to the provider untouched.
    for (const phrasing of ['lives at', 'lived at', 'stays at', 'staying at']) {
      const { text } = deidentify(`She ${phrasing} Jalan Ampang 5, 50450 Kuala Lumpur.`)
      expect(text, phrasing).toContain('[ADDRESS_1]')
    }
  })

  it('keeps the Malay possessive clitic working as an NRIC cue', () => {
    // `pesakit` stopped covering `pesakitnya`, and the fallback was worse than
    // no match: PHONE claimed ten of the twelve digits and left two in the
    // clear, which is a partly tokenised identifier.
    const { text } = deidentify('Pesakitnya ada nombor 991332145501 di sini.')
    expect(text).not.toContain('99')
    expect(text).toContain('[NRIC_1]')
  })

  it('keeps the leading element when the name is longer than the patronymic pattern admits', () => {
    // Was `Nur [PATIENT_1] came in.` (#183). The gazetteer run
    // `Nur Aina Sofea Batrisyia` [0,24) and the patronymic span
    // `Aina Sofea Batrisyia binti Zulkifli` [4,39) partly overlap; the longer
    // one won and `resolveOverlaps` discarded the loser whole, including the
    // four characters no accepted span covered.
    //
    // `PATRONYMIC_PATTERN` is still `{0,2}`, which is the point: widening it
    // relocates the leak rather than closing it, and makes the span greedy
    // enough to eat a symptom list.
    const { text } = deidentify('Nur Aina Sofea Batrisyia binti Zulkifli came in.')
    expect(text).not.toContain('Nur')
    expect(text).toMatch(/^\[PATIENT_\d+\] \[PATIENT_\d+\] came in\.$/)
  })

  it('still drops a shorter match that sits wholly inside the winner', () => {
    // The other half of the rule, and the reason the original docstring gave
    // for dropping at all: a contained span has no uncovered prefix, so
    // replacing it would corrupt the winner's offsets and leave a fragment of
    // the identifier behind. `Tan Wei Ming` is inside `Tan Wei Ming binti
    // Ahmad`, and exactly one token must come out.
    const { text } = deidentify('Tan Wei Ming binti Ahmad came in.')
    expect(text).toBe('[PATIENT_1] came in.')
  })

  it('still leaks when the name is longer than any competing match reaches', () => {
    // KNOWN BAD, pinned deliberately. Issue #183, and NOT closed by its own
    // fix. Reported back on the issue rather than left silent.
    //
    // The prefix fix can only recover text some other detector actually
    // matched. Here nothing does: `CAPITALISED_RUN` caps at four words and the
    // gazetteer pass needs its *first* word to be a known given name, and
    // `zarul`, `qaseh` and `damia` are all outside the roughly 200 names in
    // `GIVEN_NAMES`. So no match covers `Zarul Aina Sofea`, and there is no
    // uncovered prefix to preserve.
    //
    // Closing it needs the patronymic span itself to reach further left, which
    // is the widening #178 measured and reverted: it cannot tell
    // `Zarul Aina Sofea Batrisyia Qaseh Damia` from
    // `Acute Cough Sore Throat Fever`, and swallowing the second deletes the
    // symptom list from what the model reads. Separating them needs a
    // vocabulary list that `no-stray-clinical-constants.test.ts` refuses, or a
    // model. Neither is in this fix's scope.
    const { text } = deidentify('Patient: Zarul Aina Sofea Batrisyia Qaseh Damia binti Zulkifli')
    expect(text).toContain('Zarul Aina Sofea')
    expect(text).toMatch(/\[PATIENT_\d+\]$/)
  })

  it('still swallows Title-Cased clinical words directly in front of a name', () => {
    // KNOWN BAD, pinned deliberately. Issue #183.
    //
    // The cost of closing #149. The gazetteer anchor used to skip past words it
    // did not recognise to reach a known given name, which both leaked
    // unrecognised name elements (#149) and protected against this. Removing it
    // fixed the leak and gave up the protection.
    //
    // A vocabulary list in `gazetteer.ts` would close it, and must not be used:
    // `no-stray-clinical-constants.test.ts` refuses clinical terms outside the
    // versioned data, and it is right to. #183's fix removes the need for one.
    //
    // Bounded in practice: `CAPITALISED_RUN` only reaches Title-Cased words, so
    // ordinary prose ("acute cough, sore throat") is unaffected. It takes a
    // header-style line to trigger.
    //
    // **It costs token stability too, which is worse than swallowing a word.**
    // The swallowed word is part of the matched span, so the same person
    // introduced two different ways mints two tokens and the model is told
    // there are two patients. That is the exact harm `trimNameSpan` exists to
    // prevent, per its own docstring, and it is the counterweight to the #149
    // recall gain rather than a footnote to it. Pinned below so the cost is
    // measured rather than described.
    const { text } = deidentify('Acute Cough Sore Throat Fever Ahmad bin Ismail attended.')
    expect(text).not.toContain('Ahmad')
    expect(text).toContain('Acute Cough Sore')
  })

  it('splits one person into two tokens when a Title-Cased word precedes one mention', () => {
    // KNOWN BAD, pinned deliberately. Issue #183, and the honest price of #149.
    // `main` gives one token here; this branch gives two.
    const { text } = deidentify('Wheeze Ahmad bin Ismail has. Ahmad bin Ismail came back.')
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(tokens).toHaveLength(2)
    expect(new Set(tokens).size).toBe(2)
  })

  it('keeps one token for one person across two sentences', () => {
    const { text } = deidentify('Saw Ahmad bin Ismail today. Ahmad bin Ismail has a cough.')
    const tokens = [...text.matchAll(/\[PATIENT_\d+\]/g)].map((m) => m[0])
    expect(tokens.length).toBe(2)
    expect(new Set(tokens).size).toBe(1)
  })

  it('does not let a sentence-final MRN cue reach into the next sentence', () => {
    // Dose, age and duration are what the model red-flag pass reasons over.
    // Masking them degrades that pass in the false-negative direction, which
    // `healthcare-cdss-patterns` holds to zero tolerance.
    for (const sentence of [
      'Check her MRN. Give 500 mg of paracetamol.',
      'Patient ID. She takes metformin 500 mg daily.',
    ]) {
      expect(labelsIn(sentence), sentence).not.toContain('MRN')
    }
  })

  it('still allows a full stop between cue and value when they are adjacent', () => {
    // The other side of the same rule. Banning the stop outright broke this,
    // where it abbreviates rather than ends a sentence.
    expect(labelsIn('Registration no. KLC-004821 for the file.')).toContain('MRN')
  })

  it('does not tokenise an age behind a record cue', () => {
    // A record number is not one or two digits. Relaxing the first digit group
    // to two masked the age here.
    expect(labelsIn('MRN pending she is 65 years old.')).not.toContain('MRN')
  })
})

/**
 * Name elements that are also honorific words.
 *
 * Pre-existing, and surfaced by the audit rather than introduced here. It
 * matters now because `trimNameSpan` no longer consults the gazetteer at all,
 * so `NAME_STOPWORDS` and `HONORIFIC_WORDS` are the only things deciding where
 * a name starts.
 */
describe('an honorific that is also a name', () => {
  it('does not drop Sri from the front of a name', () => {
    // `Tan Sri` split on whitespace put `tan` and `sri` into the drop set
    // individually. Multi-word honorifics are now dropped only as whole
    // phrases.
    const { text } = deidentify('Sri Devi a/p Ramasamy came in today.')
    expect(text).not.toContain('Sri')
  })

  it('does not drop Tan, the commonest Chinese Malaysian surname', () => {
    const { text } = deidentify('Tan Wei Ming binti Ahmad came in.')
    expect(text).not.toContain('Tan')
  })

  it('still drops Tan Sri when it really is the honorific', () => {
    // The behaviour the phrase drop exists to preserve.
    const { text } = deidentify('Tan Sri Ahmad bin Ismail came in.')
    expect(text).toContain('Tan Sri')
    expect(text).not.toContain('Ahmad')
  })

  it('still drops every single-word honorific', () => {
    for (const title of ['Encik', 'Dr', 'Puan', 'Datuk']) {
      const { text } = deidentify(`${title} Ahmad bin Ismail came in.`)
      expect(text, title).toContain(title)
      expect(text, title).not.toContain('Ahmad')
    }
  })
})

describe('addresses tokenise whole, postcode or not (#181)', () => {
  it('reaches the postcode instead of stopping two characters in', () => {
    // A lazy run followed by an optional group never expands, so this matched
    // `Jalan Bu` and left street, number, postcode and city in the clear.
    const { text } = deidentify('Her address is Jalan Bukit Bintang 5, 50450 Kuala Lumpur.')
    expect(text).not.toContain('Bintang')
    expect(text).not.toContain('50450')
    expect(text).toBe('Her address is [ADDRESS_1].')
  })

  it('reaches the end of an address carrying no postcode', () => {
    // Was `[ADDRESS_1]pang 5, Kuala Lumpur`: street name, house number and city
    // all survived the boundary. The no-postcode branch matched its
    // two-character minimum for the same reason the postcode branch did.
    const { text } = deidentify('She lives at Jalan Ampang 5, Kuala Lumpur.')
    expect(text).not.toContain('Ampang')
    expect(text).not.toContain('Kuala Lumpur')
    expect(text).toBe('She lives at [ADDRESS_1].')
  })

  it('tokenises a house number in front of the street type', () => {
    const { text } = deidentify('He lives at No. 12, Jalan Sultan Ismail, Kuala Lumpur.')
    expect(text).not.toContain('12')
    expect(text).not.toContain('Sultan')
    expect(text).toBe('He lives at [ADDRESS_1].')
  })

  /*
   * The precision half, and the reason a greedy `{2,40}` was refused. A
   * tokenised span is removed from what the model reads, so an address run that
   * eats the medication after it deletes that medication from the note the
   * red-flag pass reasons over. `healthcare-cdss-patterns` holds that direction
   * to zero tolerance, which makes over-tokenising here worse than the leak it
   * would close.
   */
  it('stops at ordinary prose instead of swallowing medication, dose or duration', () => {
    const cases = [
      'She lives at Jalan Ampang 5 and takes paracetamol 500 mg.',
      'She stays at Taman Melati 3. She takes metformin 500 mg daily.',
      'He lives at Lorong Kurau 2 and has had a cough for 3 days.',
    ]
    for (const sentence of cases) {
      const { text } = deidentify(sentence)
      expect(text, sentence).toContain('[ADDRESS_1]')
    }

    expect(deidentify(cases[0] ?? '').text).toBe(
      'She lives at [ADDRESS_1] and takes paracetamol 500 mg.',
    )
    expect(deidentify(cases[1] ?? '').text).toBe(
      'She stays at [ADDRESS_1]. She takes metformin 500 mg daily.',
    )
    expect(deidentify(cases[2] ?? '').text).toBe(
      'He lives at [ADDRESS_1] and has had a cough for 3 days.',
    )
  })

  it('keeps the postcode score branch reachable, and cue-free', () => {
    // `hasPostcode` scores 0.8 and clears `ACCEPT_THRESHOLD` on its own, so an
    // address carrying a postcode survives a sentence with no context cue in
    // it. Without a postcode the base is 0.45 and a cue is mandatory. Both
    // halves are asserted, because the postcode branch being unreachable is
    // what made every address depend on a cue before #178.
    expect(labelsIn('Jalan Bukit Bintang 5, 50450 Kuala Lumpur was noted.')).toContain('ADDRESS')
    expect(labelsIn('Jalan Ampang 5 was noted.')).not.toContain('ADDRESS')
  })

  /*
   * The case bound cuts both ways, so the lower-case half is measured rather
   * than assumed. Requiring a capital on every element meant
   * `she lives at jalan ampang 5` matched nothing at all, which is a whole
   * address leaving the boundary where the old truncating version at least
   * raised ADDRESS. The first element is therefore exempt.
   *
   * The remainder of a lower-case address is still partial: `ismail` and
   * `kuala lumpur` below survive, because every element after the first is
   * strict and that strictness is what stops the run eating clinical prose.
   * Pinned so the limit is a measured number rather than a description, and so
   * a later widening has something to compare against.
   */
  it('still reaches a lower-case address, and is honest that it reaches only part', () => {
    expect(labelsIn('she lives at jalan ampang 5, kuala lumpur.')).toContain('ADDRESS')

    const { text } = deidentify('she lives at jalan ampang 5 and takes paracetamol 500 mg.')
    expect(text).toBe('she lives at [ADDRESS_1] and takes paracetamol 500 mg.')

    // KNOWN PARTIAL. A postcode still anchors the whole span regardless of case.
    expect(deidentify('her address is jalan bukit bintang 5, 50450 kuala lumpur.').text).toBe(
      'her address is [ADDRESS_1].',
    )
    // ...but with no postcode the run stops at the first lower-case element.
    expect(deidentify('he lives at no. 12, jalan sultan ismail, kuala lumpur.').text).toContain(
      'ismail, kuala lumpur',
    )
  })

  it('does not let a street name run across a line break', () => {
    // Separators are spaces and tabs, never `\s`. A dictated turn ending in an
    // address must not annex the first Title-Cased word of the next line.
    const { text } = deidentify('She lives at Taman Melati 3\nPanadol was given.')
    expect(text).toContain('Panadol was given.')
  })
})

/*
 * Slicing happens after the gate, never before it, because detection is
 * context-sensitive: `Ahmad Ismail` is one PATIENT span only while the two
 * words are adjacent. De-identifying chunk by chunk would let an identifier
 * straddling a boundary through, so the whole text is gated once and the
 * result is cut.
 */
describe('sliceDeidentified', () => {
  const gated = (text: string) => deidentify(text).text

  it('returns the value untouched when it already fits', () => {
    const content = gated('doctor good morning patient i have a cough')
    expect(sliceDeidentified(content, 600)).toEqual([content])
  })

  it('cuts only on whitespace, so every piece is a substring of the whole', () => {
    const content = gated('one two three four five six seven eight nine ten eleven twelve')
    for (const piece of sliceDeidentified(content, 20)) {
      expect(content).toContain(piece)
    }
  })

  it('loses no word across the cuts', () => {
    const content = gated('one two three four five six seven eight nine ten eleven twelve')
    const words = (text: string) => text.split(/\s+/).filter(Boolean)
    expect(sliceDeidentified(content, 20).flatMap(words)).toEqual(words(content))
  })

  /*
   * The case that matters most: a vault token split into `[PATIENT` and `_1]`
   * would stop matching the token pattern, and `assertNoIdentifiers` strips
   * tokens before re-running detection, so a broken one could read as a leaked
   * identifier or slip past as ordinary words.
   */
  it('never splits a vault token, at any budget', () => {
    const content = gated('Ahmad bin Ismail called about his cough and his fever today')
    expect(content).toMatch(/\[PATIENT_1\]/)
    for (let budget = 4; budget < content.length; budget += 1) {
      for (const piece of sliceDeidentified(content, budget)) {
        expect(piece).not.toMatch(/\[[A-Z]+_\d*$/)
        expect(piece).not.toMatch(/^_?\d*\]/)
      }
    }
  })

  it('ships a single word longer than the budget whole rather than cutting it', () => {
    const content = gated('supercalifragilisticexpialidocious cough')
    const pieces = sliceDeidentified(content, 5)
    expect(pieces.some((piece) => piece.includes('supercalifragilisticexpialidocious'))).toBe(true)
    expect(pieces.flatMap((piece) => piece.split(/\s+/)).filter(Boolean)).toEqual(
      content.split(/\s+/).filter(Boolean),
    )
  })

  it('yields no empty piece, whatever the whitespace looks like', () => {
    const content = gated('one   two \n\n three    four')
    for (const piece of sliceDeidentified(content, 6)) {
      expect(piece.trim()).not.toBe('')
    }
  })
})

/*
 * Mandarin translation spells a Chinese name in Pinyin (#385), which the
 * Malaysian romanisations above never match: 陈伟 comes back "Chen Wei", not
 * "Tan Wei". No sentence carries an introducer, for the reason given below.
 */
describe('Pinyin names with no cue in front of them (#385)', () => {
  it.each([
    { sentence: 'Chen Wei has had a cough for three days.', parts: ['Chen', 'Wei'] },
    { sentence: 'Wang Fang came with her daughter.', parts: ['Wang', 'Fang'] },
    { sentence: 'Zhang has had a fever since Monday.', parts: ['Zhang'] },
    { sentence: 'Liu Yang has a sore throat but no fever.', parts: ['Liu', 'Yang'] },
    { sentence: 'Please ask Huang to wait outside.', parts: ['Huang'] },
  ])('tokenises the name in $sentence', ({ sentence, parts }) => {
    const { text } = deidentify(sentence)
    for (const part of parts) expect(text, part).not.toContain(part)
    expect(text).toMatch(/\[PATIENT_\d+\]/)
  })

  it('does not tokenise a clinical word that only resembles a new entry', () => {
    for (const sentence of [
      'Linctus helped the cough at night.',
      'Cheng-style breathing was not seen, and the chest was clear.',
      'Zinc lozenges were taken for the sore throat.',
    ]) {
      expect(labelsIn(sentence), sentence).not.toContain('PATIENT')
    }
  })
})

/*
 * Urdu and Bengali translation puts Pakistani and Bangladeshi names,
 * transliterated, into English transcripts (#391). No sentence below carries an
 * introducer or an honorific, because a cue catches a name whether or not the
 * gazetteer knows it, and the gazetteer pass has to be the only thing that can.
 */
describe('Pakistani and Bangladeshi names with no cue in front of them (#391)', () => {
  it.each([
    { sentence: 'Asif, please sit down.', parts: ['Asif'] },
    { sentence: 'Nasrin Akter came with her brother.', parts: ['Nasrin', 'Akter'] },
    { sentence: 'Sanjoy Das has had a fever since Monday.', parts: ['Sanjoy', 'Das'] },
    { sentence: 'Imran has had a sore throat for three days.', parts: ['Imran'] },
    { sentence: 'Rahim Uddin has had a runny nose since Friday.', parts: ['Rahim', 'Uddin'] },
    { sentence: 'Kalpana Biswas has a sore throat but no fever.', parts: ['Kalpana', 'Biswas'] },
    // Only the first word of a run is looked up, so an unlisted leading element
    // hides every listed name behind it.
    { sentence: 'Mohammad Rubel Hossain has a cough.', parts: ['Mohammad', 'Rubel', 'Hossain'] },
    { sentence: 'Md Sumon Miah was seen yesterday with a fever.', parts: ['Md', 'Sumon', 'Miah'] },
    { sentence: 'Syed Kashif has burning on passing urine.', parts: ['Syed', 'Kashif'] },
    { sentence: 'Abdur Rahim has been coughing at night.', parts: ['Abdur', 'Rahim'] },
    { sentence: 'Begum Rokeya has had a fever for two days.', parts: ['Begum', 'Rokeya'] },
    // Leading elements review found hiding the listed names behind them.
    { sentence: 'Qazi Imran Ahmed has a cough.', parts: ['Qazi', 'Imran', 'Ahmed'] },
    { sentence: 'Sheikh Nasrin has had a fever since Monday.', parts: ['Sheikh', 'Nasrin'] },
    { sentence: 'Hafiz Kashif has burning on passing urine.', parts: ['Hafiz', 'Kashif'] },
    // Second elements people are addressed by on their own.
    { sentence: 'Please ask Chowdhury to wait outside.', parts: ['Chowdhury'] },
    { sentence: 'Khan says the cough is worse at night.', parts: ['Khan'] },
  ])('tokenises the name in $sentence', ({ sentence, parts }) => {
    const { text } = deidentify(sentence)
    for (const part of parts) expect(text, part).not.toContain(part)
    expect(text).toMatch(/\[PATIENT_\d+\]/)
  })

  /*
   * The precision half. No new entry is a common English word or a clinical
   * term, and only `karim` doubles as a Malay word, a rare adjective; these pin
   * the lookup to whole words against the nearest clinical look-alikes. `rubel` opens `Rubella`,
   * `Rash` opens `rashid`, `Imuran` is one letter from `imran`, and the `MD` of
   * a medical degree is upper-case where the Bangladeshi `Md` is not.
   */
  it('does not tokenise a clinical word that only resembles a new entry', () => {
    for (const sentence of [
      'Rubella vaccination is up to date and there is no rash.',
      'Rash started on Tuesday, two days after the sore throat.',
      'Imuran was stopped last year, and the cough began on Friday.',
      'Discussed with the MD on call, who advised nitrofurantoin for the burning urine.',
    ]) {
      expect(labelsIn(sentence), sentence).not.toContain('PATIENT')
    }
  })

  /*
   * "shah" and "alam" are common Pakistani and Bangladeshi surnames, and were
   * stopwords because "Shah Alam" is a Selangor city. `trimNameSpan` strips a
   * trailing stopword, so the surname was left in cleartext after the given
   * name was tokenised. The owner chose to treat both as names (28/09/26).
   */
  it('keeps a trailing Shah or Alam inside the name token', () => {
    expect(deidentify('Imran Shah has a cough.').text).toBe('[PATIENT_1] has a cough.')
    expect(deidentify('Mohammad Alam has fever.').text).toBe('[PATIENT_1] has fever.')
    expect(deidentify('My name is Imran Shah.').text).toBe('My name is [PATIENT_1].')
  })

  // The cost of that choice, pinned so it stays visible: the city is still
  // left alone with no name cue in front of it, and tokenised after one.
  it('leaves the city Shah Alam alone unless a name cue precedes it', () => {
    expect(labelsIn('She drove in from Shah Alam this morning.')).not.toContain('PATIENT')
    expect(labelsIn('This is Shah Alam traffic, doctor.')).toContain('PATIENT')
  })
})

/*
 * Script no other detector reads (#391, docs/trd.md §20.12). Bengali, Urdu in
 * Arabic script, and Devanagari are tokenised as whole runs at the gate, so a
 * name written in one of them cannot reach the model whatever a client sends.
 * Synthetic text throughout.
 */
describe('SCRIPT, the detector for script the gate cannot otherwise read', () => {
  const UNREADABLE = /[ঀ-৿؀-ۿऀ-ॿ]/u

  it.each([
    ['Bengali', 'She wrote: আমার নাম রহিম উদ্দিন, আমার জ্বর।'],
    ['Urdu', 'He said میرا نام عمران شاہ ہے before the exam.'],
    ['Devanagari', 'The note read मुझे बुखार है.'],
  ])('tokenises a %s run as one span', (_script, sentence) => {
    const { text, detected } = deidentify(sentence)
    expect(text).not.toMatch(UNREADABLE)
    expect(text.match(/\[SCRIPT_\d+\]/g)).toHaveLength(1)
    expect(detected).toContain('SCRIPT')
  })

  it('lets the egress guard refuse a payload that kept any of it', () => {
    const smuggled = 'Patient said আমার নাম রহিম' as never
    expect(() => assertNoIdentifiers(smuggled, 'note_and_gaps')).toThrow(/SCRIPT/)
  })

  it('never names the matched script in the exception', () => {
    const smuggled = 'Patient said আমার নাম রহিম' as never
    try {
      assertNoIdentifiers(smuggled, 'note_and_gaps')
      expect.unreachable('guard should have thrown')
    } catch (error) {
      expect(String(error)).not.toMatch(UNREADABLE)
    }
  })

  it('leaves English, Malay, Chinese and Tamil alone', () => {
    for (const sentence of [
      'Cough for three days, no fever.',
      'Batuk tiga hari, tiada demam.',
      '咳嗽三天,没有发烧。',
      'இருமல் மூன்று நாட்கள்.',
    ]) {
      expect(labelsIn(sentence), sentence).not.toContain('SCRIPT')
    }
  })

  it('carries the pasted fixture to the model with no unreadable script', () => {
    const fixture = FIXTURES.find((f) => f.id === 'urti-script-mixed-paste')
    if (!fixture) throw new Error('fixture missing')

    const { text, detected } = deidentifyTranscript(fixture.transcript)

    expect(text).not.toMatch(UNREADABLE)
    expect(detected).toContain('SCRIPT')
    expect(text).toContain('Sore throat and cough for four days.')
  })

  /*
   * Found in review. A lowercase Latin surname between two script runs was
   * left between two tokens, and no Latin detector reads a lowercase name.
   */
  it('takes a Latin word with script on both sides into the run', () => {
    const { text } = deidentify('میرا نام عمران chowdhury شاہ ہے')
    expect(text).toBe('[SCRIPT_1]')
  })

  it('keeps an Urdu name split by a right-to-left mark as one token', () => {
    expect(deidentify('عمران‏شاہ has a cough.').text).toBe('[SCRIPT_1] has a cough.')
  })

  it('never swallows the speaker label of the next transcript line', () => {
    const { text } = deidentify('Doctor: আপনার নাম কী?\nPatient: আমার নাম রহিম')
    expect(text).toMatch(/^Doctor: \[SCRIPT_\d\]\?\nPatient: \[SCRIPT_\d\]$/)
    expect(new Set(text.match(/\[SCRIPT_\d\]/g))).toHaveProperty('size', 2)
  })

  it('leaves Latin words after the last script word readable', () => {
    expect(deidentify('আমার জ্বর and chest pain.').text).toBe('[SCRIPT_1] and chest pain.')
  })

  /*
   * Digits written in these scripts go into the token too, which review found
   * costs a vital sign written that way ("SpO2 was ۹۵%"). Kept, because the
   * NRIC, phone and date detectors read ASCII digits only: an identifier in
   * Bengali or Urdu digits would pass every one of them.
   */
  it('tokenises digits written in these scripts, which no number detector reads', () => {
    expect(deidentify('IC ৯০০১০১-১৪-৫৬৭৮ on file.').text).toBe('IC [SCRIPT_1] on file.')
    expect(deidentify('SpO2 was ۹۵%').text).toBe('SpO2 was [SCRIPT_1]%')
  })
})

describe('Mandarin, Tamil and Cantonese speech at the gate (#218)', () => {
  it.each(LANGUAGE_SAMPLES.map((sample) => [sample.language, sample] as const))(
    'carries %s clinical speech to the model unchanged',
    (_language, sample) => {
      for (const line of sample.lines) expect(deidentify(line).text).toBe(line)
    },
  )

  it.each(LANGUAGE_SAMPLES.map((sample) => [sample.language, sample] as const))(
    'tokenises a %s name a speaker introduces in its own script (#418)',
    (_language, sample) => {
      const { text } = deidentify(sample.introduction.text)
      expect(text).not.toContain(sample.introduction.name)
      expect(text).toMatch(/\[PATIENT_\d+\]/)
    },
  )
})

describe('names in Chinese and Tamil script are found by their cues (#418)', () => {
  it.each([
    ['陈先生，你咳嗽多久了？', '陈'],
    ['黃小姐今日發燒。', '黃'],
    ['林医生说要多喝水。', '林'],
    ['陈小姐来了。', '陈'],
    ['我姓陈，叫美玲。', '美玲'],
    ['我姓陈名美玲。', '美玲'],
    ['我叫：陈美玲。', '陈美玲'],
    ['我叫「陈美玲」。', '陈美玲'],
    ['我叫欧阳娜娜。', '欧阳娜娜'],
    ['司徒先生，请坐。', '司徒'],
    ['赵先生发烧了。', '赵'],
    ['陈 先生，请坐。', '陈'],
    ['என் பெயர் ஆர். லட்சுமி.', 'லட்சுமி'],
    ['திரு.ராமசாமி வந்தார்.', 'ராமசாமி'],
    ['என் பேர் முருகன்.', 'முருகன்'],
    ['Mr 陈 is here.', '陈'],
    ['Encik ராமசாமி came.', 'ராமசாமி'],
    ['我的名字是美玲。', '美玲'],
    ['我名叫阿玲，发烧三天。', '阿玲'],
    ['我女儿叫陈小美。', '陈小美'],
    ['我老公姓林。', '林'],
    ['你好陈小姐，咳嗽多久了？', '陈'],
    ['您好林先生。', '林'],
    ['早上好黄太太。', '黄'],
    ['我先生叫林志明。', '林志明'],
    ['我妈叫陈美华。', '陈美华'],
    ['என் மனைவி பெயர் கவிதா.', 'கவிதா'],
    ['என் மகள் பெயர் கவிதா.', 'கவிதா'],
    ['我叫做陈美玲。', '陈美玲'],
    ['我姓陈，叫做美玲。', '美玲'],
    ['我姓陈，叫陈美玲。', '陈美玲'],
    ['我姓欧阳，叫欧阳娜娜。', '娜娜'],
    ['他叫陈伟。', '陈伟'],
    ['谢谢陈医生。', '陈'],
    ['என் பெயர் R. லட்சுமி.', 'லட்சுமி'],
    ['我姓陈。', '陈'],
    ['我的名字是王小明。', '王小明'],
    ['திரு ராமசாமி வந்தார்.', 'ராமசாமி'],
    ['திருமதி லட்சுமி காய்ச்சல்.', 'லட்சுமி'],
    ['எனது பெயர் முருகன்.', 'முருகன்'],
    ['Nama saya 陈美玲.', '陈美玲'],
    ['My name is கலைச்செல்வி.', 'கலைச்செல்வி'],
  ])('tokenises the name in %j', (sentence, name) => {
    const { text } = deidentify(sentence)
    expect(text).not.toContain(name)
    expect(text).toMatch(/\[PATIENT_\d+\]/)
  })

  it('finds a name again where it is said without its cue', () => {
    const { text } = deidentify('我叫陈美玲。陈美玲今年三十岁。')
    expect(text).not.toContain('陈美玲')
    expect(new Set(text.match(/\[PATIENT_\d+\]/g)).size).toBe(1)
  })

  it('never carries a wrong guess cut from the middle of a phrase', () => {
    const { text } = deidentify('我姓陈，叫我小陈就好。我小便有点痛。')
    expect(text).toContain('小便有点痛')
  })

  it('carries a Tamil name only as a whole word', () => {
    expect(deidentify('என் பெயர் மணி. மணிக்கு ஒரு முறை மருந்து.').text).toContain('மணிக்கு ஒரு')
  })

  it('reads one name per title, so two people in a row are both found', () => {
    expect(deidentify('திரு ராமசாமி திருமதி லட்சுமி வந்தனர்.').text).not.toMatch(/ராமசாமி|லட்சுமி/)
  })

  it('takes one name word after a Tamil title, so a symptom after it survives', () => {
    expect(deidentify('செல்வி கவிதா இருமல் உள்ளது.').text).toContain('இருமல்')
  })

  /*
   * KNOWN GAP, pinned deliberately (#418, D-011). The title rule reads the
   * surname alone, directly before the title: reading further back is how
   * 白天医生 ("daytime, the doctor") and 高血压医生 ("blood pressure, the doctor")
   * became names. A full name before a title, with no other cue, still passes.
   */
  it('still passes a full name said only before a title', () => {
    expect(deidentify('陈美玲小姐来了。').text).toContain('陈美玲')
  })

  /*
   * KNOWN GAP, pinned deliberately (#418, D-011). Bare 我叫 is as often "I
   * called" as "my name is", so a given name with no surname after it is not
   * read. A surname-led name after 我叫, or a given name after 我的名字是, is.
   */
  it('still passes a given name alone after a bare 我叫', () => {
    expect(deidentify('我叫美玲。').text).toContain('美玲')
  })

  it.each([
    '去看医生了。',
    '这位先生咳嗽。',
    '老太太发烧三天。',
    '喉咙痛，要看医生吗？',
    '谢谢医生。',
    '谢谢医生，我会按时吃药。',
    '謝謝醫生！',
    '多谢医生。',
    '唔该医生。',
    '如果发高烧要马上看医生。',
    '需要马上看医生吗？',
    '你要马上去看医生。',
    '马上叫医生来。',
    '发高烧看医生了吗？',
    '我曾经看医生，吃了抗生素。',
    '之前曾看医生吗？',
    '何时看医生比较好？',
    '任何医生都会这样说。',
    '白天看医生，晚上咳得更厉害。',
    '白天医生不在。',
    '夏天医生建议多喝水。',
    '方便看医生的时候再来。',
    '咳出黄痰看医生吧。',
    '黄痰医生说是细菌感染。',
    '这周医生会打电话给你。',
    '下周医生再检查。',
    '上周医生开了药。',
    '每周医生都来。',
    '周日医生休息。',
    '其余医生都同意。',
    '关于医生的建议，我会照做。',
    '有关医生开的药。',
    '由于医生不在，护士先看。',
    '对于医生来说很正常。',
    '至于医生说的，我明白。',
    '我叫救护车来的。',
    '我叫了医生。',
    '我叫医生来看。',
    '我叫老婆带我来。',
    '我叫妈妈煮粥。',
    '我叫同事帮我请假。',
    '我叫咗医生。',
    '病人叫痛。',
    '病人叫醒了。',
    '这个药名字叫阿莫西林。',
    '药的名字是必理痛。',
    '这种病名字叫流感。',
    '名字是什么药？',
    '老师说我发烧要回家。',
    '我是老师，每天讲话喉咙痛。',
    '学校老师让我看医生。',
    '石头先生。',
    '金银花茶对喉咙好吗？',
    '用温水漱口。',
    '姜茶可以喝吗？',
    '喝点姜汤。',
    '毛病很多。',
    '关节痛。',
    '先生，请坐。',
    '小姐，你哪里不舒服？',
    '太太，你发烧几天了？',
    '医生，我咳嗽三天了。',
    '这位小姐咳嗽。',
    '那位太太发烧。',
    '喉咙痛三天了，吃了何首乌。',
    '咳嗽有痰，痰是黄色的。',
    '没有胸痛，没有呼吸困难。',
    '每天三次，每次一粒，饭后吃。',
    '你叫什么名字？',
    '你的名字是？',
    '请问你的名字是什么？',
    '我叫你明天再来。',
    '我叫他早点睡。',
    '他叫我来的。',
    '他姓什么？',
    '我姓什么不重要。',
    '喉咙好痛，医生。',
    '我女儿发烧，老师叫她回家。',
    '有冇发烧？',
    '食咗必理痛。',
    '周身骨痛。',
    '高血压医生说要控制。',
    '发高烧医生说要验血。',
    '石膏医生说不用。',
    '马来西亚医生建议打疫苗。',
    '马来医生。',
    '周末先生陪我来。',
    '任何先生小姐都可以来。',
    '于是医生给我开药。',
    '甘草片可以吃吗？',
    '段时间医生再看。',
    '向医生报告。',
    '跟医生说清楚。',
    '给医生看。',
    '请医生开药。',
    '叫醫生嚟。',
    'உங்கள் பெயர் என்ன?',
    'காய்ச்சல் மூன்று நாட்கள்.',
    'இருமல் இருக்கிறது.',
    'திருமணம் ஆனவரா?',
    'திருச்சி போனேன்.',
    'மருந்தின் பெயர் பாராசிட்டமால்.',
    'என் பெயர் என்ன என்று கேட்டார்.',
    'என் பெயர் சொல்லவா?',
    'டாக்டர் சொன்னார்.',
    'டாக்டர், எனக்கு காய்ச்சல்.',
    'The medicine name is 必理痛.',
    'saya 咳嗽三天',
    'I am 很累 already doctor',
    'my name is 什么 you ask?',
    '体温医生量过了。',
    '主任医生说要住院。',
    '胆结石医生说要开刀。',
    '病史医生都看了。',
    '明白医生。',
    '也许医生会打电话。',
    '终于医生来了。',
    '几分钟医生就来。',
    '我很紧张医生。',
    'symptoms 高烧三天',
    'Dr 高烧三天了',
    'terms 马上去急诊',
    'Cik 黄痰很多',
    '我叫救护车。',
    '我叫医生。',
    '我叫醫生。',
    '我叫護士嚟。',
    '我叫白車。',
    '我叫老公。',
    '我叫媽媽。',
    '我叫儿子。',
    '我叫外卖。',
    '我叫的士。',
    '我叫醒他。',
    '我叫佢食藥。',
    '我叫做检查。',
    '我叫醫生嚟。',
    'Puan 高血压 ada ke?',
    'Dr 马上 come?',
  ])('leaves clinical speech with no name in it alone: %j', (sentence) => {
    expect(deidentify(sentence).text).toBe(sentence)
  })

  it('lets the egress guard refuse a payload that kept a cued name', () => {
    expect(() => assertNoIdentifiers('我叫陈美玲' as never, 'note_and_gaps')).toThrow(/PATIENT/)
  })
})
