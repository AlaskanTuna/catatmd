import type { ClinicalArtefactVersion } from '../../clinical-versions/types.js'
import { CONFUSABLE_TARGETS } from '../../redflags/mishears.js'

/**
 * The clinical vocabulary ambient capture primes the recogniser with, and the
 * first of the three accuracy layers docs/trd.md §20.7 describes.
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
 * **Static by construction.** This crosses the audio egress in the socket's
 * first frame, and audio cannot be de-identified. Nothing here may ever be
 * derived from a consultation, a patient, or any request value;
 * `liveSessionConfig()` takes no arguments, and `soniox.test.ts` pins that.
 */
export const ASR_VOCABULARY_VERSION: ClinicalArtefactVersion = {
  id: 'asr-vocabulary-v1',
  effectiveDate: '2026-09-09',
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
 * The terms sent with one session, as a fresh array.
 *
 * Fresh rather than the module constant, for the reason `liveSessionConfig()`
 * copies `general`: a caller that mutated what it was handed would change what
 * the next consultation sends, and this value crosses the audio egress.
 *
 * `CONFUSABLE_TARGETS` leads because those are the words with a measured
 * failure behind them. The `Set` is what lets the three sources overlap without
 * anyone having to check whether they do.
 */
export function asrContextTerms(): string[] {
  return [...new Set([...CONFUSABLE_TARGETS, ...MALAY_CLINICAL_TERMS, ...ENGLISH_DRUG_TERMS])]
}
