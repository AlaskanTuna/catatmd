import { describe, expect, it } from 'vitest'
import { COPILOT_TOOLS, TOOL_LABELS, toProposal } from './tools.js'

/**
 * The copilot's capability surface, pinned.
 *
 * Most of these assert what the copilot **cannot** do, which is unusual for a
 * test suite and is the point. The clinical-safety guarantees of this feature
 * are absences: no tool approves a note, no tool retracts a red flag, no tool
 * writes anything at all. An absence has no code to review, so it regresses by
 * someone helpfully adding a tool rather than by someone changing one, and the
 * only thing that catches that is a test that counts.
 */

const NAMES = COPILOT_TOOLS.map((tool) => tool.name).sort()

describe('the copilot tool surface', () => {
  it('exposes exactly the three proposal tools and nothing else', () => {
    // A fourth tool is not automatically wrong, but it is a clinical-safety
    // decision rather than an implementation detail, and it should fail here
    // so it reaches a reviewer instead of shipping quietly.
    expect(NAMES).toEqual(['edit_note_section', 'set_gap_disposition', 'set_red_flag_disposition'])
  })

  it('offers no tool that could approve a note', () => {
    // Sign-off is the doctor's explicit state transition (AGENTS.md). A model
    // must have no path to it, not merely be instructed away from it, and no
    // permission dialog would make one acceptable.
    expect(NAMES.filter((name) => /approve|sign|finali[sz]e|complete/i.test(name))).toEqual([])
  })

  it('offers no tool that could remove or downgrade a red flag', () => {
    // Setting a disposition is a decision *about* a flag and leaves it on the
    // record. Deleting or downgrading one is the suppression path `mergeRedFlags`
    // exists to close, and must have no tool at all.
    expect(
      NAMES.filter((name) => /delete|remove|suppress|downgrade|hide|clear/i.test(name)),
    ).toEqual([])
  })

  it('tells the model a disposition never removes the flag', () => {
    // The wording is what the model reasons from. "Dismissed" is close enough to
    // "deleted" that a loose description invites it to tell the doctor the flag
    // has gone away.
    const description = COPILOT_TOOLS.find(
      (t) => t.name === 'set_red_flag_disposition',
    )?.description
    expect(description).toMatch(/never removes/i)
    expect(description).toMatch(/stays on the record/i)
  })

  it('tells the model not to author a dismissal justification', () => {
    for (const name of ['set_red_flag_disposition', 'set_gap_disposition']) {
      expect(COPILOT_TOOLS.find((t) => t.name === name)?.description).toMatch(
        /do not write a justification|doctor supplies it/i,
      )
    }
  })

  it('gives every tool a label for the panel, so none renders as a bare name', () => {
    for (const name of NAMES) {
      expect(TOOL_LABELS[name as keyof typeof TOOL_LABELS]).toBeTruthy()
    }
  })

  it('emits argument schemas the provider can consume', () => {
    for (const tool of COPILOT_TOOLS) {
      expect(tool.parameters).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(40)
    }
  })
})

describe('turning a tool call into a proposal', () => {
  it('accepts a well-formed note edit', () => {
    const proposal = toProposal('edit_note_section', {
      section: 'plan',
      text: 'Review in 3 days if not improving.',
      rationale: 'The doctor asked for a safety-net instruction.',
    })

    expect(proposal).toEqual({
      tool: 'edit_note_section',
      section: 'plan',
      text: 'Review in 3 days if not improving.',
      rationale: 'The doctor asked for a safety-net instruction.',
    })
  })

  it('rejects a section outside the four SOAP headings', () => {
    expect(
      toProposal('edit_note_section', {
        section: 'diagnosis',
        text: 'x',
        rationale: 'y',
      }),
    ).toBeNull()
  })

  it('rejects a tool name the model invented', () => {
    // The model can emit any string here. Nothing downstream should dispatch on
    // it without this check.
    expect(toProposal('approve_consultation', { anything: true })).toBeNull()
    expect(toProposal('delete_red_flag', { redFlagId: 'rf-1' })).toBeNull()
  })

  it('rejects a proposal missing its rationale', () => {
    // The rationale is what the doctor reads to decide. A proposal without one
    // is a change they would be approving blind.
    expect(
      toProposal('set_red_flag_disposition', { redFlagId: 'rf-1', state: 'acknowledged' }),
    ).toBeNull()
  })

  it('rejects a disposition state outside the three the record allows', () => {
    expect(
      toProposal('set_gap_disposition', { gapId: 'g-1', state: 'deleted', rationale: 'x' }),
    ).toBeNull()
  })

  it('accepts a proposed dismissal but strips any reason the model wrote', () => {
    // The model may open the dialog. It may not write the justification for
    // discarding a safety signal: that travels on CopilotApplyRequest, typed by
    // the doctor. A model-authored reason must not survive this boundary.
    const proposal = toProposal('set_red_flag_disposition', {
      redFlagId: 'rf-1',
      state: 'dismissed',
      rationale: 'The doctor said this was addressed.',
      reason: 'Not clinically relevant in this case.',
    })

    expect(proposal).toEqual({
      tool: 'set_red_flag_disposition',
      redFlagId: 'rf-1',
      state: 'dismissed',
      rationale: 'The doctor said this was addressed.',
    })
    expect(proposal).not.toHaveProperty('reason')
  })

  it('rejects arguments that are not an object at all', () => {
    expect(toProposal('set_gap_disposition', null)).toBeNull()
    expect(toProposal('set_gap_disposition', 'gap-1')).toBeNull()
  })

  it('drops any extra field the model attached', () => {
    // A model that adds `applied: true` must not have it survive into anything
    // downstream that might read it as state.
    const proposal = toProposal('set_gap_disposition', {
      gapId: 'gap-1',
      state: 'acknowledged',
      rationale: 'Doctor confirmed this was covered verbally.',
      applied: true,
    })

    expect(proposal).toEqual({
      tool: 'set_gap_disposition',
      gapId: 'gap-1',
      state: 'acknowledged',
      rationale: 'Doctor confirmed this was covered verbally.',
    })
  })
})
