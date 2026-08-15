import { describe, expect, it } from 'vitest'
import { ReasoningFilter } from './index.js'

/**
 * The reasoning filter, tested character by character because its failure mode
 * is silence.
 *
 * A filter that leaks `</think>` prints something odd and someone notices. A
 * filter that gets stuck inside a block eats the entire answer, the panel shows
 * an empty bubble, and it reads as a slow model or a bad connection rather than
 * a bug in our code. So most of these assert that text **survives**.
 */

/** Feeds the text one character at a time, the worst case for tag splitting. */
function drip(input: string): string {
  const filter = new ReasoningFilter()
  let out = ''
  for (const character of input) out += filter.push(character)
  return out + filter.flush()
}

/** Feeds the text in one go. */
function whole(input: string): string {
  const filter = new ReasoningFilter()
  return filter.push(input) + filter.flush()
}

describe('the reasoning filter', () => {
  it('passes ordinary prose through untouched', () => {
    const text = 'Three items need your decision before sign-off.'
    expect(whole(text)).toBe(text)
    expect(drip(text)).toBe(text)
  })

  it('removes a complete reasoning block and keeps the answer', () => {
    const input = '<think>The doctor wants a summary.</think>Here is the summary.'
    expect(whole(input)).toBe('Here is the summary.')
    expect(drip(input)).toBe('Here is the summary.')
  })

  it('drops a stray closing tag with no opener', () => {
    // The shape actually observed against qwen3.7-flash on 15/08/26: reasoning
    // arrives out of band and only the closing tag reaches the content channel.
    const input = '</think>\n\nI have proposed an edit.'
    expect(whole(input)).toBe('\n\nI have proposed an edit.')
    expect(drip(input)).toBe('\n\nI have proposed an edit.')
  })

  it('handles a tag split across chunk boundaries', () => {
    const filter = new ReasoningFilter()
    let out = ''
    for (const part of ['Answer: ', '<thi', 'nk>hidden</thi', 'nk>visible'])
      out += filter.push(part)
    expect(out + filter.flush()).toBe('Answer: visible')
  })

  it('never eats trailing prose that merely starts like a tag', () => {
    // `<` is a legitimate character. Holding it back is correct mid-stream and
    // wrong at the end, which is what `flush` is for.
    expect(whole('Temperature < 38 degrees')).toBe('Temperature < 38 degrees')
    expect(drip('Temperature < 38 degrees')).toBe('Temperature < 38 degrees')
    expect(whole('ends with a bracket <')).toBe('ends with a bracket <')
  })

  it('releases nothing but loses nothing when a block never closes', () => {
    // A truncated response can end mid-reasoning. The held text is genuinely
    // reasoning, so dropping it is right; what must not happen is a crash or a
    // leak of the partial block.
    expect(whole('<think>reasoning that never ends')).toBe('')
  })

  it('keeps text that arrives before an unterminated block', () => {
    expect(whole('Here is the answer.<think>then thinking')).toBe('Here is the answer.')
  })

  it('handles several blocks in one answer', () => {
    expect(whole('a<think>x</think>b<think>y</think>c')).toBe('abc')
    expect(drip('a<think>x</think>b<think>y</think>c')).toBe('abc')
  })

  it('does not treat a similar tag as a reasoning block', () => {
    const input = 'Use <thinking> carefully'
    expect(whole(input)).toBe(input)
  })
})
