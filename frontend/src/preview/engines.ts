/*
 * The backend's pure modules, imported by the preview stub and by nothing else.
 *
 * Only side-effect-free code crosses here: no env, no Prisma, no logger, no
 * model client, no Node built-in. `redflags/` and `medications/` are pure by
 * their own contract, and `fixtures/corpus.ts` is a constant. Importing them
 * rather than copying them is the point: a preview shows the real red-flag
 * engine and the real prescription parser, not a lookalike.
 */
export { FIXTURES } from '../../../backend/src/fixtures/corpus.js'
export { matchMedication, parseSigWithSpan } from '../../../backend/src/medications/index.js'
export {
  ALL_REDFLAG_TRIGGERS,
  evaluateRedFlags,
  proposeMishearCorrections,
} from '../../../backend/src/redflags/index.js'
