import type { ClinicalArtefactVersion } from '../../clinical-versions/types.js'
/*
 * Reached directly, never through the `medications/index.js` barrel. The barrel
 * re-exports `matchMedication`, which pulls `double-metaphone` in with it, and
 * this module is loaded by the adapter that mints an audio-egress credential.
 * Keeping a phonetic-matching dependency out of that import graph costs one
 * extra import line and is worth it.
 */
import { MEDICATION_LEXICON } from '../../medications/lexicon.js'
import {
  COUNTABLE_UNITS,
  DOSE_UNIT,
  DURATION_UNITS,
  FREQUENCY_ABBREVIATIONS,
} from '../../medications/vocabulary.js'
import { CONFUSABLE_TARGETS } from '../../redflags/mishears.js'

/**
 * The clinical vocabularies live capture primes the recogniser with, and the
 * first of the three accuracy layers docs/trd.md §20.7 describes.
 *
 * Two of them, one per mode: the consultation register ambient capture sends,
 * and the prescription register dictation sends (issue #356). Everything below
 * about how priming works applies to both; what differs is the domain, and
 * `dictationContextTerms` says why sharing one list would be worse than two.
 *
 * **This is the layer with the measurement behind it.** §20.7.1 ran the same
 * Malay clip through five context conditions. With none it returned "Dr.
 * Sayyabah Taksudali Maharaj, D. Mampun ada, Tekak Saki Tsangat"; with a
 * clinical Malay vocabulary *containing none of the sentence's content words*
 * it returned one word wrong. The effect is domain and language priming rather
 * than keyword injection, which is why what follows is a vocabulary of the
 * register rather than a list of expected answers.
 *
 * **It is also the only layer that can fix some errors at all.** §20.7.1
 * measured "batuk" returning as "betul", the everyday Malay word for
 * "correct". A confusable table cannot claim that pair without raising a cough
 * flag on every sentence agreeing with the doctor, and `mishears.ts` refuses to
 * widen for exactly that reason. Recognition-time biasing is not the cheapest
 * place to fix it; it is the only place the layered design permits.
 *
 * **Static by construction.** These cross the audio egress in the socket's
 * first frame, and audio cannot be de-identified. Nothing here may ever be
 * derived from a consultation, a patient, or any request value:
 * `liveSessionConfig()` takes a closed enum naming which of the two lists to
 * send and can reach nothing else, and `soniox.test.ts` pins that against
 * adversarial arguments.
 */
export const ASR_VOCABULARY_VERSION: ClinicalArtefactVersion = {
  id: 'asr-vocabulary-v2',
  effectiveDate: '2026-09-10',
}

/**
 * Malay consultation register: symptoms, body parts, time and the words a
 * doctor and patient actually exchange about an upper respiratory complaint.
 *
 * Malay because the measurement says so. §20.7.1's fifth condition supplied an
 * English clinical context against the same Malay audio and scored **worse than
 * no context at all**, so this list is not a multilingual superset even though
 * `languageHints` names four languages.
 *
 * Scoped to the clinical scope in AGENTS.md, adult acute cough, sore throat and
 * other upper respiratory symptoms, plus the general consultation register that
 * surrounds it. Widening it beyond that scope is a clinical-content change and
 * takes a version bump.
 */
const MALAY_CLINICAL_TERMS: readonly string[] = [
  // Presenting symptoms
  'selesema',
  'resdung',
  'kahak',
  'berkahak',
  'bersin',
  'hidung berair',
  'hidung tersumbat',
  'sakit tekak',
  'susah menelan',
  'suara garau',
  'sesak nafas',
  'susah bernafas',
  'berdehit',
  'sakit dada',
  'demam panas',
  'menggigil',
  'berpeluh',
  'sakit kepala',
  'sakit badan',
  'sakit sendi',
  'loya',
  'muntah',
  'cirit-birit',
  'lemah badan',
  'letih',
  'hilang selera',
  'kurang minum',
  'batuk berdarah',
  'darah',

  // Body and examination
  'tekak merah',
  'kelenjar',
  'telinga',
  'paru-paru',
  'suhu badan',
  'tekanan darah',
  'nadi',

  // History and context
  'sejak',
  'semalam',
  'berapa hari',
  'seminggu',
  'alahan',
  'alahan ubat',
  'merokok',
  'mengandung',
  'kencing manis',
  'darah tinggi',
  'lelah',

  // Management
  'ubat',
  'ubat batuk',
  'antibiotik',
  'sapu',
  'sedut',
  'rehat',
  'minum air',
  'kumur',
  'klinik',
  'hospital',
  'rujuk',
  'ujian',
  'cuti sakit',
  'surat cuti',
]

/**
 * Drug names, in English, because that is how they are spoken.
 *
 * **This is a domain fact rather than a translation choice.** Malaysian doctors
 * name drugs in English inside otherwise-Malay speech, so the audio contains
 * "amoxicillin", never a Malay rendering of it. A term primed in a language it
 * is not spoken in cannot help the recogniser find it.
 *
 * **It sits in deliberate tension with §20.7.1, and the tension is reasoned
 * rather than measured.** That row scored an English clinical context worse
 * than no context on Malay audio. Three things separate this list from that
 * condition, and none of them is a measurement:
 *
 * 1. These are proper nouns, not English clinical prose. "Amoxicillin" does not
 *    assert that the conversation is in English the way a sentence does.
 * 2. §20.7.1 varied a **system context** on Qwen. Soniox's `terms` is a
 *    separate array the vendor documents for exactly this purpose, so the
 *    mechanism is closer to keyword boosting than to language priming.
 * 3. The Malay list above remains the bulk of the context.
 *
 * The honest status: the Malay half is evidenced, this half is a reasoned bet,
 * and the interaction between them is untested on this provider. §20.10 records
 * that, and dropping this array is a one-line A/B if a measurement disagrees.
 *
 * Generic names with the brand a patient is likelier to say, where the two
 * differ and the brand dominates Malaysian primary care.
 */
const ENGLISH_DRUG_TERMS: readonly string[] = [
  'paracetamol',
  'panadol',
  'ibuprofen',
  'amoxicillin',
  'amoxicillin clavulanate',
  'augmentin',
  'penicillin',
  'erythromycin',
  'azithromycin',
  'cefuroxime',
  'cetirizine',
  'loratadine',
  'chlorpheniramine',
  'piriton',
  'pseudoephedrine',
  'dextromethorphan',
  'guaifenesin',
  'bromhexine',
  'salbutamol',
  'ventolin',
  'prednisolone',
  'benzydamine',
  'difflam',
  'strepsils',
  'lozenges',
  'nasal spray',
  'inhaler',
  'nebulizer',
]

/**
 * Every name the doctor can accept from the spelling aid, derived rather than
 * transcribed (issue #356).
 *
 * **This closes a chain, in the same way the `CONFUSABLE_TARGETS` derivation
 * above it does.** `medications/lexicon.ts` decides which drug names the
 * matcher may offer; a name the recogniser was never primed for is a link
 * missing from that chain rather than a second, independent defence. Written
 * out by hand it would drift the first time an entry was added, which is
 * exactly what `ENGLISH_DRUG_TERMS` had already done: eleven lexicon drugs were
 * unprimed, including every urinary antibacterial.
 *
 * Synonyms are included because the lexicon's contract is that they are
 * *alternative accepted names*, never mishears (D-001), so each is a word a
 * doctor may actually say.
 *
 * **Structurally free of brand names**, because the lexicon is: D-001 puts
 * brands outside its boundary. `vocabulary.test.ts` asserts that as a property
 * of the derived set rather than trusting this sentence.
 */
const LEXICON_DRUG_TERMS: readonly string[] = MEDICATION_LEXICON.flatMap(
  ({ generic, synonyms }) => [generic, ...synonyms],
)

/**
 * `DOSE_UNIT` is a regex alternation rather than a list, so `units?` has to be
 * unfolded into the two words it stands for before it can be primed. Derived
 * here rather than restated, so a unit added to the parser is a unit the
 * recogniser hears.
 */
const DOSE_UNIT_TERMS: readonly string[] = DOSE_UNIT.split('|').flatMap((unit) =>
  unit.endsWith('?') ? [unit.slice(0, -2), unit.slice(0, -1)] : [unit],
)

/**
 * Latin frequency abbreviations the parser can act on. `q` is filtered out with
 * the rest of the `frequency: null` entries: it means "every" and is
 * meaningless without a number, so `parseSig` maps it to nothing and priming it
 * would put a token in the context that no field can come from.
 */
const FREQUENCY_ABBREVIATION_TERMS: readonly string[] = FREQUENCY_ABBREVIATIONS.filter(
  ({ frequency }) => frequency !== null,
).map(({ token }) => token)

/**
 * The Malay sig phrases, which are the one part of the dictation vocabulary
 * that cannot be derived: they live inline in `sig.ts`'s regex sources rather
 * than in a constant, because the rules that read them also carry ordering and
 * span-claiming behaviour that a word list cannot express.
 *
 * **Every entry is a whole phrase `parseSig` acts on, and that is a test rather
 * than an intention** (`vocabulary.test.ts`). A fragment like `kali sehari`
 * would prime a phrase the parser cannot turn into a field, which is the same
 * broken chain `LEXICON_DRUG_TERMS` exists to prevent, one layer along.
 *
 * Two constructions are deliberately absent for that reason. `setiap N jam`
 * matches digits only, so the spoken "setiap enam jam" yields nothing to prime
 * toward. `selama N hari` accepts a spoken numeral, but the slot is open enough
 * that enumerating it would be a list of numbers rather than a vocabulary; the
 * duration units themselves are primed from `DURATION_UNITS`.
 */
export const SIG_DICTATION_TERMS: readonly string[] = [
  // Frequency. The `N kali sehari` slot is enumerated because `parseSig` closes
  // it at four: a fifth value returns null and would fail the chain test.
  'sekali sehari',
  'dua kali sehari',
  'tiga kali sehari',
  'empat kali sehari',
  'bila perlu',
  'waktu malam',

  // Food timing. `lepas makan` is the clipped form doctors actually say and is
  // a separate phrase in `sig.ts`, not a prefix of `selepas makan`.
  'sebelum makan',
  'selepas makan',
  'lepas makan',
  'bersama makanan',

  // Route.
  'secara oral',
  'sapu',
  'sedut',
]

/**
 * The terms sent with one ambient session, as a fresh array.
 *
 * Fresh rather than the module constant, for the reason `liveSessionConfig()`
 * copies `general`: a caller that mutated what it was handed would change what
 * the next consultation sends, and this value crosses the audio egress.
 *
 * `CONFUSABLE_TARGETS` leads because those are the words with a measured
 * failure behind them. The `Set` is what lets the four sources overlap without
 * anyone having to check whether they do, and the overlap is large: half of
 * `ENGLISH_DRUG_TERMS` is a generic the lexicon also names, which is why adding
 * a whole lexicon costs far fewer than its own length.
 *
 * **The result sits exactly on `MAX_ASR_CONTEXT_TERMS` with no headroom left.**
 * `vocabulary.test.ts` asserts the bound, so the next term added to any of the
 * four sources fails the build. Raising that cap is its own reviewed decision,
 * which means displacing a term rather than widening the list.
 */
export function asrContextTerms(): string[] {
  return [
    ...new Set([
      ...CONFUSABLE_TARGETS,
      ...MALAY_CLINICAL_TERMS,
      ...ENGLISH_DRUG_TERMS,
      ...LEXICON_DRUG_TERMS,
    ]),
  ]
}

/**
 * The terms sent with one dictation session, as a fresh array, for the same
 * mutation reason as above.
 *
 * **A different domain, not a subset.** `MALAY_CLINICAL_TERMS` and
 * `CONFUSABLE_TARGETS` are deliberately excluded: a prescription phrase carries
 * no symptoms, and sixty-odd terms of symptom register against fifteen seconds
 * of drug audio is the wrong-domain context effect docs/trd.md §20.7.1 measured,
 * where an English clinical context scored *worse than no context at all* on
 * Malay audio. What is left is the register a dictated prescription is actually
 * in: a drug name, an amount, a frequency, a duration and a food timing.
 *
 * Every source is derived from a module `parseSig` or `matchMedication` already
 * reads, so the recogniser is primed for exactly what the downstream parser can
 * act on, and neither half can drift from the other.
 *
 * Unmeasured on this provider, like everything else in this file. The
 * narrowing of `languageHints` to `['ms', 'en']` that accompanies it is a
 * reasoned choice rather than an evidenced one.
 */
export function dictationContextTerms(): string[] {
  return [
    ...new Set([
      ...LEXICON_DRUG_TERMS,
      ...SIG_DICTATION_TERMS,
      ...DOSE_UNIT_TERMS,
      ...COUNTABLE_UNITS,
      ...DURATION_UNITS.keys(),
      ...FREQUENCY_ABBREVIATION_TERMS,
    ]),
  ]
}
