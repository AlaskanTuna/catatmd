/**
 * Synthetic consultation lines in the languages Auto-detect ambient capture
 * hints beyond English and Malay, plus Cantonese, which it does not (#218).
 * The same lines were read by synthetic voices to measure recognition on the
 * production config (`docs/trd.md` §20.10, "Measured 07/10/26").
 *
 * The fuller code-switched consultations belong to `corpus.ts` (#249). These
 * are monolingual on purpose: they pin what the gate does with native script.
 */
export interface LanguageSample {
  language: 'zh' | 'ta' | 'yue'
  /** Clinical speech with no identifier in it. */
  lines: string[]
  /** A self-introduction carrying a synthetic name in native script. */
  introduction: { text: string; name: string }
}

export const LANGUAGE_SAMPLES: LanguageSample[] = [
  {
    language: 'zh',
    lines: [
      '医生你好，我咳嗽三天了。',
      '有没有发烧？',
      '有，晚上会发烧。',
      '喉咙痛吗？',
      '有一点痛，呼吸没有问题。',
      '这个药一天吃三次，饭后吃。',
    ],
    introduction: { text: '我叫陈美玲，今年四十岁。', name: '陈美玲' },
  },
  {
    language: 'ta',
    lines: [
      'வணக்கம் டாக்டர். எனக்கு மூன்று நாட்களாக இருமல் இருக்கிறது.',
      'காய்ச்சல் இருக்கிறதா?',
      'ஆமாம், இரவில் காய்ச்சல் வருகிறது.',
      'தொண்டை வலிக்கிறதா?',
      'கொஞ்சம் வலிக்கிறது. மூச்சு விடுவதில் சிரமம் இல்லை.',
      'இந்த மருந்தை ஒரு நாளைக்கு மூன்று முறை சாப்பிடுங்கள்.',
    ],
    introduction: { text: 'என் பெயர் கலைச்செல்வி.', name: 'கலைச்செல்வி' },
  },
  {
    language: 'yue',
    lines: [
      '醫生你好，我咳咗三日喇。',
      '有冇發燒呀？',
      '有，夜晚會發燒。',
      '喉嚨痛唔痛？',
      '有少少痛，呼吸冇問題。',
      '呢隻藥一日食三次，食完飯先食。',
    ],
    introduction: { text: '我叫黃家欣。', name: '黃家欣' },
  },
]
