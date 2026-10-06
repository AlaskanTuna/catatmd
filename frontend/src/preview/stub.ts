import { createPreviewBackend } from './backend.js'

/**
 * Pull request previews run against this instead of the API (`VITE_PREVIEW_STUB`).
 *
 * **Every `/api/` path is answered here and none reaches the network**, matched
 * on the pathname whatever the origin, so a stray absolute `VITE_API_URL` is
 * caught as surely as a relative call. A route the stub does not know answers
 * 501 rather than falling through. Everything else, fonts and model files
 * among it, goes to the real fetch untouched.
 *
 * State lives in this closure and nowhere else. No web storage, by the same
 * rule that keeps clinical content out of it everywhere in the SPA, so a reload
 * is a fresh preview.
 *
 * The marker is what CI greps the built bundle for: present in a preview
 * build, absent from production, which proves this module was tree-shaken out.
 */
export const PREVIEW_MARKER = 'catatmd-preview-stub'

const BADGE_TEXT = 'Preview · Synthetic Data, Stub Backend'

/** Only JSON bodies are read: the routes taking audio answer before looking at it. */
async function readJson(input: RequestInfo | URL, init: RequestInit | undefined): Promise<unknown> {
  const text =
    typeof init?.body === 'string'
      ? init.body
      : input instanceof Request && init?.body === undefined
        ? await input.clone().text()
        : ''
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function mountBadge(): HTMLElement {
  const badge = document.createElement('div')
  badge.dataset.previewStub = PREVIEW_MARKER
  badge.dataset.print = 'hide'
  badge.textContent = BADGE_TEXT
  // Below the sidebar island's bottom inset, so it covers no control at any width.
  badge.className =
    'pointer-events-none fixed bottom-0 left-0 rounded-tr-control border-t border-r border-line bg-surface px-2 py-px text-2xs leading-tight font-medium text-ink-muted'
  badge.style.zIndex = 'var(--z-toast)'
  document.body.append(badge)
  return badge
}

/** Installs the stub and returns the function that removes it again. */
export function installPreviewStub(): () => void {
  const passthrough = globalThis.fetch
  const backend = createPreviewBackend()

  const stubbed: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      globalThis.location.href,
    )
    if (!url.pathname.startsWith('/api/')) return passthrough.call(globalThis, input, init)

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    signal?.throwIfAborted()

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = await readJson(input, init)
    return backend.handle(method, url.pathname.slice('/api'.length), body)
  }

  globalThis.fetch = stubbed
  const badge = mountBadge()

  return () => {
    globalThis.fetch = passthrough
    badge.remove()
  }
}
