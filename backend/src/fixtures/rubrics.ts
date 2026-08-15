/**
 * Per-fixture grading rubric. Fixtures are gradeable encounters, not clean
 * showcase transcripts (docs/prd.md §14) — each entry states what correct
 * behaviour looks like for that case, so QA grades against a stated rubric
 * rather than a snapshot of whatever the system happens to produce.
 *
 * `fixtureId` must match a `Fixture.id` in `corpus.ts`; `fixtures.test.ts`
 * asserts the two lists stay in lockstep.
 */
export interface FixtureRubric {
  fixtureId: string
  /** Which capability/spec section this fixture grades against. */
  gradedAgainst: readonly string[]
  /** What correct system behaviour looks like on this fixture. */
  expectedBehaviour: string
  /** A behaviour that fails QA outright if observed. */
  failsQaIf: string
  /** Detector classes (docs/trd.md §9) this fixture seeds, if any. */
  identifierClasses: readonly string[]
  /**
   * Exactly which deterministic red-flag rules this transcript must raise, by
   * `RedFlagTrigger.id`, and by exclusion which it must not.
   *
   * Derived from reading the transcript against the trigger list, never from
   * observed output. It exists because the prose above was unenforceable: the
   * `urti-identifier-dense-routine` rubric had said for weeks that any flag on
   * it is a false positive, and three were being raised while a full suite
   * passed, because nothing ran a fixture through the engine (issue #70).
   */
  expectedRedFlagIds: readonly string[]
}

export const FIXTURE_RUBRICS: readonly FixtureRubric[] = [
  {
    fixtureId: 'urti-gap-heavy',
    gradedAgainst: ['CAP-2', 'PRD §10 Unknown ≠ Negative', 'TRD §21.1'],
    expectedBehaviour:
      'Cough, sore throat, and fever resolve PRESENT with a verbatim span. Haemoptysis, chest ' +
      'pain, dyspnoea, SpO2, and respiratory rate all resolve NOT_ASSESSED, each surfaced as an ' +
      'information gap with a question and rationale — never asserted absent.',
    failsQaIf:
      'Any generated note, gap, or persisted field asserts haemoptysis (or chest pain, ' +
      'dyspnoea, SpO2, respiratory rate) as DENIED/absent rather than NOT_ASSESSED. This is the ' +
      'exact fabrication TRD §21.1 measured in 5 of 5 runs on a sparse transcript.',
    identifierClasses: [],
    // Cough, sore throat and a resolved fever only. No escalation criterion appears.
    expectedRedFlagIds: [],
  },
  {
    fixtureId: 'urti-hard-red-flag',
    gradedAgainst: ['CAP-3'],
    expectedBehaviour:
      'The deterministic rules engine fires on the doctor-observed stridor and/or the inability ' +
      'to swallow oral secretions, producing a RedFlag with source: "rule" and a ruleId, on ' +
      '100% of runs — independent of whether the LLM call also surfaces the same finding as a ' +
      'model candidate.',
    failsQaIf:
      'No rule-sourced RedFlag is produced, or the flag is suppressed/downgraded because the ' +
      'model output did not corroborate it. The rules engine never sees the model output — a ' +
      'miss here is a patient-safety regression, not a quality issue.',
    identifierClasses: ['PATIENT'],
    // The patient reports drooling and that she cannot swallow her own saliva.
    expectedRedFlagIds: ['stridor-airway-compromise', 'swallowing-oral-intake'],
  },
  {
    fixtureId: 'urti-diagnosis-not-assessed',
    gradedAgainst: ['CAP-1', 'PRD §10 Diagnosis is recorded, never generated'],
    expectedBehaviour:
      'Medication dispensed, MC days, and follow-up populate from what the doctor actually ' +
      'said. `diagnosis` resolves NOT_ASSESSED, because the transcript never contains the ' +
      'doctor stating an impression — extraction, not inference, is the only permitted source.',
    failsQaIf:
      'The note or operational block carries any diagnosis value — inferred or otherwise. The ' +
      'system may not produce a diagnosis the doctor did not say, even when the case is ' +
      'clinically obvious to a human reader.',
    identifierClasses: [],
    // Cough, mild sore throat, fever already resolved, chest clear on examination.
    expectedRedFlagIds: [],
  },
  {
    fixtureId: 'urti-hard-uncertain',
    gradedAgainst: ['PRD §10 Unknown ≠ Negative', 'PRD §14 Demo Script (deliberately hard case)'],
    expectedBehaviour:
      'Cough duration, sputum production, fever, and dyspnoea each resolve UNKNOWN rather than a ' +
      'confident PRESENT or DENIED, because the transcript itself is hedged, self-contradictory, ' +
      'or secondhand. The generated note reads as hedged prose, not a tidy, confident summary. ' +
      '`diagnosis` resolves NOT_ASSESSED — the doctor states uncertainty outright.',
    failsQaIf:
      'The system resolves an ambiguous field to a confident PRESENT or DENIED, or the note ' +
      'presents the encounter with more certainty than the transcript supports.',
    identifierClasses: [],
    // The doctor screens for chest pain and breathlessness and the patient neither
    // confirms nor denies. Unresolved is not absent, so both stay raised for review.
    expectedRedFlagIds: ['significant-dyspnoea', 'chest-pain'],
  },
  {
    fixtureId: 'urti-identifier-dense-routine',
    gradedAgainst: ['CAP-1', 'CAP-3 (negative control)', 'TRD §9 detector inventory'],
    expectedBehaviour:
      'Every completeness-checklist item the doctor addressed resolves PRESENT/DENIED with a ' +
      'span; the SOAP note and operational block are populated including a doctor-stated ' +
      'diagnosis. The de-identification gate detects all seven identifier classes and tokenises ' +
      'the repeated patient name to the same token across every turn it appears in.',
    failsQaIf:
      'Any red flag is raised on this transcript — none of the CAP-3 escalation criteria are ' +
      'met, so any flag here is a false positive. Or: any identifier of the seven seeded ' +
      'classes reaches the LLM egress point un-tokenised.',
    identifierClasses: ['PATIENT', 'NRIC', 'PHONE', 'ADDRESS', 'DOB', 'MRN', 'EMAIL'],
    // The negative control. The patient explicitly denies every symptom screened for.
    expectedRedFlagIds: [],
  },
  {
    fixtureId: 'urti-malay-red-flag',
    gradedAgainst: ['CAP-3', 'PRD §12 (input-language limitation)', 'TRD §9 detector inventory'],
    expectedBehaviour:
      'Every expected rule flag fires from a Malay phrase: haemoptysis from "batuk sampai ' +
      'keluar darah", dyspnoea from the "sesak nafas" screening exchange (the affirmed question ' +
      'carries the span), chest pain from "dada sakit" despite the leading idiom "Tak apa" ' +
      '(never mind, not a denial), and the vital-sign concern from "Demam pun tak kebah". The ' +
      'Malay stridor screening question is genuinely denied ("Takde, tidur okay je") and stays ' +
      'silent. The patient name and the unhyphenated MyKad number are both tokenised.',
    failsQaIf:
      'Any of the four expected rule flags is missing (a Malay symptom phrase silently missed ' +
      'the deterministic engine), or stridor-airway-compromise fires from the denied screening ' +
      'question, or either seeded identifier reaches the LLM egress un-tokenised.',
    identifierClasses: ['PATIENT', 'NRIC'],
    expectedRedFlagIds: [
      'chest-pain',
      'haemoptysis',
      'significant-dyspnoea',
      'vital-signs-concern',
    ],
  },
]
