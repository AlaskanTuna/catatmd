import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A/B harness for hosted ASR (issue #151): posts a local audio file to ILMU's
 * `/audio/transcriptions` endpoint and reports what came back, so the token
 * table and segment-integrity verdict in `docs/trd.md` section 20.3 are
 * measured rather than assumed.
 *
 * **This is not a test and must never become one.** Every run spends a real,
 * billed API call, and its output moves with the provider. `bun run test`
 * stays deterministic and free precisely because this lives outside it.
 *
 * Nothing this touches is committed: audio samples stay wherever they already
 * live on disk, and reports land in `evals/reports/` (gitignored). Never point
 * it at a recording of a real consultation; the provenance rules of trd.md
 * sections 20.1 and 20.2 (synthetic or scripted audio only) apply here.
 *
 * Usage, from the repo root (the key is read from `.env` or the environment):
 *
 *   bunx tsx evals/asr-ab.ts <audio-file> [--runs 3] [--probe-ms]
 *     [--label name] [--ground-truth turns.json]
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {
  // No .env at the repo root; rely on the ambient environment.
}

const API_KEY = process.env.ILMU_API_KEY
const BASE_URL = process.env.ILMU_BASE_URL ?? 'https://api.ilmu.ai/v1'
const MODEL = process.env.ILMU_ASR_MODEL ?? 'ilmu-asr-v4.2'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}

interface Segment {
  start: number
  end: number | null
  text: string
}

interface RunResult {
  ms: number
  text: string
  language: string | null
  duration: number | null
  /** Billed seconds from the `usage` object, the one duration ILMU reliably returns. */
  usageSeconds: number | null
  segments: Segment[]
}

function usage(): never {
  console.error(
    'usage: bunx tsx evals/asr-ab.ts <audio-file> [--runs 3] [--probe-ms] [--label name] [--ground-truth turns.json]',
  )
  process.exit(2)
}

interface Args {
  audioPath: string
  runs: number
  probeMs: boolean
  label: string
  groundTruthPath: string | null
}

function parseArgs(argv: string[]): Args {
  let audioPath: string | null = null
  let runs = 3
  let probeMs = false
  let label: string | null = null
  let groundTruthPath: string | null = null

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) break
    if (arg === '--runs') {
      runs = Number(argv[++i])
      if (!Number.isInteger(runs) || runs < 1) usage()
    } else if (arg === '--probe-ms') {
      probeMs = true
    } else if (arg === '--label') {
      const value = argv[++i]
      if (value === undefined) usage()
      label = value
    } else if (arg === '--ground-truth') {
      const value = argv[++i]
      if (value === undefined) usage()
      groundTruthPath = value
    } else if (arg.startsWith('--')) {
      usage()
    } else if (audioPath === null) {
      audioPath = arg
    } else {
      usage()
    }
  }

  if (audioPath === null) usage()
  return {
    audioPath,
    runs,
    probeMs,
    label: label ?? basename(audioPath, extname(audioPath)),
    groundTruthPath,
  }
}

/**
 * Parsed rather than trusted, by hand: the shared Zod contract for this wire
 * shape arrives with the relay route (#154), and importing zod here would add
 * an undeclared dependency to the evals workspace for one shape.
 */
function parseResponse(body: unknown): Omit<RunResult, 'ms'> {
  if (typeof body !== 'object' || body === null) throw new Error('response body is not an object')
  const record = body as Record<string, unknown>
  if (typeof record.text !== 'string') throw new Error('response has no string `text`')
  const segmentsRaw = Array.isArray(record.segments) ? record.segments : []
  const segments: Segment[] = segmentsRaw.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null)
      throw new Error(`segment ${index} is not an object`)
    const s = raw as Record<string, unknown>
    if (typeof s.start !== 'number' || typeof s.text !== 'string') {
      throw new Error(`segment ${index} lacks a numeric start or string text`)
    }
    return { start: s.start, end: typeof s.end === 'number' ? s.end : null, text: s.text }
  })
  let usageSeconds: number | null = null
  if (typeof record.usage === 'object' && record.usage !== null) {
    const u = record.usage as Record<string, unknown>
    if (typeof u.seconds === 'number') usageSeconds = u.seconds
  }
  return {
    text: record.text,
    language: typeof record.language === 'string' ? record.language : null,
    duration: typeof record.duration === 'number' ? record.duration : null,
    usageSeconds,
    segments,
  }
}

async function transcribeOnce(
  audio: Buffer,
  filename: string,
  mime: string,
  language: string | null,
): Promise<RunResult> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), filename)
  form.append('model', MODEL)
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  if (language !== null) form.append('language', language)

  const startedAt = Date.now()
  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  })
  const ms = Date.now() - startedAt
  if (!response.ok) {
    throw new Error(`ILMU returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return { ms, ...parseResponse(await response.json()) }
}

/** Mirrors `usable()` in frontend/src/audio/draft-turns.ts, the gate that decides
 * whether draft speaker labels engage or the transcript falls back to prose. */
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

interface Integrity {
  usable: boolean
  failures: string[]
  contiguousBoundaries: number
  boundaries: number
  finalEnd: number | null
}

function checkIntegrity(segments: Segment[], fullText: string): Integrity {
  const failures: string[] = []
  if (segments.length === 0) failures.push('no segments')
  let previousStart = Number.NEGATIVE_INFINITY
  for (const [index, segment] of segments.entries()) {
    if (!Number.isFinite(segment.start) || segment.start < previousStart) {
      failures.push(`segment ${index} start is non-finite or decreasing`)
    }
    if (segment.end !== null && !Number.isFinite(segment.end)) {
      failures.push(`segment ${index} end is non-finite`)
    }
    previousStart = segment.start
  }
  if (normalise(segments.map((s) => s.text).join(' ')) !== normalise(fullText)) {
    failures.push('concatenated segment text does not reproduce the transcript')
  }

  let contiguousBoundaries = 0
  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i]
    const next = segments[i + 1]
    if (!current || !next) continue
    if (current.end !== null && Math.abs(current.end - next.start) < 1e-6) contiguousBoundaries += 1
  }
  const last = segments.at(-1)
  return {
    usable: failures.length === 0,
    failures,
    contiguousBoundaries,
    boundaries: Math.max(0, segments.length - 1),
    finalEnd: last ? (last.end ?? last.start) : null,
  }
}

interface GroundTruthFile {
  durationSeconds?: number
  turns?: { text?: string }[]
}

async function readGroundTruth(path: string): Promise<string> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as GroundTruthFile
  const texts = (parsed.turns ?? []).map((t) => t.text).filter((t): t is string => Boolean(t))
  if (texts.length === 0) throw new Error(`no turn texts found in ${path}`)
  return texts.join(' ')
}

function renderSegments(segments: Segment[]): string[] {
  return [
    '| # | Start | End | Text |',
    '| --- | --- | --- | --- |',
    ...segments.map(
      (s, i) =>
        `| ${i} | ${s.start.toFixed(2)} | ${s.end === null ? 'null' : s.end.toFixed(2)} | ${s.text.replaceAll('|', '\\|')} |`,
    ),
  ]
}

async function main() {
  if (!API_KEY) {
    console.error('ILMU_API_KEY is not set (root .env or environment); nothing was sent.')
    process.exit(2)
  }
  const args = parseArgs(process.argv.slice(2))

  const mime = MIME_BY_EXTENSION[extname(args.audioPath).toLowerCase()]
  if (!mime) {
    console.error(`unsupported audio extension on ${args.audioPath}; nothing was sent.`)
    process.exit(2)
  }
  const audio = await readFile(args.audioPath)
  const filename = basename(args.audioPath)
  console.log(`${args.label}: ${filename} (${(audio.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  console.log(
    `model ${MODEL} at ${BASE_URL}, ${args.runs} run(s)${args.probeMs ? ' + ms probe' : ''}`,
  )

  const runs: RunResult[] = []
  for (let i = 0; i < args.runs; i += 1) {
    const run = await transcribeOnce(audio, filename, mime, null)
    runs.push(run)
    console.log(
      `  run ${i + 1}: ${(run.ms / 1000).toFixed(1)}s, ${run.segments.length} segments, language=${run.language ?? '?'}, duration=${run.duration ?? run.usageSeconds ?? '?'}`,
    )
  }
  const probe = args.probeMs ? await transcribeOnce(audio, filename, mime, 'ms') : null
  if (probe) {
    console.log(`  ms probe: ${(probe.ms / 1000).toFixed(1)}s, ${probe.segments.length} segments`)
  }

  const first = runs[0]
  if (!first) throw new Error('no runs completed')
  const texts = new Set(runs.map((r) => r.text))
  const segmentSets = new Set(runs.map((r) => JSON.stringify(r.segments)))
  const deterministic = texts.size === 1 && segmentSets.size === 1
  const integrity = checkIntegrity(first.segments, first.text)
  const groundTruth = args.groundTruthPath ? await readGroundTruth(args.groundTruthPath) : null

  const verboseHonoured =
    first.segments.length > 0 || first.duration !== null || first.language !== null
  console.log(`  deterministic across ${args.runs} run(s): ${deterministic ? 'yes' : 'NO'}`)
  console.log(`  verbose_json honoured: ${verboseHonoured ? 'yes' : 'no'}`)
  console.log(
    `  usable() verdict: ${integrity.usable ? 'pass' : `FAIL (${integrity.failures.join('; ')})`}`,
  )

  const startedAt = new Date().toISOString()
  const lines = [
    `# ASR A/B: ${args.label}`,
    '',
    `- **When:** ${startedAt}`,
    `- **Model:** \`${MODEL}\` at ${BASE_URL}`,
    `- **File:** ${filename} (${audio.byteLength} bytes)`,
    `- **Runs:** ${args.runs}${args.probeMs ? ' plus one language=ms probe' : ''}`,
    '',
    '## Runs',
    '',
    '| Run | Latency | Segments | Detected Language | Reported Duration | Billed Seconds |',
    '| --- | --- | --- | --- | --- | --- |',
    ...runs.map(
      (r, i) =>
        `| ${i + 1} | ${(r.ms / 1000).toFixed(1)}s | ${r.segments.length} | ${r.language ?? '?'} | ${r.duration ?? '?'} | ${r.usageSeconds ?? '?'} |`,
    ),
    ...(probe
      ? [
          `| ms probe | ${(probe.ms / 1000).toFixed(1)}s | ${probe.segments.length} | ${probe.language ?? '?'} | ${probe.duration ?? '?'} | ${probe.usageSeconds ?? '?'} |`,
        ]
      : []),
    '',
    '## Verdicts',
    '',
    `- **Deterministic:** ${deterministic ? 'yes, byte-identical text and segments' : 'NO'}`,
    `- **verbose_json honoured:** ${verboseHonoured ? 'yes' : 'no (segments, language, and duration absent; only `usage.seconds` returned)'}`,
    `- **Segment integrity (\`usable()\` contract):** ${integrity.usable ? 'pass' : `FAIL: ${integrity.failures.join('; ')}`}`,
    ...(first.segments.length === 0
      ? [
          '- **Consequence:** no per-segment timestamps on this path; draft speaker labels would run in single-segment content mode (sentence scoring still works, per-turn offsets are lost)',
        ]
      : []),
    `- **Contiguous boundaries:** ${integrity.contiguousBoundaries} of ${integrity.boundaries}`,
    `- **Final segment end:** ${integrity.finalEnd ?? 'n/a'}`,
    '',
    '## Transcript (Run 1)',
    '',
    first.text.trim(),
    '',
    ...(probe ? ['## Transcript (language=ms Probe)', '', probe.text.trim(), ''] : []),
    ...(groundTruth ? ['## Ground Truth', '', groundTruth, ''] : []),
    '## Segments (Run 1)',
    '',
    ...renderSegments(first.segments),
    '',
  ]

  await mkdir(new URL('reports/', import.meta.url), { recursive: true })
  const reportPath = new URL(
    `reports/asr-ab-${args.label}-${startedAt.replace(/[:.]/g, '-')}.md`,
    import.meta.url,
  )
  await writeFile(reportPath, lines.join('\n'), 'utf8')
  console.log(`\nReport: ${fileURLToPath(reportPath)}`)
}

await main()
