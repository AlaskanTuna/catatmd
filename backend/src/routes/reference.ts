import { Router } from 'express'
import { FIXTURES } from '../fixtures/index.js'
import { GUIDELINE_CORPUS } from '../guidelines/index.js'

/**
 * The two read-only reference collections (docs/trd.md §13). Both are
 * compile-time constants already validated against their schemas in
 * `fixtures/corpus.ts` and `guidelines/corpus.ts`, so there is nothing to
 * re-parse here.
 *
 * Session-guarded like every other clinical route — `requireSession` is mounted
 * on both path prefixes in `app.ts`.
 */
export const referenceRouter = Router()

referenceRouter.get('/fixtures', (_req, res) => {
  res.json({ fixtures: FIXTURES })
})

referenceRouter.get('/guidelines', (_req, res) => {
  // `verbatimAllowed` is surfaced, never stripped: the citation-detail view
  // needs it to explain a licence-restricted chunk's absent quote rather than
  // letting it look like missing data (docs/trd.md §13).
  res.json({ guidelines: GUIDELINE_CORPUS })
})
