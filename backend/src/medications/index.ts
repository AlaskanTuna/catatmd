export type { MedicationEntry } from './lexicon.js'
export { lexiconFor, MEDICATION_LEXICON, MEDICATION_LEXICON_VERSION } from './lexicon.js'
export type { MedicationCandidate, Normalised } from './match.js'
export { matchMedication, normalise } from './match.js'
export type { Sig } from './sig.js'
export { parseSig } from './sig.js'
export type { Similarity } from './similarity.js'
export {
  admits,
  ORTHOGRAPHIC_BAR,
  orthographicSimilarity,
  PHONETIC_BAR,
  phoneticSimilarity,
  similarity,
} from './similarity.js'
export type { SigFoodTiming, SigFrequency, SigRoute } from './vocabulary.js'
export { SIG_FOOD_TIMINGS, SIG_FREQUENCIES, SIG_ROUTES } from './vocabulary.js'
