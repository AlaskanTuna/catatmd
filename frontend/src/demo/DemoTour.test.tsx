import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOUR_STEP_COUNT, TOUR_STEPS } from './DemoTour.js'

/**
 * The tour's honesty contract (issue #179).
 *
 * The tour's whole argument is that it narrates the real pipeline rather than
 * replaying a script, and `HelpButton` states that to the user before they
 * agree to start. Teaching CatatAI is the change most likely to break that,
 * because the obvious implementation is a canned exchange. These pin the shape
 * that keeps the claim true.
 */

const catatai = TOUR_STEPS.find((step) => step.target === '[data-tour="catatai"]')

describe('the CatatAI step', () => {
  it('exists exactly once, on the anchor the copilot button already carries', () => {
    const matches = TOUR_STEPS.filter((step) => step.target === '[data-tour="catatai"]')
    expect(matches).toHaveLength(1)
  })

  it('is counted by construction rather than by a hand-edited constant', () => {
    // The failure this prevents is a step added to the array while the dialog
    // keeps advertising the old number.
    expect(TOUR_STEP_COUNT).toBe(TOUR_STEPS.length)
  })

  it('says the copilot reads the consultation including the doctor edits', () => {
    expect(catatai?.hint).toMatch(/reads the consultation/i)
    expect(catatai?.hint).toMatch(/your own edits/i)
  })

  it('says the copilot proposes rather than writes', () => {
    expect(catatai?.hint).toMatch(/proposes changes/i)
  })

  /*
   * The claim that distinguishes this product from a scribe. It is the one
   * most likely to be cut for brevity, and cutting it turns the tour into an
   * advertisement for an autonomous note-writer, which this is not.
   */
  it('says the copilot can neither approve a note nor retract a red flag', () => {
    expect(catatai?.hint).toMatch(/never approve a note/i)
    expect(catatai?.hint).toMatch(/retract a red flag/i)
  })

  it('is honest that it is inactive, rather than implying a live copilot', () => {
    expect(catatai?.hint).toMatch(/inactive/i)
    expect(catatai?.hint).toMatch(/not a scripted conversation|never saved/i)
  })

  it('lands before the approval step, so the cannot-approve claim precedes it', () => {
    const catataiAt = TOUR_STEPS.findIndex((step) => step.target === '[data-tour="catatai"]')
    const approveAt = TOUR_STEPS.findIndex((step) => step.target === '[data-tour="approve"]')
    expect(catataiAt).toBeGreaterThanOrEqual(0)
    expect(catataiAt).toBeLessThan(approveAt)
  })

  it('walks a consultation, so the anchor is on a screen the tour reaches', () => {
    expect(catatai?.route).toBe('/consultations/:id')
    expect(catatai?.subject).toBe('flagged')
  })
})

/**
 * A source-scanning tripwire, in the shape the backend uses for invariants the
 * type system cannot express.
 *
 * `HelpButton` promises "Nothing is mocked or replayed" before the user agrees
 * to start. #179 resolved that by keeping the promise true: the tour describes
 * the copilot and shows its real panel inactive, and stages no conversation.
 * If someone later adds a scripted exchange, this test is what makes the
 * promise a deliberate decision rather than something quietly falsified.
 */
describe('the no-mocking promise', () => {
  // Read from the workspace root rather than `import.meta.url`, which is not a
  // file: URL under the jsdom environment this suite runs in.
  const source = readFileSync(resolve(process.cwd(), 'src/demo/HelpButton.tsx'), 'utf8')

  it('is still made to the user before the tour starts', () => {
    expect(source).toContain('Nothing is mocked or replayed.')
  })

  it('is still accompanied by the real-pipeline claim it qualifies', () => {
    expect(source).toMatch(/runs the real pipeline on a simulated transcript/i)
  })
})
