import '../config/env.js'

import type { Transcript } from '@shared/types'
import { analyseNote } from '../analysis/index.js'
import { type ClinicalProfile, getClinicalProfile } from '../clinical-profiles/index.js'
import { deidentifyTranscript } from '../deid/index.js'
import { logger } from '../lib/logger.js'
import { evaluateRedFlags, mergeRedFlags } from '../redflags/evaluate.js'
import { retrieveGuidelines } from '../retrieval/index.js'
import { generateSuggestions } from '../suggestions/index.js'
import { BENCH_TRANSCRIPT } from './fixture.js'

/**
 * Times the real `runAnalysis` pipeline (routes/consultations.ts) end to end
 * against BENCH_TRANSCRIPT, so the 3-minute clinic envelope is a measured
 * number rather than a guess. Runs are sequential on purpose: overlapping
 * them would measure the provider's rate limiter, not the pipeline.
 *
 * Prints only counts and durations — never transcript text, model output, or
 * anything the vault could rehydrate back to an identifier.
 */

const STAGES = [
  'deidentification',
  'rules',
  'note_generation',
  'guideline_retrieval',
  'suggestions',
  'retrieval',
  'llm_concurrent',
  'rehydration',
  'total',
] as const

type StageName = (typeof STAGES)[number]

const DEFAULT_RUNS = 3
const MAX_RUNS = 10
const BUDGET_SECONDS = 180

interface Timed<T> {
  result: T
  durationMs: number
}

interface RunResult {
  durations: Record<StageName, number>
  redFlags: number
  gaps: number
  suggestions: number
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

function fail(stage: StageName, error: unknown): never {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`stage ${stage} failed: ${name}: ${message}\n`)
  process.exit(1)
}

async function timeStage<T>(stage: StageName, run: () => Promise<T> | T): Promise<Timed<T>> {
  const startedAt = performance.now()
  try {
    return { result: await run(), durationMs: elapsedMs(startedAt) }
  } catch (error) {
    fail(stage, error)
  }
}

function parseRuns(argv: readonly string[]): number {
  if (argv.length === 0) return DEFAULT_RUNS

  const flag = argv[0]
  const raw = argv[1]
  if (argv.length === 2 && flag === '--runs' && raw !== undefined) {
    const runs = Number(raw)
    if (Number.isInteger(runs) && runs >= 1 && runs <= MAX_RUNS) return runs
  }

  process.stderr.write(`usage: tsx src/bench/workflow.ts [--runs <1-${MAX_RUNS}>]\n`)
  process.exit(2)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[sorted.length % 2 === 0 ? middle - 1 : middle]
  const upper = sorted[middle]
  if (lower === undefined || upper === undefined) return 0
  return (lower + upper) / 2
}

async function runOnce(transcript: Transcript, profile: ClinicalProfile): Promise<RunResult> {
  const startedAt = performance.now()

  const deid = await timeStage('deidentification', () => deidentifyTranscript(transcript))
  const rules = await timeStage('rules', () =>
    evaluateRedFlags(transcript, profile.redFlagTriggers),
  )

  const noteStage = timeStage('note_generation', () =>
    analyseNote(deid.result.text, deid.result.text, profile),
  )
  /*
   * Mirrors `runAnalysis` rather than approximating it (#340). This stage
   * called `generateSuggestions` directly with no retrieved chunks, so it
   * measured one model call and named it `retrieval`, and every number derived
   * from it understated production by however long retrieval actually takes.
   *
   * The two halves are sequential here because they are sequential there: the
   * corpus has to exist before the suggestions prompt can carry it. The catch
   * mirrors the route's too, so a degraded run measures what production would
   * do, but it says so, because a silent fallback to an empty corpus is what
   * made the old number look reasonable.
   */
  let guidelineRetrievalMs = 0
  let suggestionsMs = 0
  const retrievalStage = timeStage('retrieval', async () => {
    const retrieval = await timeStage('guideline_retrieval', async () => {
      try {
        return await retrieveGuidelines(deid.result.text, { profileId: profile.id })
      } catch {
        logger.warn('guideline retrieval failed; measuring the degraded path', {
          errorClass: 'retrieval_error',
          errorName: 'bench_retrieval_unavailable',
        })
        return []
      }
    })
    guidelineRetrievalMs = retrieval.durationMs
    const suggestions = await timeStage('suggestions', () =>
      generateSuggestions(deid.result.text, profile, retrieval.result),
    )
    suggestionsMs = suggestions.durationMs
    return suggestions.result
  })
  const llmStartedAt = performance.now()
  const [note, retrieval] = await Promise.all([noteStage, retrievalStage])
  const llmConcurrentMs = elapsedMs(llmStartedAt)

  const rehydration = await timeStage('rehydration', () => {
    const rehydrate = (value: string) => deid.result.vault.rehydrate(value)
    return {
      note: {
        subjective: rehydrate(note.result.note.subjective),
        objective: rehydrate(note.result.note.objective),
        assessment: rehydrate(note.result.note.assessment),
        plan: rehydrate(note.result.note.plan),
      },
      medicalRecordNote: {
        presentingComplaint: rehydrate(note.result.medicalRecordNote.presentingComplaint),
        historyOfPresentingComplaint: rehydrate(
          note.result.medicalRecordNote.historyOfPresentingComplaint,
        ),
        pastMedicalHistory: rehydrate(note.result.medicalRecordNote.pastMedicalHistory),
        socialHistory: rehydrate(note.result.medicalRecordNote.socialHistory),
        familyHistory: rehydrate(note.result.medicalRecordNote.familyHistory),
        objective: rehydrate(note.result.medicalRecordNote.objective),
        assessment: rehydrate(note.result.medicalRecordNote.assessment),
        plan: rehydrate(note.result.medicalRecordNote.plan),
      },
      gaps: note.result.gaps.map((gap) => ({
        ...gap,
        question: rehydrate(gap.question),
        rationale: rehydrate(gap.rationale),
      })),
      redFlags: mergeRedFlags(rules.result, retrieval.result.redFlags).map((flag) => ({
        ...flag,
        label: rehydrate(flag.label),
        evidence: rehydrate(flag.evidence),
      })),
      suggestions: retrieval.result.suggestions.map((suggestion) => ({
        ...suggestion,
        text: rehydrate(suggestion.text),
      })),
    }
  })

  return {
    durations: {
      deidentification: deid.durationMs,
      rules: rules.durationMs,
      note_generation: note.durationMs,
      guideline_retrieval: guidelineRetrievalMs,
      suggestions: suggestionsMs,
      retrieval: retrieval.durationMs,
      llm_concurrent: llmConcurrentMs,
      rehydration: rehydration.durationMs,
      total: elapsedMs(startedAt),
    },
    redFlags: rehydration.result.redFlags.length,
    gaps: rehydration.result.gaps.length,
    suggestions: rehydration.result.suggestions.length,
  }
}

async function main(): Promise<void> {
  const runCount = parseRuns(process.argv.slice(2))
  const profile = getClinicalProfile()
  const transcript = BENCH_TRANSCRIPT

  const wordCount = transcript.turns.reduce(
    (count, turn) => count + turn.text.split(/\s+/).filter((word) => word.length > 0).length,
    0,
  )
  const lastOffsetSeconds = transcript.turns.at(-1)?.offsetSeconds ?? 0
  process.stdout.write(
    `transcript: ${transcript.turns.length} turns, ${wordCount} words, ` +
      `${(lastOffsetSeconds / 60).toFixed(1)} spoken minutes\n`,
  )
  process.stdout.write(
    `llm provider: ${process.env.LLM_PROVIDER ?? 'unset'}, ` +
      `model: ${process.env.QWEN_MODEL ?? 'unset'}\n`,
  )

  const runs: RunResult[] = []
  for (let index = 0; index < runCount; index++) {
    const run = await runOnce(transcript, profile)
    runs.push(run)
    process.stdout.write(
      `run ${index + 1}: redFlags=${run.redFlags} gaps=${run.gaps} ` +
        `suggestions=${run.suggestions}\n`,
    )
  }

  const headers = ['Stage', ...runs.map((_, index) => `Run ${index + 1}`), 'Median']
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const stage of STAGES) {
    const values = runs.map((run) => run.durations[stage])
    const cells = [
      stage,
      ...values.map((value) => String(value)),
      String(Math.round(median(values))),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)

  const medianTotalMs = median(runs.map((run) => run.durations.total))
  process.stdout.write(`Median total: ${(medianTotalMs / 1000).toFixed(1)} s\n`)
  process.stdout.write(
    `Budget: ${medianTotalMs <= BUDGET_SECONDS * 1000 ? 'PASS' : 'FAIL'} against ` +
      `${BUDGET_SECONDS} s\n`,
  )
}

await main()
