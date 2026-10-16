/**
 * Identifiers as batch `scribe_v2` actually wrote them (#435, `docs/trd.md` §9,
 * "Spoken Digit Runs").
 *
 * Measured 15/10/26. The synthetic line "Nombor kad pengenalan saya
 * 900412086543." from fixture `urti-malay-red-flag` was read by two TTS voices
 * and transcribed 32 times. It never came back as digits. These are the 28
 * distinct readings that followed the cue, verbatim and in the order measured.
 * Each one ended the sentence with a full stop, which `spokenIcSentence` puts
 * back.
 *
 * Not part of `FIXTURES`: these are single lines, not consultations, and every
 * one of them carries the same synthetic number.
 */
export const SPOKEN_IC_CUE = 'Nombor kad pengenalan saya'

/** The synthetic MyKad number every reading below was produced from. */
export const SPOKEN_IC_DIGITS = '900412086543'

export const SPOKEN_IC_READINGS: readonly string[] = [
  'sembilan zero empat tujuh dua dua sama enam sembilan empat tiga',
  'sembilan zero empat two dua dua sama enam sembilan empat tiga',
  'sembilan zero empat two dua dua zero sama enam sembilan empat tiga',
  'sembilan zero empat two dua dua zero semak enam semak empat tiga',
  'sembilan zero one empat two dua dua zero semak six semak empat tiga',
  'sembilan dua zero four sepuluh three, biola sangkas minum part tiga',
  'sembilan dua sembilan empat tiga',
  'sembilan dua sepuluh empat tiga',
  'sembilan dua sepuluh sepuluh sepuluh',
  'sembilan dua sepuluh sepuluh empat tiga',
  'sembilan dua sepuluh sepuluh tiga, A lalu S lalu kas minum empat tiga',
  'sembilan dua sepuluh sepuluh tiga, bia husan kas minum part tiga',
  'sembilan dua sepuluh sepuluh tiga, biawak sangkar enam empat tiga',
  'sembilan dua sepuluh sepuluh padu biawak sangkar minum part tiga',
  'sembilan seruwam empat tuduwa wa sama nam se mam pat tiga',
  'sembilan seruwam empat tuduwa wasama namse mampat tiga',
  'sembilan seruwam empat tuduwawa sama namse mampat tiga',
  'sembilan seruam empat tuduwawa sama namse mampat tiga',
  'sembilan seruam empat tudua wa sama namse mampat tiga',
  'sembilan seruam pat tu dua wa sama nan se mempat tiga',
  'sembilan seruam pat tu du wawa sama nan se mempat tiga',
  'sembilan seruang empat tudu wawa sama nan se mampat tiga',
  'sembionywarz borspadre bialusangkas minum part tiga',
  'sembionywarzborzpardre bialusangkas minum part tiga',
  'sembionyuarzborzpardre bialusangkas minum part tiga',
  'Semyonwarezborespardre Bialusangkas minum part tiga',
  'Semyonwarezborespardre Bialusangkas minam part tiga',
  'Semyonuarzborzpardre Byalusakas minum part tiga',
]

/** A reading as the whole transcribed sentence. */
export const spokenIcSentence = (reading: string) => `${SPOKEN_IC_CUE} ${reading}.`
