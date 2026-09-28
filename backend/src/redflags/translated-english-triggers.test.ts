import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

/**
 * Two-way machine translation of Bengali and Urdu speech, measured 28/09/26 on
 * synthetic audio (#389). One sentence per trigger was spoken in each
 * language and translated to English by the recogniser, and this engine
 * raised 7 of 12 in both. Every translation was semantically right: the five
 * misses were plain English phrasings no pattern covered, which a native
 * speaker also uses. The sentences below are the translations verbatim,
 * grammar included, because that is the English this engine will actually
 * read on the translated path.
 *
 * Both directions are pinned, as in `malaysian-english-triggers.test.ts`: each
 * new form fires, and each stays silent on a denial.
 */

const translated = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'asr_live',
  // As the translated path submits it: roles drafted from the spoken
  // language, which nobody has reviewed.
  labelsReviewed: false,
  turns,
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, ALL_REDFLAG_TRIGGERS)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

const patient = (text: string): Transcript => translated([{ speaker: 'patient', text }])

describe('the five #389 misses now fire, in the words each language produced', () => {
  it.each([
    ['haemoptysis', 'bn', 'Blood is coming along with the cough.'],
    ['haemoptysis', 'ur', 'Is you having blood coming with cough?'],
    [
      'stridor-airway-compromise',
      'bn',
      'When I breathe, it sounds like a whistle, and saliva comes out of my mouth.',
    ],
    [
      'stridor-airway-compromise',
      'ur',
      'When I breathe, I hear a whistling sound, and saliva is dripping from my mouth.',
    ],
    ['uti-systemic-features', 'bn', 'I feel cold, and my body is shaking.'],
    ['uti-systemic-features', 'ur', "I'm feeling cold, and my body is shaking."],
    ['uti-systemic-deterioration', 'bn', 'I felt dizzy and passed out.'],
    ['uti-systemic-deterioration', 'ur', 'I felt dizzy, and I passed out.'],
    ['uti-unable-to-pass-urine', 'bn', "I haven't been able to urinate since morning."],
    ['uti-unable-to-pass-urine', 'ur', "I haven't been able to urinate since morning."],
  ])('%s fires on the %s translation "%s"', (trigger, _language, text) => {
    expect(ruleIds(patient(text))).toContain(trigger)
  })
})

describe('the seven #389 hits still fire', () => {
  it.each([
    ['significant-dyspnoea', "I'm having a lot of trouble breathing."],
    ['chest-pain', 'I have chest pain.'],
    ['chest-pain', 'I have pain in my chest.'],
    ['swallowing-oral-intake', "I can't swallow anything, not even water."],
    [
      'vital-signs-concern',
      "The fever is very high, and it isn't going down even after taking medicine.",
    ],
    ['uti-flank-or-back-pain', 'I have pain in my lower back and my lower ribs.'],
    ['uti-flank-or-back-pain', 'I have pain in my lower back and sides.'],
    ['uti-pregnancy-mentioned', "I think I'm pregnant."],
    ['uti-potentially-complicating-context', 'I have diabetes.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(patient(text))).toContain(trigger)
  })
})

describe('the contracted negator reaches the swallowing trigger too', () => {
  it.each([
    "I haven't been able to swallow since yesterday.",
    "I haven't been able to eat or drink.",
    "He wasn't able to drink anything today.",
    'I have not been able to swallow anything.',
  ])('fires on "%s"', (text) => {
    expect(ruleIds(patient(text))).toContain('swallowing-oral-intake')
  })
})

/*
 * The shape that silenced these in review: a patient answering a negatively
 * framed question opens with "No", and a span that starts after the negator
 * let `isNegated` read that "No" as a denial of the inability itself. Each of
 * these is the commonest answer to "Are you passing urine?" or "Can you eat?",
 * and two of the triggers are emergency severity.
 */
describe('a leading "No" never silences an inability the reply asserts', () => {
  it.each([
    ['uti-unable-to-pass-urine', "No, I haven't been able to urinate since morning."],
    ['uti-unable-to-pass-urine', "Not really, I haven't been able to pee."],
    ['uti-unable-to-pass-urine', 'No, I have not been able to pass urine.'],
    ['swallowing-oral-intake', "No, I haven't been able to swallow."],
    ['swallowing-oral-intake', "No, I wasn't able to drink anything."],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(patient(text))).toContain(trigger)
  })
})

describe('the review found three more plain-English forms', () => {
  it.each([
    ['uti-systemic-deterioration', 'I pass out when I stand up.'],
    ['uti-systemic-features', 'My body shook all night.'],
    ['haemoptysis', 'Blood comes out when I cough.'],
  ])('%s fires on "%s"', (trigger, text) => {
    expect(ruleIds(patient(text))).toContain(trigger)
  })

  it('raises the urine trigger on an ability question answered with a bare denial', () => {
    const exchange = translated([
      { speaker: 'doctor', text: 'Have you been able to pass urine today?' },
      { speaker: 'patient', text: 'No.' },
    ])
    expect(ruleIds(exchange)).toContain('uti-unable-to-pass-urine')
  })
})

describe('each new form stays silent on a denial it matches', () => {
  it.each([
    ['haemoptysis', 'No blood comes with the cough, just phlegm.'],
    ['haemoptysis', 'No blood comes up in the cough, just phlegm.'],
    ['stridor-airway-compromise', 'No saliva comes out of my mouth.'],
    ['uti-systemic-features', 'There is no body shaking.'],
    ['uti-systemic-deterioration', 'I never passed out.'],
  ])('%s stays silent on "%s"', (trigger, text) => {
    expect(ruleIds(patient(text))).not.toContain(trigger)
  })
})

/*
 * Neighbours the new patterns must not reach. None of these matches a new
 * pattern today, which is the point: a later widening that did would fail
 * here rather than start raising flags on ordinary answers.
 */
describe('the new patterns stay narrow', () => {
  it.each([
    ['uti-systemic-features', 'I have a cold.'],
    ['uti-systemic-features', 'My hands shake when I am nervous.'],
    ['uti-unable-to-pass-urine', 'I have been able to pass urine normally.'],
    ['swallowing-oral-intake', 'I have been able to eat and drink.'],
  ])('%s stays silent on "%s"', (trigger, text) => {
    expect(ruleIds(patient(text))).not.toContain(trigger)
  })
})

/*
 * The whole translated consultation from #389, in the English the translated
 * path stores: doctor turns as spoken, patient turns as translated, Malay kept
 * verbatim. The swallowing flag here comes from a question and a one-word
 * denial in adjacent turns, which is only possible because each translation
 * stayed on the turn it translated.
 */
describe('the #389 dialogues raise exactly the expected flags', () => {
  const bengali = translated([
    { speaker: 'doctor', text: 'Good morning. What brings you in today?' },
    { speaker: 'patient', text: "Doctor, I've had a fever and a cough for 3 days." },
    { speaker: 'doctor', text: 'Can you swallow?' },
    { speaker: 'patient', text: 'No.' },
    { speaker: 'doctor', text: 'Any fever at night?' },
    { speaker: 'patient', text: 'Yes, I get a lot of fever at night, and my body shakes.' },
    { speaker: 'doctor', text: 'Any chest pain?' },
    { speaker: 'patient', text: 'Yes, my chest hurts.' },
    { speaker: 'doctor', text: 'Okay.' },
    { speaker: 'patient', text: "And it's very hard to breathe." },
    { speaker: 'doctor', text: 'What does your cough bring up?' },
    { speaker: 'patient', text: 'No blood comes with the cough, just phlegm.' },
    { speaker: 'patient', text: "I have chest pain, and I'm having breathing problems." },
    { speaker: 'patient', text: 'Ada muntah?' },
    { speaker: 'patient', text: 'Tak ada, doktor.' },
    { speaker: 'doctor', text: 'What is your name, please?' },
    { speaker: 'patient', text: 'My name is Rahim Uddin.' },
    { speaker: 'doctor', text: 'Thank you.' },
    { speaker: 'doctor', text: 'I will examine you now.' },
  ])

  const urdu = translated([
    { speaker: 'doctor', text: 'Good morning. What brings you in today?' },
    { speaker: 'patient', text: "Doctor, for 3 days I've had a fever and a cough." },
    { speaker: 'doctor', text: 'Can you swallow?' },
    { speaker: 'patient', text: 'No.' },
    { speaker: 'doctor', text: 'Any fever at night?' },
    { speaker: 'patient', text: 'Yes, I get a high fever at night and my body trembles.' },
    { speaker: 'doctor', text: 'Any chest pain?' },
    { speaker: 'patient', text: 'Yes, I have chest pain.' },
    { speaker: 'doctor', text: 'Okay.' },
    { speaker: 'patient', text: 'And I have a lot of trouble breathing.' },
    { speaker: 'doctor', text: 'What does your cough bring up?' },
    { speaker: 'patient', text: 'No blood comes up in the cough, just phlegm.' },
    { speaker: 'patient', text: 'I have chest pain and I have problems breathing.' },
    { speaker: 'patient', text: 'Ada muntah?' },
    { speaker: 'patient', text: 'Tak ada, doktor.' },
    { speaker: 'doctor', text: 'What is your name, please?' },
    { speaker: 'patient', text: 'My name is Imran Shah.' },
    { speaker: 'doctor', text: 'Thank you. I will examine you now.' },
  ])

  const expected = [
    'chest-pain',
    'significant-dyspnoea',
    'swallowing-oral-intake',
    'uti-systemic-features',
  ]

  it.each([
    ['Bengali', bengali],
    ['Urdu', urdu],
  ])('%s', (_language, transcript) => {
    expect(ruleIds(transcript)).toEqual(expected)
  })
})
