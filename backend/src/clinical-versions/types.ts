/**
 * docs/trd.md §15 (Clinical Content Versioning). The stamp every versioned
 * clinical artefact carries: the red-flag trigger list, the gap checklist, and
 * the guideline corpus.
 *
 * `id` and `effectiveDate` are separate fields because they answer different
 * questions. `id` names the version and is what gets written into the audit
 * trail, so it must stay stable once a run has recorded it. `effectiveDate`
 * says when that version took effect, which is editorial and may be set ahead
 * of the authoring date.
 *
 * Declared here rather than beside the aggregator so the three data files can
 * import the type without a cycle back through the module that reads them.
 */
export interface ClinicalArtefactVersion {
  readonly id: string
  /** ISO 8601 calendar date, `YYYY-MM-DD`. */
  readonly effectiveDate: string
}
