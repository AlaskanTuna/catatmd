import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * GitHub issue #81. `backend/src/lib/llm/` is the only egress point to any
 * provider, and this fails the build when a second SDK import appears.
 *
 * The invariant already held when this was written: one provider import exists
 * repo-wide, `import OpenAI from 'openai'` in `openai-compatible.ts`. This
 * guards against regression, and it is the only item on the PR Clinical-Safety
 * Checklist that was previously enforced by nothing but a reviewer noticing.
 * `biome.json` has no rule that could catch it.
 *
 * Four scope choices, all deliberate:
 *
 * 1. **`frontend/` and `shared/` are scanned, not just the backend.** A
 *    provider SDK in the SPA is strictly worse than one in the API, because the
 *    bundle is public and the key ships with it. Scanning only the tree where
 *    the rule is easiest to keep would miss the case that costs the most.
 * 2. **Specifiers are parsed, then compared. The line is not regex-matched.**
 *    `ai` is a real package name and a substring of half the identifiers in
 *    this codebase, so matching text would either miss `import { x } from 'ai'`
 *    or fire on `chai`. Resolving the specifier to its package name and
 *    comparing exactly is the only version that is both sound and complete.
 * 3. **Subpaths resolve to their package.** `openai/resources` is the same
 *    dependency and the same egress.
 * 4. **The repo-wide count is pinned, not just the absence outside the
 *    directory.** security.md's wording is that a second provider SDK
 *    *anywhere* is a critical defect, and the architecture is one adapter
 *    configured per provider rather than one adapter each. A second SDK added
 *    inside `lib/llm/` is exactly the hurried change this should catch, and an
 *    outside-only guard would wave it through.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** The one directory allowed to import a provider SDK. */
const LLM_MODULE = 'backend/src/lib/llm/'

const SCANNED_TREES = [
  { dir: 'backend/src', extensions: ['.ts'] },
  { dir: 'frontend/src', extensions: ['.ts', '.tsx'] },
  { dir: 'shared/src', extensions: ['.ts'] },
  { dir: 'prisma', extensions: ['.ts'] },
]

/**
 * Exact package names. Scoped families that publish one adapter per provider
 * are matched by prefix below instead, because enumerating them goes stale the
 * day a new provider ships.
 *
 * **Transcription vendors belong here too** (issue #172). The list named LLM
 * vendors only, so an ASR SDK was a second egress that would have passed the
 * build: `.claude/rules/security.md` bans one under "ASR Egress", and until now
 * nothing checked. Audio is the worse case of the two, because it cannot be
 * de-identified at all.
 *
 * ILMU itself contributes no entry. It publishes no npm package (checked
 * against the registry when this list was extended), which is precisely why
 * `backend/src/lib/asr/ilmu.ts` is written against native fetch, and why that
 * call is pinned separately by `no-stray-fetch.test.ts`.
 */
const PROVIDER_PACKAGES = new Set([
  // Text
  'openai',
  '@google/genai',
  '@google/generative-ai',
  '@anthropic-ai/sdk',
  'ai',
  'cohere-ai',
  'groq-sdk',
  'replicate',
  // Transcription
  '@deepgram/sdk',
  'assemblyai',
  '@google-cloud/speech',
  '@aws-sdk/client-transcribe',
  'microsoft-cognitiveservices-speech-sdk',
  '@azure/cognitiveservices-speech-sdk',
  'revai-node-sdk',
])

const PROVIDER_SCOPES = ['@ai-sdk/', '@mistralai/', '@speechmatics/']

/** `import x from 'y'`, `import 'y'`, `require('y')`, `await import('y')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

/** `@scope/pkg/sub` to `@scope/pkg`; `pkg/sub` to `pkg`; `./local` to null. */
function packageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null
  }
  return segments[0] ?? null
}

function isProviderSdk(specifier: string): boolean {
  const name = packageName(specifier)
  if (name === null) return false
  return PROVIDER_PACKAGES.has(name) || PROVIDER_SCOPES.some((scope) => name.startsWith(scope))
}

/**
 * A guard that forbids *naming* the thing it guards against gets worked around.
 * Prose listing the banned SDKs should not trip it, and no line starting a
 * comment can execute.
 */
function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line)
}

function sourceFiles(): string[] {
  const found: string[] = []

  for (const { dir, extensions } of SCANNED_TREES) {
    const walk = (absolute: string) => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const child = join(absolute, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'migrations' && entry.name !== 'node_modules') walk(child)
        } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
          found.push(relative(REPO_ROOT, child).replaceAll('\\', '/'))
        }
      }
    }

    walk(join(REPO_ROOT, dir))
  }

  return found
}

/** Every provider import in the scanned trees, as `path:line: specifier`. */
function providerImports(): string[] {
  const found: string[] = []

  for (const path of sourceFiles()) {
    readFileSync(join(REPO_ROOT, path), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (isComment(line)) return

        for (const match of line.matchAll(SPECIFIER)) {
          const specifier = match[1]
          if (specifier !== undefined && isProviderSdk(specifier)) {
            found.push(`${path}:${index + 1}: ${specifier}`)
          }
        }
      })
  }

  return found
}

describe('only lib/llm imports a provider SDK (issue #81)', () => {
  it('finds source to scan in every tree, so an empty pass means something', () => {
    const scanned = sourceFiles()

    for (const { dir } of SCANNED_TREES) {
      expect(
        scanned.some((path) => path.startsWith(`${dir}/`)),
        `scanned no files under ${dir}; the walk is broken or the tree moved`,
      ).toBe(true)
    }
  })

  it('recognises provider specifiers without firing on lookalikes', () => {
    for (const specifier of [
      'openai',
      'openai/resources',
      '@google/genai',
      '@anthropic-ai/sdk',
      'ai',
      '@ai-sdk/openai',
      '@mistralai/mistralai',
      // Transcription vendors, added by #172. An ASR SDK is the egress this
      // list used to miss entirely.
      '@deepgram/sdk',
      '@deepgram/sdk/client',
      'assemblyai',
      '@google-cloud/speech',
      '@aws-sdk/client-transcribe',
      '@speechmatics/batch-client',
    ]) {
      expect(isProviderSdk(specifier), `${specifier} should be caught`).toBe(true)
    }

    for (const specifier of [
      'chai',
      'ai-utils',
      'zod',
      './ai.js',
      '../lib/llm/index.js',
      'vitest',
      // Neighbours of the transcription entries that must not be swept up:
      // one is our own AWS client for a different service, one is a lookalike.
      '@aws-sdk/client-s3',
      'assemblyai-utils',
      './asr/ilmu.js',
    ]) {
      expect(isProviderSdk(specifier), `${specifier} should not be caught`).toBe(false)
    }
  })

  it('keeps every provider import inside lib/llm', () => {
    const violations = providerImports().filter((entry) => !entry.startsWith(LLM_MODULE))

    expect(
      violations,
      'A provider SDK is imported outside backend/src/lib/llm/. LLMClient is ' +
        'the only egress point, and a second import is a path around the ' +
        'de-identification gate. Route the call through LLMClient instead.',
    ).toEqual([])
  })

  it('keeps the provider SDK count at exactly one repo-wide', () => {
    const specifiers = providerImports().map((entry) => entry.split(': ').at(-1))

    expect(
      specifiers,
      'The architecture is one OpenAI-compatible adapter configured per ' +
        'provider, not one adapter each. A second provider SDK anywhere, ' +
        'including inside lib/llm/, is a critical defect: it is a second ' +
        'egress path that the deid gate and this guard were built to prevent. ' +
        'Add configuration to OpenAICompatibleClient instead.',
    ).toEqual(['openai'])
  })
})
