import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../fixtures/index.js'
import { detect } from './detectors.js'
import { assertNoIdentifiers, deidentify, deidentifyTranscript } from './index.js'
import { isStructurallyValidNric } from './nric.js'
import { RequestTokenVault } from './vault.js'

const labelsIn = (text: string) => [...new Set(detect(text).map((m) => m.label))].sort()

describe('detector inventory (docs/trd.md §9)', () => {
  it('detects a Malaysian NRIC', () => {
    expect(labelsIn('My IC number is 850523-14-5677.')).toContain('NRIC')
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

    expect(detected).toEqual(
      expect.arrayContaining(['ADDRESS', 'EMAIL', 'NRIC', 'PATIENT', 'PHONE']),
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
