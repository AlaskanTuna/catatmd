import { type GuidelineChunk, GuidelineChunkSchema } from '@shared/types'

/**
 * Bumped whenever a chunk is added, removed, or its summary/threshold
 * changes. Recorded with every analysis (docs/trd.md §11) so a past
 * suggestion can be traced back to the corpus state that produced it.
 */
export const CORPUS_VERSION = '2026-08-13'

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
 * real, valid ID. No `quote` is populated on any chunk here — this corpus
 * was authored from the resolved TRD summary of each source rather than the
 * primary text, so no span can honestly be marked verbatim yet; a future
 * clinician review pass (docs/prd.md §12) is expected to add `quote`s for
 * the CC-licensed sources where warranted.
 */
export const GUIDELINE_CORPUS: readonly GuidelineChunk[] = [
  // ─── MOH National Antimicrobial Guideline (NAG), 4th ed., 2024 ───────────
  // © MOH Malaysia, all rights reserved — summarise and link, never quote.
  {
    id: 'moh-nag-2024-a10-modified-centor',
    title: 'National Antimicrobial Guideline, 4th Edition — Annex A10, Modified Centor Score',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://www.pharmacy.gov.my/v2/en/documents/national-antimicrobial-guideline-nag.html',
    summary:
      'Scores four criteria in adults with sore throat — tonsillar exudate, tender anterior ' +
      'cervical adenopathy, fever by history, and absence of cough — one point each. NAG sets ' +
      'the antibiotic-consideration threshold at a Modified Centor score of 3 or more.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
  },
  {
    id: 'moh-nag-2024-c1-acute-pharyngitis',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C1, Acute Pharyngitis/Tonsillitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://www.pharmacy.gov.my/v2/en/documents/national-antimicrobial-guideline-nag.html',
    summary:
      'Most adult acute pharyngitis is viral and self-limiting; antibiotics are reserved for ' +
      'patients meeting the Modified Centor threshold (see moh-nag-2024-a10-modified-centor) ' +
      'or with another indication for group A streptococcus coverage. Symptomatic relief is the ' +
      'first-line management for the majority of presentations.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
  },
  {
    id: 'moh-nag-2024-c1-viral-vs-bacterial',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C1, Distinguishing Viral From Bacterial Sore Throat',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://www.pharmacy.gov.my/v2/en/documents/national-antimicrobial-guideline-nag.html',
    summary:
      'Isolated sore throat with coryzal symptoms, cough, and absence of fever points away from ' +
      'a bacterial cause and antibiotics are not indicated on presentation alone; scoring tools ' +
      'exist because history and examination alone do not reliably separate viral from ' +
      'bacterial pharyngitis in adults.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
  },
  {
    id: 'moh-nag-2024-c3-acute-bronchitis',
    title: 'National Antimicrobial Guideline, 4th Edition — Section C3, Acute Bronchitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://www.pharmacy.gov.my/v2/en/documents/national-antimicrobial-guideline-nag.html',
    summary:
      'Acute bronchitis in an otherwise healthy adult is usually viral. Antibiotics are not ' +
      'routinely indicated regardless of sputum colour, and are reserved for patients with ' +
      'significant comorbidity, prolonged symptoms, or evidence of a secondary bacterial ' +
      'process such as pneumonia.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
  },
  {
    id: 'moh-nag-2024-c4-uncomplicated-urti',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C4, Uncomplicated Upper Respiratory Tract Infection',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://www.pharmacy.gov.my/v2/en/documents/national-antimicrobial-guideline-nag.html',
    summary:
      'Uncomplicated URTI (common cold) does not warrant antibiotics; management is symptomatic ' +
      '— analgesia, antipyretics, hydration, and rest — with safety-netting advice to return if ' +
      'symptoms worsen, persist beyond the expected viral course, or a red-flag feature develops.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
  },

  // ─── Abdullah et al. (2024), Malaysian sore-throat Delphi consensus ──────
  // Infect Drug Resist — CC BY-NC 3.0, quotable with attribution.
  {
    id: 'abdullah-2024-mcisaac-criteria',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — McIsaac Score Criteria',
    publisher: 'Abdullah et al., Infectious Diseases and Therapy',
    year: 2024,
    url: 'https://www.dovepress.com/infection-and-drug-resistance-journal',
    summary:
      'Endorses the McIsaac score for adult sore throat: the four Centor criteria (tonsillar ' +
      'exudate, tender anterior cervical adenopathy, fever by history, absence of cough) plus ' +
      'an age adjustment of -1 for age 45 and above, reflecting the lower probability of group A ' +
      'streptococcus in older adults.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
  },
  {
    id: 'abdullah-2024-mcisaac-threshold',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — Antibiotic Threshold',
    publisher: 'Abdullah et al., Infectious Diseases and Therapy',
    year: 2024,
    url: 'https://www.dovepress.com/infection-and-drug-resistance-journal',
    summary:
      'Malaysian expert consensus recommends considering antibiotics at a McIsaac score of 4 or ' +
      'higher, no antibiotics or further testing below a score of 2, and clinical judgement or ' +
      'point-of-care testing at a score of 2-3.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
  },
  {
    id: 'abdullah-2024-safety-netting',
    title:
      'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — Safety-Netting Advice',
    publisher: 'Abdullah et al., Infectious Diseases and Therapy',
    year: 2024,
    url: 'https://www.dovepress.com/infection-and-drug-resistance-journal',
    summary:
      'Consensus that every adult sore-throat consultation, regardless of antibiotic decision, ' +
      'should include explicit advice on when to seek review — worsening swallowing difficulty, ' +
      'drooling, trismus, unilateral peritonsillar swelling, or symptoms persisting beyond the ' +
      'expected course.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
  },

  // ─── Ooi et al. (2022), Malaysian Family Physician ───────────────────────
  // CC BY 4.0, quotable with attribution.
  {
    id: 'ooi-2022-urti-epidemiology',
    title: 'Upper Respiratory Tract Infections in Malaysian Primary Care — Presentation Burden',
    publisher: 'Ooi et al., Malaysian Family Physician',
    year: 2022,
    url: 'https://www.mfp.org.my/',
    summary:
      'URTIs (common cold, acute pharyngitis, acute bronchitis) are among the most frequent ' +
      'reasons for a primary-care consultation in Malaysia, and the large majority are ' +
      'viral in an otherwise healthy adult.',
    sourceLicence: 'CC-BY-4.0',
    verbatimAllowed: true,
  },
  {
    id: 'ooi-2022-antibiotic-prescribing-patterns',
    title: 'Upper Respiratory Tract Infections in Malaysian Primary Care — Prescribing Patterns',
    publisher: 'Ooi et al., Malaysian Family Physician',
    year: 2022,
    url: 'https://www.mfp.org.my/',
    summary:
      'Documents antibiotic over-prescription for URTI in Malaysian primary care relative to ' +
      'the proportion of presentations with a plausible bacterial cause, and identifies patient ' +
      'expectation and diagnostic uncertainty as drivers — supporting structured scoring tools ' +
      'as a stewardship intervention.',
    sourceLicence: 'CC-BY-4.0',
    verbatimAllowed: true,
  },
  {
    id: 'ooi-2022-symptom-duration',
    title: 'Upper Respiratory Tract Infections in Malaysian Primary Care — Expected Symptom Course',
    publisher: 'Ooi et al., Malaysian Family Physician',
    year: 2022,
    url: 'https://www.mfp.org.my/',
    summary:
      'Uncomplicated viral URTI symptoms typically resolve within one to two weeks; cough in ' +
      'particular can persist beyond resolution of other symptoms without indicating a ' +
      'secondary bacterial process, which is useful context for reassurance and safety-netting.',
    sourceLicence: 'CC-BY-4.0',
    verbatimAllowed: true,
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
function toCorpusIds(chunks: readonly GuidelineChunk[]): readonly [string, ...string[]] {
  const ids = chunks.map((chunk) => chunk.id)
  if (ids.length === 0) throw new Error('guideline corpus must not be empty')
  return ids as [string, ...string[]]
}

export const corpusIds = toCorpusIds(GUIDELINE_CORPUS)
