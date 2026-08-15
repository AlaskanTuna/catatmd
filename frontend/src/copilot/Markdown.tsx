import type { ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * CatatAI's answers, rendered rather than printed.
 *
 * The system prompt has always told the model markdown was supported, and the
 * panel was showing the raw characters, so a doctor read `**resolve the gap**`
 * with the asterisks in it. This closes that gap at the rendering end rather
 * than by telling the model to stop, which is the wrong end: markdown is the
 * right output for a list of findings, and a language model will produce it
 * whatever the prompt says.
 *
 * **Why `react-markdown` rather than a small hand-rolled formatter.** The text
 * being formatted derives from a consultation transcript, which is untrusted
 * input, and the one repo-wide frontend rule that matters here is that there
 * are zero occurrences of `dangerouslySetInnerHTML` (`.claude/rules/security.md`).
 * `react-markdown` builds React elements from an AST and never touches
 * `innerHTML`, so markup in the source cannot become markup on the page; raw
 * HTML in the source is dropped because `rehype-raw` is deliberately not
 * installed. A regex formatter that assembled HTML strings would reintroduce
 * exactly the sink this codebase does not have. It also keeps the page inside
 * the SPA's CSP, which allows no inline script.
 *
 * Rendered mid-stream as well as after it, so a half-arrived `**` prints
 * literally for a moment and then resolves. That is correct: the alternative
 * is buffering the answer until it completes, which throws away the streaming.
 */

/**
 * Link destinations are the one place markdown can still carry a scheme.
 *
 * `react-markdown` already refuses `javascript:` and friends through its
 * default URL transform; this narrows further to the two schemes a clinical
 * citation could legitimately use, because nothing in the guideline corpus
 * needs `data:` or `blob:` and an anchor is not worth the argument.
 */
function safeUrl(url: string): string {
  return /^(https?:|#|\/)/i.test(url) ? url : ''
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-2">{children}</p>,

  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-muted line-through">{children}</del>,

  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-4 marker:text-ink-muted">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-4 marker:text-ink-muted">{children}</ol>
  ),
  // Paragraphs nested in a list item are unwrapped by the `p` rule's top
  // margin, which would otherwise push the first line off its own bullet.
  li: ({ children }) => <li className="[&>p:first-child]:mt-0">{children}</li>,

  /*
   * Inline code carries the bracketed ids the prompt asks the model to use, so
   * it is load-bearing rather than decoration: `[urti-nag-2024-01]` set apart
   * from prose is how the doctor finds the thing on screen.
   */
  code: ({ children, className }: ComponentProps<'code'>) => {
    const fenced = typeof className === 'string' && className.includes('language-')
    if (fenced) return <code className="font-mono text-[0.85em]">{children}</code>
    return (
      <code className="rounded-[4px] bg-sunken px-1 py-px font-mono text-[0.85em] text-ink">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-card bg-sunken p-2.5 text-ink text-xs">
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-line border-l-2 pl-2.5 text-ink-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="mt-3 mb-1 border-line" />,

  a: ({ children, href }) => {
    const url = safeUrl(String(href ?? ''))
    if (!url) return <>{children}</>
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent-hover"
      >
        {children}
      </a>
    )
  },

  /*
   * The prompt asks for no headings, so these are a fallback rather than a
   * design. All four levels render at one size: a heading hierarchy inside a
   * 24rem bubble is a hierarchy nobody can see, and the useful part is only
   * that the line reads as a label.
   */
  h1: ({ children }) => <p className="mt-3 font-semibold text-ink">{children}</p>,
  h2: ({ children }) => <p className="mt-3 font-semibold text-ink">{children}</p>,
  h3: ({ children }) => <p className="mt-3 font-semibold text-ink">{children}</p>,
  h4: ({ children }) => <p className="mt-3 font-semibold text-ink">{children}</p>,

  // GFM tables are discouraged in the prompt and still possible. The wrapper
  // scrolls rather than letting a wide one stretch the panel.
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-line border-b px-2 py-1 font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => <td className="border-line/60 border-b px-2 py-1">{children}</td>,
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  )
}
