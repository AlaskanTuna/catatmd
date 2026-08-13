import type {
  AssertionState,
  ClinicalAssertion,
  ClinicalFacts,
  OperationalBlock,
} from '@shared/types'

/**
 * Issue #5 — maps each supported clinical fact to the verbatim transcript
 * span behind it, keyed by field id. This is a by-product of the evidence
 * check (docs/trd.md §21.4): every link here already carries a span the
 * check matched against the de-identified transcript, so there is no
 * separate "note statement" to trace — the note itself is generated prose
 * (§12), not composed from these facts. Data only; docs/trd.md §21.4's Open
 * item (§19 row 17) scopes surfacing this as clickable UI out for now.
 */
export interface EvidenceLink {
  fieldId: string
  state: AssertionState
  evidence: string
}

function linkFor(fieldId: string, assertion: ClinicalAssertion): EvidenceLink[] {
  return assertion.evidence
    ? [{ fieldId, state: assertion.state, evidence: assertion.evidence }]
    : []
}

function linksForGroup(prefix: string, group: Record<string, ClinicalAssertion>): EvidenceLink[] {
  return Object.entries(group).flatMap(([key, assertion]) => linkFor(`${prefix}.${key}`, assertion))
}

export function buildEvidenceLinks(
  clinicalFacts: ClinicalFacts,
  operational: OperationalBlock,
): EvidenceLink[] {
  return [
    ...linksForGroup('clinicalFacts.symptoms', clinicalFacts.symptoms),
    ...linksForGroup('clinicalFacts.history', clinicalFacts.history),
    ...linksForGroup('clinicalFacts.observations', clinicalFacts.observations),
    ...linksForGroup('clinicalFacts.examination', clinicalFacts.examination),
    ...linkFor('operational.diagnosis', operational.diagnosis),
    ...operational.medicationsDispensed.flatMap((medication, index) =>
      linkFor(`operational.medicationsDispensed[${index}]`, medication),
    ),
    ...linkFor('operational.mcDays', operational.mcDays),
    ...linkFor('operational.referral', operational.referral),
    ...linkFor('operational.followUp', operational.followUp),
  ]
}
