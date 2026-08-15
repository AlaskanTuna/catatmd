import type { ConsultationDetail } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { MAX_DIGEST_CHARS, renderDigest } from './digest.js'

/**
 * The digest is the copilot's entire view of a consultation, and it is rebuilt
 * per turn. Two properties matter more than its wording:
 *
 * 1. **Order is stable.** The rendered text is de-identified downstream and
 *    `RequestTokenVault` numbers tokens by first appearance, so a digest that
 *    assembled the same facts in a different order would silently hand the
 *    model `[PATIENT_1]` meaning two different people across two turns.
 * 2. **The doctor's edits win.** A copilot discussing the generated draft
 *    after the doctor has rewritten it is the failure this feature exists to
 *    avoid.
 */

/** Synthetic throughout. No real patient data, per AGENTS.md. */
function consultation(overrides: Partial<ConsultationDetail> = {}): ConsultationDetail {
  return {
    id: 'c1',
    status: 'analysed',
    createdAt: new Date('2026-08-15T00:00:00Z'),
    updatedAt: new Date('2026-08-15T00:00:00Z'),
    approvedAt: null,
    approvedBy: null,
    editedNote: null,
    acknowledgedRedFlagIds: [],
    reviewedGapIds: [],
    redFlagDispositions: [],
    gapDispositions: [],
    transcript: {
      source: 'paste',
      turns: [
        { speaker: 'doctor', text: 'What brings you in?' },
        { speaker: 'patient', text: 'Cough for three days.' },
      ],
    },
    analysis: {
      note: {
        subjective: 'Three-day cough.',
        objective: 'Throat mildly injected.',
        assessment: 'Likely viral URTI.',
        plan: 'Symptomatic care.',
      },
      gaps: [],
      redFlags: [],
      suggestions: [],
    },
    ...overrides,
  } as ConsultationDetail
}

describe('the copilot digest', () => {
  it('renders the same text twice for the same consultation', () => {
    // The token-stability property, asserted directly. Object key order in the
    // checklist walk and array order everywhere else must not vary run to run.
    const detail = consultation()

    expect(renderDigest(detail)).toBe(renderDigest(detail))
  })

  it('shows the doctor edited note rather than the generated draft', () => {
    const detail = consultation({
      editedNote: {
        subjective: 'Doctor rewrote this.',
        objective: '',
        assessment: '',
        plan: '',
      },
    })

    const digest = renderDigest(detail)

    expect(digest).toContain('Doctor rewrote this.')
    expect(digest).not.toContain('Three-day cough.')
    expect(digest).toContain('The doctor has edited this note')
  })

  it('says the note is a draft when the doctor has not touched it', () => {
    expect(renderDigest(consultation())).toContain('has not edited it')
  })

  it('marks an empty note section rather than omitting it', () => {
    // An omitted section reads to the model as "not applicable"; an explicit
    // "(empty)" reads as "nothing written yet", which is what it means and is
    // the thing worth prompting the doctor about.
    const detail = consultation({
      editedNote: { subjective: 'x', objective: '', assessment: '   ', plan: 'y' },
    })

    const digest = renderDigest(detail)

    expect(digest).toContain('objective: (empty)')
    expect(digest).toContain('assessment: (empty)')
  })

  it('carries every red flag with the decision the doctor recorded', () => {
    const detail = consultation({
      analysis: {
        ...consultation().analysis,
        redFlags: [
          { id: 'rf-1', label: 'Haemoptysis', severity: 'urgent', source: 'rule', ruleId: 'r1' },
          { id: 'rf-2', label: 'Chest pain', severity: 'advisory', source: 'model' },
        ],
      } as ConsultationDetail['analysis'],
      redFlagDispositions: [
        { id: 'rf-1', state: 'dismissed', reason: 'Resolved on review', decidedAt: new Date() },
      ],
    })

    const digest = renderDigest(detail)

    expect(digest).toContain('[rf-1] URGENT (rule): Haemoptysis')
    expect(digest).toContain('dismissed, reason: Resolved on review')
    expect(digest).toContain('[rf-2] ADVISORY (model): Chest pain')
    expect(digest).toContain('no decision yet')
  })

  it('states plainly when an approved note can no longer be edited', () => {
    // The copilot must not offer an edit on a finalised record, and the only
    // thing stopping it is knowing. Approval is a one-way transition.
    const detail = consultation({
      approvedAt: new Date('2026-08-15T10:00:00Z'),
      approvedBy: 'Dr Tan',
      status: 'approved',
    })

    const digest = renderDigest(detail)

    expect(digest).toContain('APPROVED on 2026-08-15 by Dr Tan')
    expect(digest).toContain('cannot be edited')
  })

  it('truncates a runaway transcript and says that it did', () => {
    // TranscriptSchema has no length bound, so the 1 MB body limit is the only
    // one. A silent trim would leave the copilot confidently answering about a
    // consultation it only partly read.
    const detail = consultation({
      transcript: {
        source: 'paste',
        turns: [{ speaker: 'patient', text: 'a'.repeat(40_000) }],
      },
    } as Partial<ConsultationDetail>)

    const digest = renderDigest(detail)

    expect(digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS + 200)
    expect(digest).toContain('Transcript truncated for length')
  })

  it('never claims a section is absent when the consultation has no analysis', () => {
    const detail = consultation({ analysis: null } as Partial<ConsultationDetail>)

    const digest = renderDigest(detail)

    expect(digest).toContain('No note has been generated yet.')
    expect(digest).toContain('No red flags were raised.')
    expect(digest).toContain('No completeness checklist yet.')
  })
})
