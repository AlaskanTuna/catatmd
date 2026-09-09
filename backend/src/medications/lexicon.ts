import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

/**
 * Generic drug names for the two clinical profiles, used to offer spelling
 * candidates for names the recogniser garbled.
 *
 * **This is a spelling aid, not a formulary** (`docs/decisions.md` D-001).
 * Four keys, and no fifth: no dose, no indication, no interaction, no
 * recommendation. The ingested CPG chunks draw the same line for themselves.
 *
 * `synonyms` holds *alternative accepted names* only, never mishears.
 * `redflags/mishears.ts` caps its confusable table at pairs that were
 * actually measured on real audio, and this repository has no drug-mishear
 * measurements. Speculating in data would be a second, unversioned confusable
 * table; the phonetic matcher absorbs mishears instead.
 *
 * **No brand names.** D-001 puts them outside the boundary. That costs real
 * recall, because Panadol and Augmentin are words Malaysian doctors actually
 * say, and the doctor types those instead.
 *
 * Bump `MEDICATION_LEXICON_VERSION` whenever an entry is added, removed or
 * renamed, so a stamped run stays traceable to the list it ran against.
 */
export type MedicationEntry = {
  readonly id: string
  readonly generic: string
  readonly synonyms: readonly string[]
  readonly profiles: readonly ProfileId[]
}

export const MEDICATION_LEXICON_VERSION: ClinicalArtefactVersion = {
  id: 'medication-lexicon-v1',
  effectiveDate: '2026-09-09',
}

const URTI: readonly ProfileId[] = ['adult-acute-urti']
const UTI: readonly ProfileId[] = ['adult-acute-uncomplicated-uti']
const BOTH: readonly ProfileId[] = ['adult-acute-urti', 'adult-acute-uncomplicated-uti']

export const MEDICATION_LEXICON: readonly MedicationEntry[] = [
  // Analgesia and antipyresis, reached by both profiles.
  { id: 'paracetamol', generic: 'paracetamol', synonyms: ['acetaminophen'], profiles: BOTH },
  { id: 'ibuprofen', generic: 'ibuprofen', synonyms: [], profiles: BOTH },

  // Antibacterials, upper respiratory.
  { id: 'amoxicillin', generic: 'amoxicillin', synonyms: ['amoxycillin'], profiles: URTI },
  {
    id: 'amoxicillin-clavulanate',
    generic: 'amoxicillin-clavulanate',
    synonyms: ['co-amoxiclav', 'coamoxiclav', 'amoxicillin clavulanic acid'],
    profiles: BOTH,
  },
  {
    id: 'phenoxymethylpenicillin',
    generic: 'phenoxymethylpenicillin',
    synonyms: ['penicillin v'],
    profiles: URTI,
  },
  { id: 'erythromycin', generic: 'erythromycin', synonyms: [], profiles: URTI },
  { id: 'azithromycin', generic: 'azithromycin', synonyms: [], profiles: URTI },
  { id: 'clarithromycin', generic: 'clarithromycin', synonyms: [], profiles: URTI },
  { id: 'doxycycline', generic: 'doxycycline', synonyms: [], profiles: URTI },
  { id: 'cefuroxime', generic: 'cefuroxime', synonyms: ['cefuroxime axetil'], profiles: BOTH },

  // Symptomatic, upper respiratory.
  { id: 'cetirizine', generic: 'cetirizine', synonyms: [], profiles: URTI },
  { id: 'loratadine', generic: 'loratadine', synonyms: [], profiles: URTI },
  {
    id: 'chlorphenamine',
    generic: 'chlorphenamine',
    synonyms: ['chlorpheniramine'],
    profiles: URTI,
  },
  { id: 'pseudoephedrine', generic: 'pseudoephedrine', synonyms: [], profiles: URTI },
  { id: 'dextromethorphan', generic: 'dextromethorphan', synonyms: [], profiles: URTI },
  { id: 'guaifenesin', generic: 'guaifenesin', synonyms: [], profiles: URTI },
  { id: 'benzydamine', generic: 'benzydamine', synonyms: [], profiles: URTI },
  { id: 'salbutamol', generic: 'salbutamol', synonyms: ['albuterol'], profiles: URTI },
  { id: 'prednisolone', generic: 'prednisolone', synonyms: [], profiles: URTI },

  // Antibacterials, urinary.
  { id: 'nitrofurantoin', generic: 'nitrofurantoin', synonyms: [], profiles: UTI },
  { id: 'trimethoprim', generic: 'trimethoprim', synonyms: [], profiles: UTI },
  {
    id: 'cotrimoxazole',
    generic: 'cotrimoxazole',
    synonyms: ['co-trimoxazole', 'trimethoprim-sulfamethoxazole'],
    profiles: UTI,
  },
  { id: 'fosfomycin', generic: 'fosfomycin', synonyms: [], profiles: UTI },
  { id: 'ciprofloxacin', generic: 'ciprofloxacin', synonyms: [], profiles: UTI },
  { id: 'norfloxacin', generic: 'norfloxacin', synonyms: [], profiles: UTI },
  { id: 'cefalexin', generic: 'cefalexin', synonyms: ['cephalexin'], profiles: UTI },
  { id: 'phenazopyridine', generic: 'phenazopyridine', synonyms: [], profiles: UTI },
]

/**
 * Narrowing, never a default. `matchMedication` searches the whole lexicon
 * unless a caller names a profile, because defaulting to one would silently
 * hide every urinary drug from a urinary dictation.
 */
export const lexiconFor = (profileId: ProfileId): readonly MedicationEntry[] =>
  MEDICATION_LEXICON.filter(({ profiles }) => profiles.includes(profileId))
