import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LiveConversation } from './LiveConversation.js'
import type { LiveSegment } from './live-tokens.js'

/**
 * The pane must follow the conversation, and must stop following the moment the
 * doctor scrolls up to re-read something.
 *
 * Both halves shipped broken. The scroll effect depended on `pinned` alone, so
 * appended speech never re-ran it: the pane followed once on mount and then
 * froze. The recovery path could not fix it either, because `setPinned(true)`
 * while already `true` is a React bail-out, so "Jump to latest" was unreachable
 * in the state that needed it. There was no test on this file at all.
 */

const SCROLL_HEIGHT = 500
const CLIENT_HEIGHT = 200

function segment(text: string, start: number, speaker: string): LiveSegment {
  return { text, start, end: start + 2, speaker }
}

/**
 * jsdom does no layout, so `scrollHeight` reads 0 and the `scrollTop` setter is
 * inert. Both are shadowed on the instance, and `scrollTo` is recorded too, so
 * the assertions hold whichever of the component's two paths runs.
 */
function instrument(node: HTMLElement) {
  const position = { top: 0 }
  Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT })
  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT })
  Object.defineProperty(node, 'scrollTop', {
    configurable: true,
    get: () => position.top,
    set: (value: number) => {
      position.top = value
    },
  })
  Object.defineProperty(node, 'scrollTo', {
    configurable: true,
    writable: true,
    value: (options: { top: number }) => {
      position.top = options.top
    },
  })
  return position
}

function scroller(container: HTMLElement) {
  const node = container.querySelector('ol')?.parentElement
  if (!node) throw new Error('scroll container not found')
  return node
}

afterEach(cleanup)

describe('LiveConversation', () => {
  const first = [segment('Two weeks of cough.', 0, '1')]
  const second = [...first, segment('Any blood when you cough?', 4, '2')]
  const third = [...second, segment('Once or twice only.', 9, '1')]

  it('follows the newest turn as speech arrives', () => {
    const { container, rerender } = render(
      <LiveConversation segments={first} interim="" interimSpeaker={null} />,
    )
    const position = instrument(scroller(container))

    rerender(<LiveConversation segments={second} interim="" interimSpeaker={null} />)

    expect(position.top).toBe(SCROLL_HEIGHT)
  })

  it('follows when only the unsettled tail is rewritten', () => {
    const { container, rerender } = render(
      <LiveConversation segments={first} interim="" interimSpeaker={null} />,
    )
    const position = instrument(scroller(container))

    rerender(<LiveConversation segments={first} interim="and he went for" interimSpeaker="1" />)

    expect(position.top).toBe(SCROLL_HEIGHT)
  })

  it('stops following once the doctor scrolls up, and offers a way back', () => {
    const { container, rerender } = render(
      <LiveConversation segments={first} interim="" interimSpeaker={null} />,
    )
    const node = scroller(container)
    const position = instrument(node)

    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()

    position.top = 0
    fireEvent.scroll(node)

    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()

    // The patient keeps talking while the doctor is reading further up.
    rerender(<LiveConversation segments={second} interim="" interimSpeaker={null} />)

    expect(position.top).toBe(0)
  })

  it('re-arms following when Jump to latest is pressed', () => {
    const { container, rerender } = render(
      <LiveConversation segments={first} interim="" interimSpeaker={null} />,
    )
    const node = scroller(container)
    const position = instrument(node)

    position.top = 0
    fireEvent.scroll(node)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))

    expect(position.top).toBe(SCROLL_HEIGHT)
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()

    // And it keeps following afterwards, which the bail-out used to prevent.
    // Moved without a scroll event, so the pin stays armed.
    position.top = 123
    rerender(<LiveConversation segments={third} interim="" interimSpeaker={null} />)

    expect(position.top).toBe(SCROLL_HEIGHT)
  })
})
