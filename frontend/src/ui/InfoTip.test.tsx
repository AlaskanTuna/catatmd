import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InfoTip } from './InfoTip.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Puts the trigger at a chosen distance from the left edge of the viewport.
 *
 * jsdom lays nothing out, so every rect is zero and the positioning branch
 * under test can never bind. Stubbing the rect is the only way to reach it from
 * a unit test; the panel's rendered width is still a browser question.
 */
function placeTriggerAt(left: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: 400,
    width: 20,
    height: 20,
    top: 400,
    bottom: 420,
    left,
    right: left + 20,
    toJSON: () => ({}),
  } as DOMRect)
}

async function open(node: React.ReactElement) {
  render(node)
  await act(async () => screen.getByRole('button', { name: 'About this' }).click())
  return screen.getByRole('tooltip') as HTMLElement
}

/*
 * A `layered` tip outside a dialog is positioned against the viewport, and
 * anchoring it to an edge of the trigger does not on its own give it anywhere
 * to go. `max-w-[80vw]` measures the viewport rather than the distance from the
 * trigger to its edge, so a left-anchored panel two thirds of the way across
 * the screen still ran off the side: at 390px the ambient capture tip lost the
 * end of every line (#289).
 *
 * jsdom's viewport is 1024 wide.
 */
describe('a portalled tip', () => {
  it('is bounded by the room it opens into, so it cannot run off the viewport', async () => {
    placeTriggerAt(900)
    const panel = await open(
      <InfoTip label="About this" layered>
        Body copy
      </InfoTip>,
    )

    // Portalled out, because the container it sits in may clip it.
    expect(panel.parentElement).toBe(document.body)
    // 1024 - 900, less the gutter.
    expect(panel.style.maxWidth).toBe('112px')
  })

  it('measures that room leftward when it is anchored right', async () => {
    placeTriggerAt(120)
    const panel = await open(
      <InfoTip label="About this" align="right" layered>
        Body copy
      </InfoTip>,
    )

    // Opens back towards the left edge, so the trigger's right edge is what
    // bounds it: 140, less the gutter.
    expect(panel.style.maxWidth).toBe('128px')
  })

  it('leaves a tip with room to spare at its own width', async () => {
    placeTriggerAt(40)
    const panel = await open(
      <InfoTip label="About this" layered>
        Body copy
      </InfoTip>,
    )

    // Wider than the panel's own `w-72`, so the class still decides and nothing
    // that fits today is narrowed by this bound.
    expect(Number.parseFloat(panel.style.maxWidth)).toBeGreaterThan(288)
  })
})
