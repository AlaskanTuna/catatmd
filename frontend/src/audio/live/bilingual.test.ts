import { describe, expect, it } from 'vitest'
import {
  bilingualDelivery,
  bilingualDisplay,
  bilingualLiveSegments,
  interimLanguage,
  tokensToBilingualTurns,
  untranslatedTurnText,
} from './bilingual.js'
import type { LiveToken } from './live-tokens.js'
import {
  BENGALI_DIALOGUE,
  type CapturedToken,
  URDU_DIALOGUE,
} from './translated-dialogues.fixture.js'

/** The same mapping `soniox-stream.ts` applies to the wire, over a capture. */
const toLive = ([text, startMs, endMs, status, language, source]: CapturedToken): LiveToken => {
  const endpoint = /^<[a-z]+>$/.test(text)
  return {
    text: endpoint ? '' : text,
    startMs: startMs ?? 0,
    endMs: endMs ?? startMs ?? 0,
    isFinal: true,
    speaker: null,
    language,
    confidence: null,
    endpoint,
    ...(status === 't' ? { translated: true, sourceLanguage: source } : {}),
  }
}

const bengali = BENGALI_DIALOGUE.map(toLive)
const urdu = URDU_DIALOGUE.map(toLive)

let clock = 0
/** A hand-built original token, spoken for 300 ms. */
const said = (text: string, language: string): LiveToken => {
  clock += 400
  return {
    text,
    startMs: clock,
    endMs: clock + 300,
    isFinal: true,
    speaker: null,
    language,
    confidence: null,
    endpoint: false,
  }
}
/** A hand-built translation token, which carries no timing on the wire. */
const translatedAs = (text: string, language: string, sourceLanguage: string): LiveToken => ({
  text,
  startMs: 0,
  endMs: 0,
  isFinal: true,
  speaker: null,
  language,
  confidence: null,
  endpoint: false,
  translated: true,
  sourceLanguage,
})
const end: LiveToken = {
  text: '',
  startMs: 0,
  endMs: 0,
  isFinal: true,
  speaker: null,
  language: null,
  confidence: null,
  endpoint: true,
}

/** Bengali, Arabic and Devanagari: the scripts no detector reads. */
const UNREADABLE = /[ঀ-৿؀-ۿऀ-ॿ]/u

describe('the #389 Bengali capture', () => {
  const turns = tokensToBilingualTurns(bengali)
  const delivery = bilingualDelivery(turns, 'bn')

  it('becomes the English conversation the red-flag suite pins, in order', () => {
    expect(delivery.draftTurns).toEqual([
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
  })

  it('keeps the other half of every translated turn beside it', () => {
    expect(delivery.others[2]).toEqual({
      language: 'bn',
      text: 'আপনি কি গিলতে পারছেন?',
      spoken: false,
    })
    expect(delivery.others[3]).toEqual({ language: 'bn', text: 'না।', spoken: true })
    // Malay is left untranslated by the recogniser, so it has no other half.
    expect(delivery.others[13]).toBeNull()
    expect(delivery.others[14]).toBeNull()
  })

  it('carries no script the gate cannot read into any English it stores', () => {
    expect(delivery.text).not.toMatch(UNREADABLE)
    for (const segment of delivery.segments) expect(segment.text).not.toMatch(UNREADABLE)
    for (const turn of delivery.draftTurns) expect(turn.text).not.toMatch(UNREADABLE)
  })

  it('gives the capture panel segments it can label one to one', () => {
    expect(delivery.untranslated).toBe(0)
    expect(delivery.text).toBe(delivery.segments.map((segment) => segment.text).join(' '))
    expect(delivery.segments.map((segment) => segment.text)).toEqual(
      delivery.draftTurns.map((turn) => turn.text),
    )
    for (const [index, segment] of delivery.segments.entries()) {
      expect(segment.start).toBeGreaterThanOrEqual(delivery.segments[index - 1]?.start ?? 0)
    }
  })
})

describe('the #389 Urdu capture', () => {
  const delivery = bilingualDelivery(tokensToBilingualTurns(urdu), 'ur')

  it('pairs the one-word denial with the question before it', () => {
    const ask = delivery.draftTurns.findIndex((turn) => turn.text === 'Can you swallow?')
    expect(delivery.draftTurns[ask + 1]).toEqual({ speaker: 'patient', text: 'No.' })
    expect(delivery.others[ask + 1]).toEqual({ language: 'ur', text: 'نہیں۔', spoken: true })
  })

  it('stores English only, with every Urdu turn translated', () => {
    expect(delivery.untranslated).toBe(0)
    expect(delivery.text).not.toMatch(UNREADABLE)
    expect(delivery.draftTurns.map((turn) => turn.text)).toContain('My name is Imran Shah.')
  })
})

describe('the live panes read only what will not change', () => {
  it.each([
    ['Bengali', bengali, 'bn'],
    ['Urdu', urdu, 'ur'],
  ] as const)(
    '%s: every released prefix is a prefix of the finished stream',
    (_name, stream, pair) => {
      const finished = bilingualLiveSegments(tokensToBilingualTurns(stream), pair)
      for (let cut = 0; cut <= stream.length; cut += 1) {
        // The panes hold the last segment back themselves (`closedSegments`).
        const released = bilingualLiveSegments(
          tokensToBilingualTurns(stream.slice(0, cut)),
          pair,
        ).slice(0, -1)
        expect(released, `after token ${cut}`).toEqual(finished.slice(0, released.length))
      }
    },
  )

  it('sends the panes English only, with the drafted role', () => {
    const segments = bilingualLiveSegments(tokensToBilingualTurns(bengali), 'bn')
    for (const segment of segments) expect(segment.text).not.toMatch(UNREADABLE)
    expect(segments[3]).toMatchObject({ text: 'No.', role: 'patient' })
    expect(segments[2]).toMatchObject({ text: 'Can you swallow?', role: 'doctor' })
  })
})

describe('pairing when the stream breaks the lockstep #389 measured', () => {
  it('gives a late translation to the oldest turn still waiting, never the latest', () => {
    const turns = tokensToBilingualTurns([
      said(' Can you swallow?', 'en'),
      translatedAs(' আপনি কি গিলতে পারছেন?', 'bn', 'en'),
      end,
      said(' না।', 'bn'),
      end,
      said(' Any fever?', 'en'),
      translatedAs(' জ্বর আছে?', 'bn', 'en'),
      end,
      said(' হ্যাঁ।', 'bn'),
      end,
      // Both translations arrive late, in order.
      translatedAs(' No.', 'en', 'bn'),
      translatedAs(' Yes.', 'en', 'bn'),
    ])

    expect(bilingualDelivery(turns, 'bn').draftTurns).toEqual([
      { speaker: 'doctor', text: 'Can you swallow?' },
      { speaker: 'patient', text: 'No.' },
      { speaker: 'doctor', text: 'Any fever?' },
      { speaker: 'patient', text: 'Yes.' },
    ])
  })

  it('marks a turn whose translation never came, and keeps what was said', () => {
    const delivery = bilingualDelivery(
      tokensToBilingualTurns([said(' Can you swallow?', 'en'), end, said(' না।', 'bn'), end]),
      'bn',
    )

    expect(delivery.draftTurns[1]).toEqual({ speaker: 'patient', text: untranslatedTurnText('bn') })
    expect(delivery.others[1]).toEqual({ language: 'bn', text: 'না।', spoken: true })
    expect(delivery.untranslated).toBe(1)
  })

  it('turns an orphan English translation into a patient turn, never a doctor one', () => {
    const delivery = bilingualDelivery(
      tokensToBilingualTurns([translatedAs(' My chest hurts.', 'en', 'bn')]),
      'bn',
    )
    expect(delivery.draftTurns).toEqual([{ speaker: 'patient', text: 'My chest hurts.' }])
  })
})

describe('utterance boundaries', () => {
  it('keeps a code-switched chunk as one utterance', () => {
    const turns = tokensToBilingualTurns([
      said(' আমার chest pain আছে,', 'bn'),
      translatedAs(' I have chest pain,', 'en', 'bn'),
      end,
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      spoken: 'আমার chest pain আছে,',
      translation: 'I have chest pain,',
    })
  })

  it('closes an utterance when a reply starts in the other language with no pause', () => {
    const turns = tokensToBilingualTurns([
      said(' না।', 'bn'),
      translatedAs(' No.', 'en', 'bn'),
      said(' Any fever?', 'en'),
      translatedAs(' জ্বর আছে?', 'bn', 'en'),
    ])
    expect(turns.map((turn) => [turn.language, turn.closed])).toEqual([
      ['bn', true],
      ['en', false],
    ])
  })

  it('keeps Malay as spoken, because the engine reads it and nothing translated it', () => {
    const delivery = bilingualDelivery(
      tokensToBilingualTurns([said(' Tak', 'ms'), said(' ada', 'ms'), said(' doktor.', 'ms'), end]),
      'bn',
    )
    expect(delivery.draftTurns).toEqual([{ speaker: 'patient', text: 'Tak ada doktor.' }])
    expect(delivery.others).toEqual([null])
  })
})

describe('the script guard', () => {
  it('replaces unreadable script inside an English translation', () => {
    const delivery = bilingualDelivery(
      tokensToBilingualTurns([
        said(' আমার নাম রহিম।', 'bn'),
        translatedAs(' My name is রহিম.', 'en', 'bn'),
        end,
      ]),
      'bn',
    )
    expect(delivery.draftTurns[0]?.text).toBe('My name is [untranslated].')
    expect(delivery.text).not.toMatch(UNREADABLE)
  })

  it('treats a turn heard in another script as the patient language, never as English', () => {
    // Urdu heard as Hindi would arrive in Devanagari, untranslated.
    const delivery = bilingualDelivery(
      tokensToBilingualTurns([said(' मुझे बुखार है।', 'hi'), end]),
      'ur',
    )
    expect(delivery.draftTurns).toEqual([{ speaker: 'patient', text: untranslatedTurnText('ur') }])
    expect(delivery.untranslated).toBe(1)
  })
})

describe('what the live pane shows', () => {
  it('lays each utterance out by language, with its translation beneath', () => {
    const shown = bilingualDisplay(tokensToBilingualTurns(bengali))
    expect(shown[3]).toMatchObject({
      text: 'না।',
      language: 'bn',
      speaker: 'bn',
      translation: 'No.',
      translationLanguage: 'en',
    })
    expect(shown[2]).toMatchObject({
      text: 'Can you swallow?',
      language: 'en',
      translationLanguage: 'bn',
    })
  })

  it('places the unsettled tail by the language it is in', () => {
    expect(interimLanguage([said(' না', 'bn'), translatedAs(' No', 'en', 'bn')])).toBe('bn')
    expect(interimLanguage([])).toBeNull()
  })
})
