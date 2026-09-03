import { type GuidelineChunk, GuidelineChunkSchema } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

export type ProfiledGuidelineChunk = GuidelineChunk & { readonly profiles: readonly ProfileId[] }

/**
 * Bumped whenever a chunk is added, removed, or its summary/threshold
 * changes. Recorded with every analysis (docs/trd.md §11, §15) so a past
 * suggestion can be traced back to the corpus state that produced it.
 *
 * This is the version of the corpus as an artefact. Each chunk separately
 * carries its own source's `publisher` and `year`.
 */
export const GUIDELINE_CORPUS_VERSION: ClinicalArtefactVersion = {
  id: 'guideline-corpus-v3',
  effectiveDate: '2026-09-04',
}

const URTI_PROFILES: readonly ProfileId[] = ['adult-acute-urti']
const UTI_PROFILES: readonly ProfileId[] = ['adult-acute-uncomplicated-uti']

/**
 * Source selection resolved 13/08/26 (docs/trd.md §11, §19 row 3, closed).
 * Anchored on Malaysian sources; NICE is excluded — its UK Open Content
 * Licence does not cover use for artificial intelligence purposes.
 *
 * One source per chunk, by design: MOH NAG 2024 sets the antibiotic
 * threshold at Modified Centor >=3, while the 2024 Delphi consensus sets it
 * at McIsaac >=4. Merging them into one "Centor threshold" chunk would
 * manufacture a consensus that does not exist, and the ID-constrained
 * citation mechanism cannot catch that because the model would be citing a
 * real, valid ID. No `quote` is populated on any chunk here — most of this
 * corpus was authored from the resolved TRD summary of each source rather
 * than the primary text, so no span can honestly be marked verbatim yet; a
 * future clinician review pass (docs/prd.md §12) is expected to add `quote`s
 * for the CC-licensed sources where warranted.
 *
 * That authoring method is also a known defect, not just a limitation. The
 * two `ooi-2022-*` chunks were rewritten against the primary text on 04/09/26
 * after one was found to assert antibiotic over-prescription while the cited
 * study reports a 6.0% rate its authors call acceptably low, and a third
 * chunk was removed because nothing in the article supported it. The
 * ID-constrained citation mechanism cannot catch that class of error either:
 * the id resolves, and the summary behind it is still wrong. The remaining
 * nine chunks have not had the same check (issue #240).
 */
export const GUIDELINE_CORPUS: readonly ProfiledGuidelineChunk[] = [
  // ─── MOH National Antimicrobial Guideline (NAG), 4th ed., 2024 ───────────
  // © MOH Malaysia, all rights reserved — summarise and link, never quote.
  {
    id: 'moh-nag-2024-a10-modified-centor',
    title: 'National Antimicrobial Guideline, 4th Edition — Annex A10, Modified Centor Score',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'Scores four criteria in adults with sore throat — tonsillar exudate, tender anterior ' +
      'cervical adenopathy, fever by history, and absence of cough — one point each. NAG sets ' +
      'the antibiotic-consideration threshold at a Modified Centor score of 3 or more.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c1-acute-pharyngitis',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C1, Acute Pharyngitis/Tonsillitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'Most adult acute pharyngitis is viral and self-limiting; antibiotics are reserved for ' +
      'patients meeting the Modified Centor threshold (see moh-nag-2024-a10-modified-centor) ' +
      'or with another indication for group A streptococcus coverage. Symptomatic relief is the ' +
      'first-line management for the majority of presentations.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c1-viral-vs-bacterial',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C1, Distinguishing Viral From Bacterial Sore Throat',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'Isolated sore throat with coryzal symptoms, cough, and absence of fever points away from ' +
      'a bacterial cause and antibiotics are not indicated on presentation alone; scoring tools ' +
      'exist because history and examination alone do not reliably separate viral from ' +
      'bacterial pharyngitis in adults.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c3-acute-bronchitis',
    title: 'National Antimicrobial Guideline, 4th Edition — Section C3, Acute Bronchitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'Acute bronchitis in an otherwise healthy adult is usually viral. Antibiotics are not ' +
      'routinely indicated regardless of sputum colour, and are reserved for patients with ' +
      'significant comorbidity, prolonged symptoms, or evidence of a secondary bacterial ' +
      'process such as pneumonia.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c4-uncomplicated-urti',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C4, Uncomplicated Upper Respiratory Tract Infection',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'Uncomplicated URTI (common cold) does not warrant antibiotics; management is symptomatic ' +
      '— analgesia, antipyretics, hydration, and rest — with safety-netting advice to return if ' +
      'symptoms worsen, persist beyond the expected viral course, or a red-flag feature develops.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },

  // ─── Abdullah et al. (2024), Malaysian sore-throat Delphi consensus ──────
  // Infect Drug Resist — CC BY-NC 3.0, quotable with attribution.
  {
    id: 'abdullah-2024-mcisaac-criteria',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — McIsaac Score Criteria',
    publisher: 'Abdullah et al., Infection and Drug Resistance',
    year: 2024,
    url: 'https://doi.org/10.2147/IDR.S477038',
    summary:
      'Endorses the McIsaac score for adult sore throat: the four Centor criteria (tonsillar ' +
      'exudate, tender anterior cervical adenopathy, fever by history, absence of cough) plus ' +
      'an age adjustment of -1 for age 45 and above, reflecting the lower probability of group A ' +
      'streptococcus in older adults.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },
  {
    id: 'abdullah-2024-mcisaac-threshold',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — Antibiotic Threshold',
    publisher: 'Abdullah et al., Infection and Drug Resistance',
    year: 2024,
    url: 'https://doi.org/10.2147/IDR.S477038',
    summary:
      'Malaysian expert consensus recommends considering antibiotics at a McIsaac score of 4 or ' +
      'higher, no antibiotics or further testing below a score of 2, and clinical judgement or ' +
      'point-of-care testing at a score of 2-3.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },
  {
    id: 'abdullah-2024-safety-netting',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — Safety-Netting Advice',
    publisher: 'Abdullah et al., Infection and Drug Resistance',
    year: 2024,
    url: 'https://doi.org/10.2147/IDR.S477038',
    summary:
      'Consensus that every adult sore-throat consultation, regardless of antibiotic decision, ' +
      'should include explicit advice on when to seek review — worsening swallowing difficulty, ' +
      'drooling, trismus, unilateral peritonsillar swelling, or symptoms persisting beyond the ' +
      'expected course.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },

  // ─── Ooi et al. (2022), Malaysian Family Physician ───────────────────────
  // CC BY 4.0, quotable with attribution.
  {
    id: 'ooi-2022-urti-epidemiology',
    title:
      'Upper Respiratory Tract Infections at a Malaysian Primary Care Clinic — Presenting Pattern',
    publisher: 'Ooi et al., Malaysian Family Physician',
    year: 2022,
    url: 'https://doi.org/10.51866/oa.38',
    summary:
      'A cross-sectional study of 587 patients at one dedicated URTI clinic in Alor Setar during ' +
      'the early COVID-19 period. Cough (68.4%), fever (31.6%), runny nose (24.6%) and sore ' +
      'throat (24.1%) were the commonest presenting symptoms, and acute nasopharyngitis (52.5%) ' +
      'the commonest recorded condition. Single-centre and pandemic-era, so it describes a presenting ' +
      'pattern rather than national epidemiology.',
    sourceLicence: 'CC-BY-4.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },
  {
    id: 'ooi-2022-antibiotic-prescribing-patterns',
    title: 'Upper Respiratory Tract Infections at a Malaysian Primary Care Clinic — Antibiotic Use',
    publisher: 'Ooi et al., Malaysian Family Physician',
    year: 2022,
    url: 'https://doi.org/10.51866/oa.38',
    summary:
      'Of 435 URTI presentations, 26 (6.0%) were prescribed an antibiotic, which the ' +
      'authors describe as acceptably low and as evidence of judicious prescribing. Symptomatic ' +
      'medication was prescribed to 96.5%. The authors name patient expectation and prescribing ' +
      'habit as questions for further study, not as established drivers.',
    sourceLicence: 'CC-BY-4.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-acute-uti-scope',
    title: 'National Antimicrobial Guideline, 4th Edition, Acute Urinary Tract Infection',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://pharmacy.moh.gov.my/nag',
    summary:
      'MOH NAG 2024 includes guidance for urinary tract infection presentations. This prototype ' +
      'does not encode drug choice, dose, duration, or treatment thresholds from that source; ' +
      'the treating doctor must review the source itself.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: UTI_PROFILES,
  },
]

for (const chunk of GUIDELINE_CORPUS) {
  GuidelineChunkSchema.parse(chunk)
}

/**
 * `makeSuggestionsAndRedFlagsSchema` (docs/trd.md §12) needs a non-empty
 * tuple type, not `string[]`, so `z.enum` can narrow `guidelineId` at the
 * type level. The cast is checked immediately below by the length guard.
 */
export function corpusIdsFor(chunks: readonly GuidelineChunk[]): readonly [string, ...string[]] {
  const ids = chunks.map((chunk) => chunk.id)
  if (ids.length === 0) throw new Error('guideline corpus must not be empty')
  return ids as [string, ...string[]]
}

export const corpusIds = corpusIdsFor(GUIDELINE_CORPUS)
