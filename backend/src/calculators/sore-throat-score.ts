import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'
import { type CitableDocumentId, documentRef } from '../guidelines/documents.js'

/**
 * The sore-throat score the doctor completes on the review page (#221).
 *
 * **Versioned clinical data, and the only place it is written down.** The
 * Modified Centor score as MOH's National Antimicrobial Guideline 2024 (§A10)
 * tabulates it, read from the guideline's own table on 08/10/26, in our own
 * words because the source is all rights reserved (docs/trd.md §10). Abdullah
 * et al. 2024 publish the same instrument as the McIsaac score, differing only
 * at its edges (38 °C itself, age 45 itself, "tender" without "swollen"), so it
 * is not offered as a second near-identical form (docs/decisions.md D-012).
 *
 * **There is no threshold here, on purpose.** The two sources read the total
 * against different cut-offs, and a cut-off is a treatment decision the
 * product does not make (docs/README.md, Boundaries). The doctor sums what they
 * confirm and opens the cited source for what it means.
 *
 * The 3 to 14 age band is left out: the product's scope is adults.
 */
export const SORE_THROAT_SCORE_VERSION: ClinicalArtefactVersion = {
  id: 'sore-throat-score-v1',
  effectiveDate: '2026-10-08',
}

/**
 * How an item may be read from one sentence of the transcript (`prefill.ts`
 * applies the sentence rules). Each `stated` entry is a set of patterns that
 * must all appear in one clause; each `denied` pattern is a denial that
 * governs the finding directly.
 */
export interface ScoreReading {
  stated: readonly (readonly RegExp[])[]
  denied: readonly RegExp[]
  whenStated: string
  whenDenied: string
}

/** A body temperature read as a number. */
export interface ScoreMeasurement {
  /** A reading, the number in the first group. */
  pattern: RegExp
  /** Plausible values only: outside this range the number is something else. */
  range: readonly [number, number]
  above: number
  whenAbove: string
  whenNotAbove: string
}

export interface ScoreItemDefinition {
  id: string
  label: string
  options: readonly { id: string; label: string; points: number }[]
  reading?: ScoreReading
  measurement?: ScoreMeasurement
}

export interface ScoreDefinition {
  id: string
  name: string
  /** The one source that defines this score. */
  source: CitableDocumentId
  items: readonly ScoreItemDefinition[]
}

const MET = [
  { id: 'yes', label: 'Yes', points: 1 },
  { id: 'no', label: 'No', points: 0 },
] as const

const NODE = /\b(?:lymph\s+nodes?|nodes?|glands?|lymphadenopathy|kelenjar)\b/i

export const SORE_THROAT_SCORE = {
  /** Offered only on these profiles, and only where a sore throat was reported. */
  profiles: ['adult-acute-urti'] as readonly ProfileId[],
  presentation: [
    [/\b(?:sore|painful|scratchy)\s+throat\b/i],
    // Manglish puts the Malay word after: "my throat also quite sakit".
    [/\bthroat\b[^.,;]{0,25}?\b(?:sore|pain(?:ful)?|hurts?|hurting|sakit|pedih)\b/i],
    [/\bpharyngitis\b|\btonsill?itis\b/i],
    [/\bsakit\s+tekak\b/i],
  ] as readonly (readonly RegExp[])[],
  score: {
    id: 'modified-centor',
    name: 'Modified Centor Score',
    source: 'moh-nag-2024',
    items: [
      {
        id: 'cough',
        label: 'Cough',
        options: [
          { id: 'absent', label: 'Absent', points: 1 },
          { id: 'present', label: 'Present', points: 0 },
        ],
        reading: {
          stated: [[/\bcough(?:s|ed|ing)?\b/i], [/\bbatuk\b/i]],
          denied: [
            /\b(?:no|nil|without|denies|denied|never)\s+(?:any\s+|a\s+)?(?:\w+\s+(?:or|nor)\s+){0,3}cough(?:s|ing)?\b/i,
            /\bnot\s+coughing\b/i,
            /\bcough\s+(?:is\s+|was\s+)?(?:absent|nil)\b/i,
            /\b(?:tak|tidak|tiada|takde|tak\s+ada|tidak\s+ada)\s+(?:\w+\s+atau\s+){0,3}batuk\b/i,
            /\bbatuk\s+(?:tak\s+ada|takde|tiada|tidak\s+ada)\b/i,
          ],
          whenStated: 'present',
          whenDenied: 'absent',
        },
      },
      {
        id: 'neck-nodes',
        label: 'Swollen, tender lymph nodes at the front of the neck',
        options: MET,
        reading: {
          // Swollen and tender, both, as the source's criterion reads.
          stated: [[NODE, /\btender\b/i, /\b(?:swollen|enlarged|bengkak|lymphadenopathy)\b/i]],
          denied: [
            /\bno\s+(?:(?:palpable|enlarged|tender|swollen|significant|anterior|cervical|neck)\s+){0,3}(?:lymphadenopathy|lymph\s+nodes?|nodes|glands)\b/i,
            /\b(?:nodes?|glands?)\s+(?:are\s+|is\s+|were\s+)?(?:not|non-?)\s*(?:tender|swollen|enlarged|palpable)\b/i,
            /\bnon-?tender\s+(?:\w+\s+){0,2}(?:lymph\s+nodes?|nodes?|glands?|lymphadenopathy)\b/i,
          ],
          whenStated: 'yes',
          whenDenied: 'no',
        },
      },
      {
        id: 'temperature',
        label: 'Temperature above 38 °C',
        options: MET,
        measurement: {
          // Only linking words between the word and the number.
          pattern:
            /\b(?:temperature|temp|suhu|febrile\s+at|fever\s+of|demam)\b(?:\s*[:=]|\s+(?:is|was|of|today|now|reading|at\s+home|tadi|hari\s+ini)){0,3}\s*(\d{2}(?:\.\d{1,2})?)\s*(?:°\s*c?|degrees?|darjah)?/gi,
          range: [34, 43],
          above: 38,
          whenAbove: 'yes',
          whenNotAbove: 'no',
        },
      },
      {
        id: 'tonsils',
        label: 'Exudate on the tonsils, or severe tonsil swelling',
        options: MET,
        reading: {
          stated: [
            [/\bexudates?\b/i],
            [/\b(?:pus|white\s+(?:patches|spots))\b/i, /\btonsils?\b/i],
            [/\b(?:severe(?:ly)?|markedly|grossly)\s+(?:swollen|enlarged)\b/i, /\btonsils?\b/i],
            [/\bkissing\s+tonsils\b/i],
          ],
          denied: [
            /\bno\s+(?:tonsillar\s+)?exudates?\b/i,
            /\bexudates?\s+(?:is\s+|are\s+|was\s+)?(?:absent|nil|not\s+seen|not\s+present|negative|neg\b|-ve\b|\(-\))/i,
            /\btonsils?\s+(?:are\s+|is\s+|look\s+|looks?\s+)?(?:normal|unremarkable)\b/i,
          ],
          whenStated: 'yes',
          whenDenied: 'no',
        },
      },
      {
        id: 'age',
        label: 'Age',
        options: [
          { id: '15-to-44', label: '15 to 44', points: 0 },
          { id: '45-and-over', label: '45 or older', points: -1 },
        ],
      },
    ],
  } satisfies ScoreDefinition,
} as const

export const sourceRef = (score: ScoreDefinition): string => documentRef(score.source)
