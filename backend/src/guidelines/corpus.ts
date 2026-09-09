import { type GuidelineChunk, GuidelineChunkSchema } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'

export type ProfiledGuidelineChunk = GuidelineChunk & { readonly profiles: readonly ProfileId[] }

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
 * real, valid ID.
 *
 * Every summary was checked against its primary source on 07/09/26 (issue
 * #240). No `quote` is populated: summaries are sufficient for this small
 * corpus, and keeping them non-verbatim gives every source the same review
 * path. MOH NAG is a living publication; direct section links and titles
 * below reflect the section structure available on that date. Some IDs keep
 * their original section-name slugs because stored analyses and deterministic
 * red flags cite these stable identifiers; the title and URL identify the
 * current source location.
 */
export const GUIDELINE_CORPUS: readonly ProfiledGuidelineChunk[] = [
  // ─── MOH National Antimicrobial Guideline (NAG), 4th ed., 2024 ───────────
  // © MOH Malaysia, all rights reserved — summarise and link, never quote.
  {
    id: 'moh-nag-2024-a10-modified-centor',
    title: 'National Antimicrobial Guideline, 4th Edition — Section A10, Acute Pharyngitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-a-adult/a10-otorhinolaryngology-infections',
    summary:
      'Respiratory viruses cause more than 80% of acute sore throats. NAG uses the Modified ' +
      'Centor score to guide care: a score below 3 receives symptomatic treatment without ' +
      'antibiotics, while a score of 3 or more receives symptomatic and antimicrobial therapy ' +
      'because group A streptococcal infection is more likely.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c1-acute-pharyngitis',
    title: 'National Antimicrobial Guideline, 4th Edition — Section C3, Strep Score',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-c-clinical-pathways-in-primary-care/c3-acute-pharyngitis',
    summary:
      'The acute tonsillo-pharyngitis pathway assigns one point each for absence of cough, ' +
      'temperature above 38°C, tender swollen anterior cervical lymph nodes, and tonsillar ' +
      'exudate or swelling. It adds one point at age 3–14, no age point at 15–44, and subtracts ' +
      'one point at age 45 or above. Scores below 3 receive symptomatic treatment; scores of 3 ' +
      'or more also receive antimicrobial therapy.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c1-viral-vs-bacterial',
    title:
      'National Antimicrobial Guideline, 4th Edition — Section C1, Adult Acute Cough Assessment',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-c-clinical-pathways-in-primary-care/c1-acute-bronchitis-and-pneumonia',
    summary:
      'For an adult with acute cough, the pathway checks heart rate above 100, respiratory rate ' +
      'above 24, temperature above 38°C, oxygen saturation below 95%, and examination findings ' +
      'suggestive of consolidation or pleural effusion. Abnormal findings prompt assessment for ' +
      'pneumonia, including chest radiography when available.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c3-acute-bronchitis',
    title: 'National Antimicrobial Guideline, 4th Edition — Section C1, Acute Bronchitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-c-clinical-pathways-in-primary-care/c1-acute-bronchitis-and-pneumonia',
    summary:
      'When the adult acute-cough assessment finds no vital-sign or examination abnormality ' +
      'suggesting pneumonia, acute bronchitis is likely. The great majority of cases are ' +
      'self-limiting and viral, antibiotics are not needed, treatment is symptomatic, and a ' +
      'bronchodilator may be considered when wheeze is present.',
    sourceLicence: 'MOH-ARR',
    verbatimAllowed: false,
    profiles: URTI_PROFILES,
  },
  {
    id: 'moh-nag-2024-c4-uncomplicated-urti',
    title: 'National Antimicrobial Guideline, 4th Edition — Section C4, Acute Rhinosinusitis',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-c-clinical-pathways-in-primary-care/c4-acute-rhinosinusitis',
    summary:
      'Acute viral rhinosinusitis lasting under 10 days receives symptomatic treatment without ' +
      'antibiotics. Symptoms increasing after 5 days or persisting beyond 10 days indicate ' +
      'post-viral rhinosinusitis. Likely bacterial rhinosinusitis requires at least three of ' +
      'fever above 38°C, discoloured mucus, double sickening, severe local pain, or raised ESR/CRP.',
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
      'Describes the McIsaac score using temperature of at least 38°C, no cough, tender anterior ' +
      'cervical adenopathy, and tonsillar swelling or exudate, each worth one point. It adds one ' +
      'point at age 3–14, no age point at 15–44, and subtracts one point for age above 45.',
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
      'A McIsaac score of 4 represents a high likelihood of bacterial infection and antibiotics ' +
      'are usually indicated; a score below 2 is considered viral and does not require ' +
      'antibiotics. Point-of-care testing for group A streptococcus can refine treatment ' +
      'decisions, while antibiotic prescribing still depends on clinical judgement.',
    sourceLicence: 'CC-BY-NC-3.0',
    verbatimAllowed: true,
    profiles: URTI_PROFILES,
  },
  {
    id: 'abdullah-2024-safety-netting',
    title: 'Malaysian Delphi Consensus on Sore Throat Management in Primary Care — Evidence Scope',
    publisher: 'Abdullah et al., Infection and Drug Resistance',
    year: 2024,
    url: 'https://doi.org/10.2147/IDR.S477038',
    summary:
      'The consensus addresses antimicrobial resistance, McIsaac scoring, point-of-care testing, ' +
      'judicious antibiotic use, and symptomatic treatment for acute sore throat. It does not ' +
      'publish the safety-netting checklist previously attributed to it, so this source must not ' +
      'be cited as evidence for specific escalation criteria.',
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
      'At one dedicated URTI clinic in Alor Setar during the early COVID-19 period, 587 patients ' +
      'attended and 564 met the study criteria; 435 received a URTI diagnosis. Among included ' +
      'patients, cough (68.4%), fever (31.6%), runny nose (24.6%), and sore throat (24.1%) were ' +
      'the commonest symptoms, and acute nasopharyngitis (52.5%) the commonest diagnosis. This ' +
      'single-centre, pandemic-era study describes a presenting pattern, not national epidemiology.',
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
    title: 'National Antimicrobial Guideline, 4th Edition — Section A17, Urinary Tract Infections',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://sites.google.com/moh.gov.my/nag/contents/section-a-adult/a17-urinary-tract-infections',
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
