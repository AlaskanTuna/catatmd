import {
  type ClinicalAssertion,
  type ClinicalFacts,
  ClinicalFactsSchema,
  type LlmClinicalFactsSchema,
  type LlmOperationalBlockSchema,
  type OperationalBlock,
  OperationalBlockSchema,
} from '@shared/types'
import type { z } from 'zod'

type LlmClinicalFacts = z.infer<typeof LlmClinicalFactsSchema>
type LlmOperationalBlock = z.infer<typeof LlmOperationalBlockSchema>

export interface EvidenceCheckResult {
  clinicalFacts: ClinicalFacts
  operational: OperationalBlock
  discardedFieldIds: string[]
}

/** Only these two states assert something happened or did not — docs/trd.md §21.4. */
const EVIDENCE_REQUIRED_STATES = new Set(['PRESENT', 'DENIED'])

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

function hasVerbatimEvidence(assertion: ClinicalAssertion, transcriptText: string): boolean {
  if (!EVIDENCE_REQUIRED_STATES.has(assertion.state)) return true
  const evidence = assertion.evidence?.trim()
  if (!evidence) return false
  return normalise(transcriptText).includes(normalise(evidence))
}

/**
 * The primary control (docs/trd.md §21.4). Scoped to `state`, not `value` —
 * a paraphrased `value` paired with a genuine `evidence` span survives; only
 * a `state` with no matching span is downgraded. Strict matching biases every
 * error toward the safe direction (§21.4's asymmetry table): a false
 * `NOT_ASSESSED` costs one dismissed gap prompt, a false `DENIED` is the harm
 * this system exists to prevent.
 */
function checkAssertion(
  assertion: ClinicalAssertion,
  fieldId: string,
  transcriptText: string,
  discarded: string[],
): ClinicalAssertion {
  if (hasVerbatimEvidence(assertion, transcriptText)) return assertion
  discarded.push(fieldId)
  return { state: 'NOT_ASSESSED' }
}

function checkGroup<T extends Record<string, ClinicalAssertion>>(
  group: T,
  prefix: string,
  transcriptText: string,
  discarded: string[],
): T {
  const entries = Object.entries(group).map(
    ([key, assertion]) =>
      [key, checkAssertion(assertion, `${prefix}.${key}`, transcriptText, discarded)] as const,
  )
  return Object.fromEntries(entries) as T
}

/**
 * Runs the evidence check over every field in `clinicalFacts` and
 * `operational`, then re-parses the result against the strict schemas as a
 * backstop: those schemas refuse an evidence-less `PRESENT`/`DENIED`, so a
 * bug in the check above fails loudly here rather than reaching a doctor.
 */
export function applyEvidenceCheck(
  clinicalFacts: LlmClinicalFacts,
  operational: LlmOperationalBlock,
  transcriptText: string,
): EvidenceCheckResult {
  const discarded: string[] = []

  const checkedFacts = {
    symptoms: checkGroup(
      clinicalFacts.symptoms,
      'clinicalFacts.symptoms',
      transcriptText,
      discarded,
    ),
    history: checkGroup(clinicalFacts.history, 'clinicalFacts.history', transcriptText, discarded),
    observations: checkGroup(
      clinicalFacts.observations,
      'clinicalFacts.observations',
      transcriptText,
      discarded,
    ),
    examination: checkGroup(
      clinicalFacts.examination,
      'clinicalFacts.examination',
      transcriptText,
      discarded,
    ),
  }

  const checkedOperational = {
    diagnosis: checkAssertion(
      operational.diagnosis,
      'operational.diagnosis',
      transcriptText,
      discarded,
    ),
    medicationsDispensed: operational.medicationsDispensed.map((medication, index) =>
      checkAssertion(
        medication,
        `operational.medicationsDispensed[${index}]`,
        transcriptText,
        discarded,
      ),
    ),
    mcDays: checkAssertion(operational.mcDays, 'operational.mcDays', transcriptText, discarded),
    referral: checkAssertion(
      operational.referral,
      'operational.referral',
      transcriptText,
      discarded,
    ),
    followUp: checkAssertion(
      operational.followUp,
      'operational.followUp',
      transcriptText,
      discarded,
    ),
  }

  return {
    clinicalFacts: ClinicalFactsSchema.parse(checkedFacts),
    operational: OperationalBlockSchema.parse(checkedOperational),
    discardedFieldIds: discarded,
  }
}
