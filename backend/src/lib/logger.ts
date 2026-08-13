import { AsyncLocalStorage } from 'node:async_hooks'
import { env } from '../config/env.js'
import { detect } from '../deid/detectors.js'

/**
 * Privacy-safe structured logger (GitHub issue #15).
 *
 * The goal is that logging clinical content is *impossible*, not merely
 * discouraged. Two controls do the work, and the second is the one that
 * matters:
 *
 *  1. A positive allowlist of field names. A denylist fails open the moment
 *     someone invents a new field name; an allowlist fails closed.
 *  2. A value rule per field. Every allowlisted field is an enum, an
 *     identifier, or a number. No field accepts free text, so there is no
 *     field a transcript span, note body, gap question or suggestion can be
 *     assigned to. A value that fails its rule is replaced, not emitted.
 *
 * Control 2 exists because control 1 alone is not enough, and that was proven
 * rather than assumed. An earlier version of this file allowed `operation` to
 * be any string and relied on `deid`'s detector to catch anything clinical in
 * it. The detector is scored and context sensitive (`ACCEPT_THRESHOLD`), so it
 * caught "Ahmad reports cough" and missed "Has Ahmad had any recent travel?".
 * A probabilistic check is a useful backstop and a poor boundary.
 *
 * The remaining free-text surface is the log message itself, which is
 * developer-authored and should be a literal. It is still passed through the
 * detector and truncated, but a name interpolated into a message is a residual
 * risk that field rules cannot reach. Put data in fields, not in the message.
 *
 * Neither control is conditional on log level. There is deliberately no debug
 * flag that widens what may be written: per the issue's non-goals, that flag
 * would itself become the vulnerability.
 *
 * Output is one JSON object per line on stdout, which Render already drains.
 * Because every record is `JSON.stringify`d, an embedded newline cannot forge
 * a second log line.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const

export type LogLevel = keyof typeof LEVELS

/** Stages timed by `timeStage`, matching the pipeline in docs/trd.md §12. */
export const PIPELINE_STAGES = [
  'deidentification',
  'extraction',
  'note_generation',
  'rules',
  'retrieval',
  'persistence',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/**
 * Failure taxonomy. Each class is distinguishable in a log line without
 * inspecting any payload, which is the entire purpose of the field.
 */
export const ERROR_CLASSES = [
  'model_error',
  'schema_parse_error',
  'rule_engine_error',
  'retrieval_error',
  'deidentification_error',
  'validation_error',
  'auth_error',
  'internal_error',
] as const

export type ErrorClass = (typeof ERROR_CLASSES)[number]

/** `GenerateRequest.operation` values, which name an LLM call site. */
const LLM_OPERATIONS = ['clinical_facts', 'note_and_gaps', 'suggestions_and_red_flags'] as const

export type LlmOperation = (typeof LLM_OPERATIONS)[number]

const DETECTOR_LABELS = ['PATIENT', 'NRIC', 'PHONE', 'ADDRESS', 'DOB', 'MRN', 'EMAIL'] as const
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const OUTCOMES = ['ok', 'error'] as const
const PROVIDERS = ['qwen', 'gemini', 'deepseek'] as const

type LogValue = string | number | readonly string[]

/** Substituted for anything that fails its field rule. */
const INVALID = '[redacted:invalid]'

/** Opaque ids: cuid, uuid, better-auth session ids. */
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
/** Constructor names and model ids. */
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
/** A normalised route, already stripped of query and opaque segments. */
const ROUTE_PATTERN = /^[A-Za-z0-9/_:.-]{1,120}$/

type Rule = (value: unknown) => LogValue

const labelSet = new Set<string>(DETECTOR_LABELS)

const matching =
  (pattern: RegExp): Rule =>
  (value) =>
    typeof value === 'string' && pattern.test(value) ? value : INVALID

const oneOf =
  (allowed: readonly string[]): Rule =>
  (value) =>
    typeof value === 'string' && allowed.includes(value) ? value : INVALID

const asInteger: Rule = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : INVALID

const asDetectorLabels: Rule = (value) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && labelSet.has(item))
    : INVALID

/**
 * The single source of truth for what may be logged and what shape it must
 * take. Adding a field is a deliberate act, visible in a diff, and it must come
 * with a rule that is an enum, an identifier pattern, or a number. A rule that
 * accepts arbitrary strings would reopen the hole described above.
 */
const FIELD_RULES = {
  requestId: matching(ID_PATTERN),
  consultationId: matching(ID_PATTERN),
  actorId: matching(ID_PATTERN),
  method: oneOf(HTTP_METHODS),
  route: matching(ROUTE_PATTERN),
  status: asInteger,
  durationMs: asInteger,
  stage: oneOf(PIPELINE_STAGES),
  operation: oneOf(LLM_OPERATIONS),
  errorClass: oneOf(ERROR_CLASSES),
  errorName: matching(NAME_PATTERN),
  outcome: oneOf(OUTCOMES),
  detectorLabels: asDetectorLabels,
  detectorCount: asInteger,
  provider: oneOf(PROVIDERS),
  model: matching(NAME_PATTERN),
  count: asInteger,
} as const satisfies Record<string, Rule>

export const ALLOWED_FIELDS = Object.keys(FIELD_RULES) as readonly (keyof typeof FIELD_RULES)[]

/**
 * Ergonomic mirror of `FIELD_RULES`. Excess-property checking makes
 * `logger.info('x', { transcript })` a compile error at the call site, while
 * the rules are what hold when the object arrives as a variable or through a
 * cast.
 */
export interface LogFields {
  requestId?: string
  consultationId?: string
  actorId?: string
  method?: string
  route?: string
  status?: number
  durationMs?: number
  stage?: PipelineStage
  /** Names an LLM call site, never its content. */
  operation?: LlmOperation
  errorClass?: ErrorClass
  /** Constructor name only. Never `error.message`, which may quote a transcript. */
  errorName?: string
  outcome?: 'ok' | 'error'
  /** Detector labels that fired, e.g. ["NRIC"]. Never the matched values. */
  detectorLabels?: readonly string[]
  detectorCount?: number
  provider?: string
  model?: string
  count?: number
}

/** Long enough for a sentence, far too short for a clinical narrative. */
const MAX_MESSAGE_LENGTH = 120

/** An already-minted vault token, e.g. `[PATIENT_1]`. */
const TOKEN_PATTERN = /\[[A-Z]+_\d+\]/

/**
 * The message is the one free-text surface, so it gets the probabilistic
 * treatment the fields no longer need: vault tokens stripped, detector run,
 * length capped.
 */
function scrubMessage(message: string): string {
  if (TOKEN_PATTERN.test(message)) return '[redacted:vault-token]'

  const hits = detect(message)
  if (hits.length > 0) {
    const labels = [...new Set(hits.map((hit) => hit.label))].sort().join(',')
    return `[redacted:${labels}]`
  }

  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...`
    : message
}

/** Exported for the tests that prove the boundary holds. */
export function scrub(fields: Readonly<Record<string, unknown>>): Record<string, LogValue> {
  const out: Record<string, LogValue> = {}
  for (const [key, value] of Object.entries(fields)) {
    const rule = (FIELD_RULES as Record<string, Rule | undefined>)[key]
    if (!rule) continue
    if (value === undefined || value === null) continue
    out[key] = rule(value)
  }
  return out
}

const requestStore = new AsyncLocalStorage<{ requestId: string }>()

/** Binds a request id to everything `fn` triggers, including async work. */
export function withRequestContext<T>(requestId: string, fn: () => T): T {
  return requestStore.run({ requestId }, fn)
}

export function currentRequestId(): string | undefined {
  return requestStore.getStore()?.requestId
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) return

  const requestId = currentRequestId()
  const record = {
    level,
    msg: scrubMessage(message),
    ...(requestId ? { requestId } : {}),
    ...scrub(fields as Readonly<Record<string, unknown>>),
    ts: new Date().toISOString(),
  }

  process.stdout.write(`${JSON.stringify(record)}\n`)
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
}

/**
 * Times one pipeline stage and records the outcome. Wrapping a call is the
 * entire instrumentation cost, which is deliberate: the issue's framing is that
 * the safe thing has to also be the easy thing.
 *
 * The stage's return value passes through untouched and is never logged.
 */
export async function timeStage<T>(stage: PipelineStage, run: () => Promise<T> | T): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await run()
    logger.info('pipeline stage complete', {
      stage,
      outcome: 'ok',
      durationMs: Math.round(performance.now() - startedAt),
    })
    return result
  } catch (error) {
    logger.warn('pipeline stage failed', {
      stage,
      outcome: 'error',
      durationMs: Math.round(performance.now() - startedAt),
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw error
  }
}
