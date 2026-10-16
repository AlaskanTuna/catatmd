import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GuidelineChunk } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

// `analysis/live.ts` reaches the LLM client, which reads `env`. Nothing here
// calls a model; the prompts are built from code alone.
vi.mock('../lib/llm/index.js', () => ({ getLLMClient: vi.fn() }))

const { buildLiveFactsSystemPrompt } = await import('../analysis/live.js')
const { buildClinicalFactsSystemPrompt, buildNoteAndGapsSystemPrompt } = await import(
  '../analysis/prompt.js'
)
const { CLINICAL_PROFILES } = await import('../clinical-profiles/index.js')
const { buildCopilotSystemPrompt } = await import('../copilot/prompt.js')
const { DRAFT_TURNS_SYSTEM_PROMPT } = await import('../draft-turns/prompt.js')
const { buildRedFlagsSystemPrompt, buildSuggestionsSystemPrompt } = await import(
  '../suggestions/prompt.js'
)
const { TRANSCRIPT_CLEANUP_SYSTEM_PROMPT } = await import('../transcript-cleanup/prompt.js')
const { detect } = await import('./detectors.js')

const RETRIEVED: GuidelineChunk = {
  id: 'retrieved-cpg-p3',
  title: 'Clinical Practice Guideline, p. 3: Antibiotics',
  publisher: 'MOH',
  year: 2024,
  url: 'https://example.com/cpg',
  summary: 'Summary text.',
  sourceLicence: 'MOH-ARR',
  verbatimAllowed: true,
  documentId: 'doc-1',
  page: 3,
}

const SYSTEM_PROMPTS: [string, string][] = [
  ...Object.values(CLINICAL_PROFILES).flatMap((profile): [string, string][] => [
    [`clinical_facts (${profile.id})`, buildClinicalFactsSystemPrompt(profile)],
    [`note_and_gaps (${profile.id})`, buildNoteAndGapsSystemPrompt(profile)],
    [`live facts (${profile.id})`, buildLiveFactsSystemPrompt(profile)],
    [`red_flags (${profile.id})`, buildRedFlagsSystemPrompt(profile)],
    [`suggestions (${profile.id})`, buildSuggestionsSystemPrompt(profile, [RETRIEVED])],
  ]),
  ['draft_turns', DRAFT_TURNS_SYSTEM_PROMPT],
  ['transcript_cleanup', TRANSCRIPT_CLEANUP_SYSTEM_PROMPT],
  ['copilot', buildCopilotSystemPrompt('', [RETRIEVED])],
  ['copilot, no guidance', buildCopilotSystemPrompt('', [])],
  ['copilot, signed', buildCopilotSystemPrompt('', [], { signed: true })],
]

/*
 * Every place a system prompt is handed to `LLMClient` (`system:`) or built
 * for the copilot, pinned per file so a new prompt cannot arrive without a
 * case above. The port's own declarations in `lib/llm/` are not call sites.
 */
const PROMPT_SITES: Record<string, number> = {
  'analysis/index.ts': 2,
  'analysis/live.ts': 1,
  'copilot/index.ts': 1,
  'draft-turns/index.ts': 1,
  'suggestions/index.ts': 2,
  'transcript-cleanup/index.ts': 1,
}
const SRC = fileURLToPath(new URL('../', import.meta.url))

function promptSites(): Record<string, number> {
  const found: Record<string, number> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const file = relative(SRC, path).split('\\').join('/')
        if (file.startsWith('lib/llm/') || file === 'copilot/prompt.ts') continue
        const count = (
          readFileSync(path, 'utf8').match(/\bsystem:|buildCopilotSystemPrompt\(/g) ?? []
        ).length
        if (count > 0) found[file] = count
      }
    }
  }
  walk(SRC)
  return found
}

/*
 * A system prompt is checked at egress (`egress_system`) or gated whole before
 * it is sent, so one detector hit in a prompt's own wording would block, or
 * rewrite, every call that sends it. Pinned when number words became
 * detectable (#435), because prompts are prose that counts.
 */
describe('the system prompts carry nothing the gate detects', () => {
  it.each(SYSTEM_PROMPTS)('finds nothing in the %s system prompt', (_operation, prompt) => {
    expect(detect(prompt)).toEqual([])
  })

  it('covers every place a system prompt is sent', () => {
    expect(promptSites()).toEqual(PROMPT_SITES)
  })
})
