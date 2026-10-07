import { describe, expect, it } from 'vitest'
import { tooltipTop } from './Spotlight.js'

/**
 * The walkthrough card must always sit fully inside the viewport, or its Next
 * button goes off-screen mid-demo (found in prod e2e, 08/10).
 */
const VIEWPORT = 900
const CARD = 230
const inside = (top: number) => top >= 16 && top + CARD <= VIEWPORT - 16

describe('tooltipTop', () => {
  it('goes below a short target near the top', () => {
    expect(tooltipTop({ top: 100, bottom: 160 }, CARD, VIEWPORT)).toBe(174)
  })

  it('goes above a target near the bottom', () => {
    const top = tooltipTop({ top: 700, bottom: 760 }, CARD, VIEWPORT)
    expect(top + CARD).toBeLessThanOrEqual(700)
    expect(inside(top)).toBe(true)
  })

  it.each([
    ['a list taller than the viewport', { top: 80, bottom: 1400 }],
    ['a target scrolled partly above the top', { top: -200, bottom: 1100 }],
    ['a target filling the viewport', { top: 20, bottom: 880 }],
    ['a target ending just above the card space', { top: 400, bottom: 760 }],
  ])('stays inside the viewport for %s', (_case, target) => {
    expect(inside(tooltipTop(target, CARD, VIEWPORT))).toBe(true)
  })

  it('never goes above the top edge, even on a tiny viewport', () => {
    expect(tooltipTop({ top: 50, bottom: 600 }, CARD, 200)).toBe(16)
  })
})
