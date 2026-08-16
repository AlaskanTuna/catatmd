import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../fixtures/index.js'
import { detect } from './detectors.js'
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
    // `zarul`, `qaseh` and `damia` are all outside the roughly 130 names in
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
