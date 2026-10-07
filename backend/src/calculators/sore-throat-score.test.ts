import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { documentRef } from '../guidelines/documents.js'
import { prefillSoreThroatScore, SORE_THROAT_SCORE_VERSION, scoresFor } from './index.js'

/**
 * A wrong answer pre-selected is worse than an empty one (#221), so most of
 * these pin an input to `null`. Real transcripts never carry reviewed labels,
 * and nothing here reads them.
 */

type Turn = { speaker: 'doctor' | 'patient'; text: string }

const transcript = (turns: Turn[]): Transcript => ({ source: 'paste', turns })

const filled = (...turns: Turn[]) =>
  Object.fromEntries(
    prefillSoreThroatScore(transcript(turns)).items.map((item) => [
      item.id,
      item.suggestion?.optionId ?? null,
    ]),
  )

const patient = (text: string): Turn => ({ speaker: 'patient', text })
const doctor = (text: string): Turn => ({ speaker: 'doctor', text })

describe('what the pre-fill reads', () => {
  it('fills what the transcript plainly established, with the whole sentence as evidence', () => {
    const score = prefillSoreThroatScore(
      transcript([
        patient('Sore throat for three days, no cough, doctor.'),
        doctor(
          'Your temperature is 38.4. There is exudate on the tonsils. The neck nodes are swollen and tender.',
        ),
      ]),
    )
    const byId = Object.fromEntries(score.items.map((item) => [item.id, item.suggestion]))

    expect(byId.cough).toEqual({
      optionId: 'absent',
      evidence: 'Sore throat for three days, no cough, doctor.',
    })
    expect(byId.temperature).toEqual({ optionId: 'yes', evidence: 'Your temperature is 38.4.' })
    expect(byId.tonsils?.optionId).toBe('yes')
    expect(byId['neck-nodes']?.optionId).toBe('yes')
    expect(byId.age).toBeNull()
  })

  it('reads a reported cough, including after a denied symptom', () => {
    expect(filled(patient('I have a cough and a sore throat.')).cough).toBe('present')
    expect(filled(patient('No fever, coughing a lot.')).cough).toBe('present')
    expect(filled(patient('No runny nose, cough yes.')).cough).toBe('present')
  })

  it('reads a cough denied directly, in English and Malay', () => {
    expect(filled(patient('No fever or cough.')).cough).toBe('absent')
    expect(filled(doctor('Patient denies cough.')).cough).toBe('absent')
    expect(filled(patient('Tak batuk, doktor, cuma sakit tekak.')).cough).toBe('absent')
    expect(filled(patient('Batuk tak ada.')).cough).toBe('absent')
  })

  it('reads a temperature at or under 38 as not above it', () => {
    expect(filled(doctor('Temperature 37.2.')).temperature).toBe('no')
    expect(filled(doctor('Suhu 38.9.')).temperature).toBe('yes')
    expect(filled(doctor('Temperature 38.0 degrees.')).temperature).toBe('no')
  })
})

describe('what the pre-fill leaves empty', () => {
  it.each([
    ['a question, answered or not', [doctor('Any cough?'), patient('No.')], 'cough'],
    ['a Malay question', [doctor('Ada batuk?'), patient('Takde.')], 'cough'],
    ['someone else', [patient('My son has a cough.')], 'cough'],
    ['another time', [patient('I had a cough last month.')], 'cough'],
    ['a product', [patient('I bought cough syrup.')], 'cough'],
    ['a resolved symptom', [patient('The cough has gone.')], 'cough'],
    ['safety-net advice', [doctor('Come back if you develop a cough.')], 'cough'],
    ['a contradiction', [patient('No cough.'), patient('Actually I cough at night.')], 'cough'],
  ])('%s', (_case, turns, itemId) => {
    expect(filled(...turns)[itemId]).toBeNull()
  })

  it.each([
    'No fever, cough or runny nose.',
    'Denies fever, cough or cold.',
    'Tiada demam, batuk, selesema.',
    'Takde demam, batuk.',
    'No cough at night, only during the day.',
    'No cough until yesterday.',
    'Not coughing as much now.',
    'Tak batuk sangat.',
    'No coughing fits.',
    'Initially no cough, it started yesterday.',
    'My housemate has a cough.',
    'Everyone at the office is coughing.',
    'I had a cough last week.',
    'Saya batuk bulan lepas.',
    'My cough went away.',
  ])('leaves cough empty for "%s"', (text) => {
    expect(filled(patient(text)).cough).toBeNull()
  })

  it.each([
    [doctor('Ada batuk'), patient('Takde.')],
    [doctor('Got cough'), patient('No.')],
    [doctor('You have cough'), patient('No.')],
  ])('reads an unpunctuated question as a question: "%s"', (question, answer) => {
    expect(filled(question, answer).cough).toBeNull()
  })

  it.each([
    'Temperature normal, pulse 40.',
    'Temp ok, aged 41.',
    'Temperature normal, patient 42 years old.',
    'Take two tablets when your temp hits 39.',
    'Did not check temperature, felt like 39.',
    'I have had a temperature for the last 36 hours.',
  ])('reads no temperature from "%s"', (text) => {
    expect(filled(patient(text)).temperature).toBeNull()
  })

  it.each([
    [[doctor('Cough or fever'), patient('Neither.')], 'cough'],
    [[doctor('Cough'), patient('Not really.')], 'cough'],
    [[doctor('Got cough'), patient("I don't have.")], 'cough'],
    [[doctor('Let me look for exudate.')], 'tonsils'],
    [[doctor("I'm going to check your tonsils for pus.")], 'tonsils'],
    [[doctor('Cough is common with viral infections.')], 'cough'],
    [[patient('I had my whooping cough vaccine.')], 'cough'],
    [[doctor('Tender swollen nodes in the groin.')], 'neck-nodes'],
    [[doctor('Tender swollen nodes, posterior chain.')], 'neck-nodes'],
  ])('offers nothing for %j', (turns, itemId) => {
    expect(filled(...turns)[itemId]).toBeNull()
  })

  it('leaves a low reading empty when a fever was reported', () => {
    expect(
      filled(patient('I had a high fever last night.'), doctor('Temperature today 37.2.'))
        .temperature,
    ).toBeNull()
  })

  it('reads posterior nodes as not the criterion, and "-ve" as a denial', () => {
    expect(filled(doctor('Tender swollen posterior cervical nodes.'))['neck-nodes']).toBeNull()
    expect(filled(doctor('Tonsils: exudates -ve.')).tonsils).toBe('no')
  })

  it.each([
    'Nodes are not tender.',
    'Glands swollen but not tender.',
    'Lymph nodes non-tender.',
    'Tender in the neck, no swelling.',
    'Swollen lymph nodes in the neck.',
  ])('does not read "%s" as swollen and tender nodes', (text) => {
    expect(filled(doctor(text))['neck-nodes']).not.toBe('yes')
  })

  it('reads a node denial as not met', () => {
    expect(filled(doctor('No cervical lymphadenopathy.'))['neck-nodes']).toBe('no')
    expect(filled(doctor('Nodes are not tender.'))['neck-nodes']).toBe('no')
  })

  it.each(['Exudate absent.', 'Exudate not seen.', 'No exudate on the tonsils.'])(
    'reads "%s" as no exudate',
    (text) => {
      expect(filled(doctor(text)).tonsils).toBe('no')
    },
  )

  it('does not read mild swelling as severe', () => {
    expect(filled(doctor('The tonsils are swollen and red.')).tonsils).toBeNull()
    expect(filled(doctor('Tonsils very swollen and red.')).tonsils).toBeNull()
  })

  it('does not read an exception as a denial', () => {
    expect(filled(patient('No pain except glands.'))['neck-nodes']).toBeNull()
  })

  it.each([
    'Come back if your temperature goes above 39.',
    'Has your temperature been above 38.5?',
    'My son had a temperature of 39.',
    'Temperature for 3 days.',
    'Fever of 2 days.',
    'Keep the temperature under 38.',
    'Temperature was 39 last year.',
  ])('reads no temperature from "%s"', (text) => {
    expect(filled(patient(text)).temperature).toBeNull()
  })

  it('never fills the age band', () => {
    expect(filled(patient('I am 50 years old with a sore throat.')).age).toBeNull()
  })

  it('leaves everything empty when nothing was said', () => {
    expect(Object.values(filled(patient('My throat hurts.'))).every((v) => v === null)).toBe(true)
  })
})

describe('the score itself', () => {
  const score = prefillSoreThroatScore(transcript([]))

  it('cites NAG 2024 alone and carries its version', () => {
    expect(score.guidelineIds).toEqual([documentRef('moh-nag-2024')])
    expect(score.version).toBe(SORE_THROAT_SCORE_VERSION.id)
  })

  it('scores as the source tabulates it: a point per criterion met, one off at 45', () => {
    const points = Object.fromEntries(
      score.items.map((item) => [item.id, item.options.map((option) => option.points)]),
    )
    expect(points).toEqual({
      cough: [1, 0],
      'neck-nodes': [1, 0],
      temperature: [1, 0],
      tonsils: [1, 0],
      age: [0, -1],
    })
  })
})

describe('when the score is offered', () => {
  const offered = (...turns: Turn[]) => scoresFor(transcript(turns), 'adult-acute-urti').length > 0

  it('offers it where a sore throat was reported, in English or Malay', () => {
    expect(offered(patient('I have had a sore throat since Monday.'))).toBe(true)
    expect(offered(patient('Sakit tekak dah tiga hari.'))).toBe(true)
    expect(offered(patient('Batuk sudah 3 hari lah, and my throat also quite sakit.'))).toBe(true)
    expect(offered(patient('Throat also a bit sakit lah.'))).toBe(true)
    // As Soniox wrote it in the prod e2e run, 08/10.
    expect(
      offered(patient('My throat\u2014very sakitlah, already 3 days, very painful to swallow.')),
    ).toBe(true)
    expect(offered(patient('Tekak saya sakit sejak semalam.'))).toBe(true)
    expect(offered(patient('Very painful to swallow since Monday.'))).toBe(true)
    expect(offered(patient('Sakit nak telan, doktor.'))).toBe(true)
    expect(offered(patient('Sore throat, but no fever.'))).toBe(true)
    expect(offered(patient('throat is sore since monday no fever no cough'))).toBe(true)
    expect(offered(patient('I have a sore throat.'), doctor('No exudate but tender nodes.'))).toBe(
      true,
    )
  })

  it.each([
    ['denied', [patient('No sore throat, just a runny nose.')]],
    ['never mentioned', [patient('Just a runny nose.')]],
    ['asked about', [doctor('Any sore throat?'), patient('No.')]],
    ['someone else', [patient('My wife has a sore throat.')]],
    ['no throat pain', [patient('No throat pain.')]],
    ['not painful to swallow', [patient('Not painful to swallow.')]],
    ['tekak tak sakit', [patient('Tekak tak sakit.')]],
  ])('does not offer it when the sore throat was %s', (_case, turns) => {
    expect(offered(...turns)).toBe(false)
  })

  it('does not offer it outside the respiratory profile', () => {
    expect(
      scoresFor(
        transcript([patient('Burning when I pass urine, and a sore throat.')]),
        'adult-acute-uncomplicated-uti',
      ),
    ).toEqual([])
  })
})
