import type { ConsultationDetail } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk, StreamRequest } from '../lib/llm/types.js'

/**
 * The copilot's de-identification boundary, which is the part of this feature
 * that would fail silently.
 *
 * A leak here does not throw, does not fail a schema, and does not look wrong
 * in the panel: the doctor sees the patient's real name in an answer, which is
 * exactly what they expect to see, because the rehydration they cannot
 * distinguish from a leak is the whole design. So these tests assert on what
 * reached the *provider*, not on what reached the doctor.
 */

let captured: StreamRequest | null = null
let chunks: StreamChunk[] = []

const stream = vi.fn((request: StreamRequest) => {
  captured = request
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
})

vi.mock('../lib/llm/index.js', () => ({
  getLLMClient: () => ({ provider: 'qwen', model: 'test-model', generate: vi.fn(), stream }),
  LLMResponseError: class extends Error {},
}))

const { runCopilotTurn } = await import('./index.js')

/** Synthetic. The NRIC is structurally valid but invented, per AGENTS.md. */
const PATIENT = 'Siti Nurhaliza'

function consultation(): ConsultationDetail {
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
        { speaker: 'doctor', text: `Good morning ${PATIENT}, what brings you in?` },
        { speaker: 'patient', text: 'Cough for three days.' },
      ],
    },
    analysis: {
      note: { subjective: `${PATIENT} reports a cough.`, objective: '', assessment: '', plan: '' },
      gaps: [],
      redFlags: [],
      suggestions: [],
    },
  } as unknown as ConsultationDetail
}

async function drain(message = 'Summarise this consultation.', detail = consultation()) {
  const out = []
  for await (const chunk of runCopilotTurn({
    consultation: detail,
    message,
    history: [],
  })) {
    out.push(chunk)
  }
  return out
}

beforeEach(() => {
  captured = null
  chunks = []
  stream.mockClear()
})

describe('what reaches the provider', () => {
  it('never sends the patient name in the digest', async () => {
    chunks = [{ type: 'text', text: 'ok' }]

    await drain()

    expect(captured?.system).not.toContain(PATIENT)
    expect(captured?.system).toContain('[PATIENT_1]')
  })

  it('de-identifies the doctor typed message too', async () => {
    // The operator is as able to type a name into a chat box as anywhere else,
    // and a boundary that trusted them would not be one.
    chunks = [{ type: 'text', text: 'ok' }]

    await drain(`Did I document ${PATIENT}'s fever?`)

    const sent = captured?.turns.at(-1)?.content ?? ''
    expect(sent).not.toContain(PATIENT)
    expect(sent).toMatch(/\[PATIENT_\d+\]/)
  })

  it('gives the same person the same token in the digest and the question', async () => {
    // One vault across the whole turn. Two vaults would number independently
    // and the model would read two different people where there is one.
    chunks = [{ type: 'text', text: 'ok' }]

    await drain(`What did ${PATIENT} say about the cough?`)

    const digestToken = /\[PATIENT_(\d+)\]/.exec(captured?.system ?? '')?.[1]
    const questionToken = /\[PATIENT_(\d+)\]/.exec(captured?.turns.at(-1)?.content ?? '')?.[1]
    expect(digestToken).toBeDefined()
    expect(questionToken).toBe(digestToken)
  })

  it('mints a second token for a possessive, which is a known quality gap', async () => {
    // Recorded rather than fixed. `Siti Nurhaliza` and `Siti Nurhaliza's` match
    // as different spans, so the vault keys them separately and one person
    // arrives at the model as two tokens. Nothing leaks, which is why this is a
    // quality bug and not a safety one: the answer may read as though two
    // people were discussed.
    //
    // Deliberately not fixed here. The span logic lives in `deid/detectors.ts`,
    // the most safety-critical module in the system, where a widened name span
    // has already once swallowed surrounding prose. Changing it as a side
    // effect of shipping a copilot is the wrong way to touch it, and there is
    // already an open issue in that area. This test pins current behaviour so
    // the fix has something to flip.
    chunks = [{ type: 'text', text: 'ok' }]

    await drain(`Did I document ${PATIENT}'s fever?`)

    const digestToken = /\[PATIENT_(\d+)\]/.exec(captured?.system ?? '')?.[1]
    const questionToken = /\[PATIENT_(\d+)\]/.exec(captured?.turns.at(-1)?.content ?? '')?.[1]
    expect(questionToken).not.toBe(digestToken)
  })

  it('re-gates conversation history rather than trusting what the client returns', async () => {
    // The client holds rehydrated text, which is right for display and wrong to
    // send back raw. A replayed turn that skipped the gate would be an egress.
    chunks = [{ type: 'text', text: 'ok' }]

    const out = []
    for await (const chunk of runCopilotTurn({
      consultation: consultation(),
      message: 'And now?',
      history: [{ role: 'copilot', content: `${PATIENT} has a three-day cough.` }],
    })) {
      out.push(chunk)
    }

    const replayed = captured?.turns.find((turn) => turn.role === 'assistant')?.content ?? ''
    expect(replayed).not.toContain(PATIENT)
    expect(replayed).toContain('[PATIENT_1]')
  })
})

describe('what reaches the doctor', () => {
  it('rehydrates the answer so the doctor never sees a token', async () => {
    chunks = [{ type: 'text', text: '[PATIENT_1] has had a cough for three days.' }]

    const out = await drain()

    expect(out).toContainEqual({
      type: 'token',
      text: `${PATIENT} has had a cough for three days.`,
    })
  })

  it('rehydrates inside tool arguments, not just prose', async () => {
    // A proposal is text the doctor writes to the clinical record. A `[PATIENT_1]`
    // surviving into it is worse than the leak tokens exist to prevent: it is a
    // corrupted note that looks deliberate.
    chunks = [
      {
        type: 'tool',
        name: 'edit_note_section',
        args: {
          section: 'subjective',
          text: '[PATIENT_1] reports a three-day cough.',
          rationale: 'Tightening the wording.',
        },
      },
    ]

    const out = await drain()
    const proposal = out.find((chunk) => chunk.type === 'proposal')

    expect(proposal).toMatchObject({
      proposal: { text: `${PATIENT} reports a three-day cough.` },
    })
  })

  it('announces a tool once, before its proposal', async () => {
    chunks = [
      {
        type: 'tool',
        name: 'edit_note_section',
        args: { section: 'plan', text: 'Review in 3 days.', rationale: 'Safety net.' },
      },
    ]

    const types = (await drain()).map((chunk) => chunk.type)

    expect(types).toEqual(['tool', 'proposal'])
  })

  it('drops a tool call the model invented without losing the prose', async () => {
    chunks = [
      { type: 'text', text: 'Here is a summary.' },
      { type: 'tool', name: 'approve_consultation', args: {} },
    ]

    const out = await drain()

    expect(out.filter((chunk) => chunk.type === 'proposal')).toEqual([])
    expect(out.filter((chunk) => chunk.type === 'token')).toHaveLength(1)
  })
})

/**
 * The copilot on a signed note.
 *
 * Approval is terminal: `PATCH /api/consultations/:id` refuses an approved
 * record, so a proposal card produced here is one the doctor could click and
 * watch fail. The panel stays, because the questions a doctor asks about a note
 * do not stop being worth asking once they have signed it. The tools are what
 * goes away.
 *
 * These assert on the **request**, not on the answer, for the same reason as
 * the boundary tests above: a copilot told not to propose but handed the tools
 * anyway reads as correct right up until the day it uses one.
 */
describe('a signed note', () => {
  function signed(): ConsultationDetail {
    return {
      ...consultation(),
      status: 'approved',
      approvedAt: new Date('2026-08-15T02:00:00Z'),
      approvedBy: 'Dr Tan',
    } as unknown as ConsultationDetail
  }

  it('offers the model no tools at all', async () => {
    chunks = [{ type: 'text', text: 'ok' }]

    await drain('Add a safety net to the plan.', signed())

    expect(captured?.tools).toEqual([])
  })

  it('still offers all three on a note that is not signed', async () => {
    // The guard above only means something if the ordinary path is unchanged.
    // A condition inverted by a later edit would otherwise satisfy both.
    chunks = [{ type: 'text', text: 'ok' }]

    await drain('Add a safety net to the plan.')

    expect(captured?.tools).toHaveLength(3)
  })

  it('tells the model the record is final rather than letting it discover it', async () => {
    // A model that believes it can propose and finds no tool narrates the
    // proposal in prose instead, which is the false-completion failure the
    // hard rules were rewritten to stop.
    chunks = [{ type: 'text', text: 'ok' }]

    await drain('Change the plan.', signed())

    expect(captured?.system).toMatch(/signed off, and nothing about it can change/i)
    expect(captured?.system).not.toMatch(/proposal card/i)
  })

  it('still sends the consultation, because reading is what is left', async () => {
    chunks = [{ type: 'text', text: 'ok' }]

    await drain('Why was this flagged?', signed())

    expect(captured?.system).toContain('[PATIENT_1]')
    expect(captured?.system).not.toContain(PATIENT)
  })
})
