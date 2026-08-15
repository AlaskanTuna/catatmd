import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown.js'

/**
 * CatatAI's answers, formatted.
 *
 * Two things are being checked and they are not the same thing. The first is
 * ordinary: markdown the model emits should reach the doctor as formatting
 * rather than as punctuation, which is the bug this component fixes.
 *
 * The second is the reason this file is not merely a rendering test. The text
 * passing through here originates in a consultation transcript, which is
 * untrusted input, and it arrives having been round-tripped through a language
 * model. `.claude/rules/security.md` holds the frontend to zero occurrences of
 * `dangerouslySetInnerHTML` repo-wide; these pin the consequence of that rule
 * at the one place where a string is turned into a tree.
 */

afterEach(cleanup)

describe('formatting the answer', () => {
  it('renders bold as emphasis rather than as asterisks', () => {
    render(<Markdown>{'The **plan** is missing a safety net.'}</Markdown>)

    expect(screen.getByText('plan').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('renders a bulleted list as list items', () => {
    render(<Markdown>{'Outstanding:\n\n- No red flags acknowledged\n- Plan is empty'}</Markdown>)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders a numbered list as an ordered list', () => {
    render(<Markdown>{'1. Ask about fever\n2. Record the duration'}</Markdown>)

    expect(screen.getByRole('list').tagName).toBe('OL')
  })

  it('sets a guideline id apart as code', () => {
    // The prompt asks the model to refer to ids in backticks so the doctor can
    // find the thing on screen. That only helps if they are actually set apart.
    render(<Markdown>{'See `urti-nag-2024-01` for the antibiotic threshold.'}</Markdown>)

    expect(screen.getByText('urti-nag-2024-01').tagName).toBe('CODE')
  })

  it('leaves a half-arrived bold alone until the rest of it streams in', () => {
    // Mid-stream the answer is not valid markdown yet. It must render as the
    // literal characters rather than swallowing the tail of the sentence.
    render(<Markdown>{'The **plan'}</Markdown>)

    expect(screen.getByText(/\*\*plan/)).toBeTruthy()
  })
})

describe('what markdown is not allowed to become', () => {
  it('does not turn HTML in the answer into elements', () => {
    // The transcript is untrusted and the model is not a sanitiser. Raw HTML
    // must reach the doctor as text, which is what dropping `rehype-raw` buys.
    const { container } = render(
      <Markdown>{'Patient said <img src=x onerror=alert(1)> during the visit.'}</Markdown>,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('refuses a javascript: link and keeps its text', () => {
    const { container } = render(<Markdown>{'[click here](javascript:alert(1))'}</Markdown>)

    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('click here')).toBeTruthy()
  })

  it('allows an ordinary https link, and opens it detached from this tab', () => {
    render(<Markdown>{'[MOH guidance](https://example.gov.my/urti)'}</Markdown>)

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://example.gov.my/urti')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
