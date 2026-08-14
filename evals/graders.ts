import type { ClinicalAssertion, ConsultationAnalysis, Transcript } from '@shared/types'

/**
 * Grading is pure, and deliberately separate from the harness that calls the
 * model.
 *
 * These functions take an analysis and return a verdict. They spend nothing,
 * they are deterministic, and so they are unit-tested in CI like any other
 * code. `run.ts`, which spends real money against a real provider, is not.
 *
 * That split is the point. A grader that silently always passes is the exact
 * failure this harness exists to prevent, so the grader is the part that gets
 * tested.
 */

export type Severity = 'critical' | 'informational'

export interface Finding {
  grader: string
  severity: Severity
  passed: boolean
  detail: string
}

/**
 * Every red flag the deterministic engine must raise, did.
 *
 * **Critical, and the reason this harness exists.** `AGENTS.md` allows the
 * model to add candidates and never to suppress a rule hit, so the assertion
 * is a subset check rather than an equality one: extra model candidates are
 * legitimate output, a missing rule hit is a patient-safety defect.
 *
 * Graded on `ruleId` rather than `id`, because `id` is per-analysis and
 * `ruleId` is the stable identifier `FIXTURE_RUBRICS.expectedRedFlagIds` is
 * written against.
 */
export function gradeRedFlagRecall(
  analysis: ConsultationAnalysis,
  expectedRedFlagIds: readonly string[],
): Finding {
  const raised = new Set(
    analysis.redFlags
      .filter((f) => f.source === 'rule')
      .flatMap((f) => (f.ruleId ? [f.ruleId] : [])),
  )
  const missing = expectedRedFlagIds.filter((id) => !raised.has(id))

  return {
    grader: 'red-flag-recall',
    severity: 'critical',
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `all ${expectedRedFlagIds.length} expected rule hits raised`
        : `MISSING rule hits: ${missing.join(', ')}`,
  }
}

/**
 * No rule hit arrived attributed to the model.
 *
 * A separate check from recall, because the two fail differently. Recall
 * catches a rule that never fired; this catches one that fired and was then
 * re-badged, which would let a suppression bug hide behind a passing recall
 * count.
 */
export function gradeRuleAttribution(
  analysis: ConsultationAnalysis,
  expectedRedFlagIds: readonly string[],
): Finding {
  const misattributed = analysis.redFlags
    .filter((f) => f.source === 'model' && f.ruleId !== undefined)
    .filter((f) => f.ruleId !== undefined && expectedRedFlagIds.includes(f.ruleId))
    .map((f) => f.ruleId)

  return {
    grader: 'rule-attribution',
    severity: 'critical',
    passed: misattributed.length === 0,
    detail:
      misattributed.length === 0
        ? 'no expected rule hit is attributed to the model'
        : `rule hits badged as model output: ${misattributed.join(', ')}`,
  }
}

/**
 * Every citation resolves to an ID in the supplied corpus.
 *
 * **Critical.** ID-constrained citation is what makes a hallucinated medical
 * reference structurally impossible rather than merely unlikely, and it is a
 * property of the whole pipeline rather than of the parser alone. Parse-time
 * validation is the control; this is the end-to-end evidence that the control
 * holds against a real model.
 */
export function gradeCitationValidity(
  analysis: ConsultationAnalysis,
  corpusIds: readonly string[],
): Finding {
  const known = new Set(corpusIds)
  const invalid = analysis.suggestions
    .flatMap((s) => s.citations.map((c) => c.guidelineId))
    .filter((id) => !known.has(id))

  return {
    grader: 'citation-validity',
    severity: 'critical',
    passed: invalid.length === 0,
    detail:
      invalid.length === 0
        ? `all citations resolve (${analysis.suggestions.length} suggestions)`
        : `citations outside the corpus: ${[...new Set(invalid)].join(', ')}`,
  }
}

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** Every assertion in the analysis, flattened with its field id. */
function assertions(analysis: ConsultationAnalysis): { fieldId: string; a: ClinicalAssertion }[] {
  const facts = analysis.clinicalFacts
  if (!facts) return []
  const groups: [string, Record<string, ClinicalAssertion>][] = [
    ['symptoms', facts.symptoms],
    ['history', facts.history],
    ['observations', facts.observations],
    ['examination', facts.examination],
  ]
  return groups.flatMap(([name, group]) =>
    Object.entries(group).map(([key, a]) => ({ fieldId: `${name}.${key}`, a })),
  )
}

/**
 * Every asserted span is verbatim in the transcript.
 *
 * A backstop rather than a discovery: `applyEvidenceCheck` already discards
 * ungrounded assertions in the pipeline, so a healthy run scores 100% here by
 * construction. It is graded anyway because that check is a Tier-2 control,
 * and a control nobody measures end-to-end is a control that can regress
 * quietly. A failure here means the check itself broke, not that the model
 * misbehaved.
 */
export function gradeEvidenceGrounding(
  analysis: ConsultationAnalysis,
  transcript: Transcript,
): Finding {
  const haystack = normalise(transcript.turns.map((t) => t.text).join(' '))
  const ungrounded = assertions(analysis)
    .filter(({ a }) => a.state === 'PRESENT' || a.state === 'DENIED')
    .filter(({ a }) => {
      const span = a.evidence?.trim()
      return !span || !haystack.includes(normalise(span))
    })
    .map(({ fieldId }) => fieldId)

  return {
    grader: 'evidence-grounding',
    severity: 'critical',
    passed: ungrounded.length === 0,
    detail:
      ungrounded.length === 0
        ? 'every asserted span is verbatim in the transcript'
        : `spans not found in the transcript: ${ungrounded.join(', ')}`,
  }
}

/**
 * How much of the fixed checklist the consultation established.
 *
 * **Informational, and must stay that way.** A field the consultation never
 * touched is *correctly* `NOT_ASSESSED`, so there is no target to hit and a
 * higher number is not automatically better. What it is good for is drift: the
 * same fixture scoring materially lower after a prompt or model change means
 * extraction got worse, or the evidence check is discarding more.
 */
export function gradeFactCoverage(analysis: ConsultationAnalysis): Finding {
  const all = assertions(analysis)
  const established = all.filter(({ a }) => a.state !== 'NOT_ASSESSED')

  return {
    grader: 'fact-coverage',
    severity: 'informational',
    passed: true,
    detail:
      all.length === 0
        ? 'no clinical facts returned'
        : `${established.length}/${all.length} checklist fields established`,
  }
}

/** How many candidates the model contributed. Informational: adding is allowed. */
export function gradeModelContribution(analysis: ConsultationAnalysis): Finding {
  const added = analysis.redFlags.filter((f) => f.source === 'model')

  return {
    grader: 'model-contribution',
    severity: 'informational',
    passed: true,
    detail: `${added.length} model-added red-flag candidate(s), ${analysis.gaps.length} gap(s)`,
  }
}

export function gradeAll(
  analysis: ConsultationAnalysis,
  transcript: Transcript,
  expectedRedFlagIds: readonly string[],
  corpusIds: readonly string[],
): Finding[] {
  return [
    gradeRedFlagRecall(analysis, expectedRedFlagIds),
    gradeRuleAttribution(analysis, expectedRedFlagIds),
    gradeCitationValidity(analysis, corpusIds),
    gradeEvidenceGrounding(analysis, transcript),
    gradeFactCoverage(analysis),
    gradeModelContribution(analysis),
  ]
}
