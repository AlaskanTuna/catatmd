import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregate, characterErrorRate, type ErrorRate, wordErrorRate } from './wer.js'

/**
 * A/B harness for hosted ASR (issue #151): posts a local audio file to ILMU's
 * `/audio/transcriptions` endpoint and reports what came back, so the token
 * table and segment-integrity verdict in `docs/trd.md` section 20.3 are
 * measured rather than assumed.
 *
 * `--segment` extends it to the ambient question of section 20.9: what does
 * cutting a consultation into fixed windows cost, and does the 8 second floor
 * measured on `qwen3-asr-flash` transfer to a different recogniser.
 *
 * **This is not a test and must never become one.** Every run spends a real,
 * billed API call, and its output moves with the provider. `bun run test`
 * stays deterministic and free precisely because this lives outside it. The
 * scorer in `wer.ts` is the exception: it is pure, so `wer.test.ts` runs in CI.
 *
 * Nothing this touches is committed: audio samples stay wherever they already
 * live on disk, and reports land in `evals/reports/` (gitignored). Never point
 * it at a recording of a real consultation; the provenance rules of trd.md
 * sections 20.1 and 20.2 (synthetic or scripted audio only) apply here.
 *
 * Usage, from the repo root (the key is read from `.env` or the environment):
 *
 *   bunx tsx evals/asr-ab.ts <audio-file> [--runs 3] [--probe-ms]
 *     [--label name] [--ground-truth turns.json] [--segment 8]
 *     [--container wav|webm] [--wer] [--via-relay https://origin]
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

/**
 * `wav` is 16 kHz mono PCM, which is what the `qwen3-asr-flash` segmentation
 * table was measured on; matching it is what makes an ILMU row comparable to
 * an Alibaba row. `webm` is mono Opus, what `MediaRecorder` actually emits and
 * therefore what ambient capture would really send. Control and chunk arms
 * always share one container, so the codec cancels within any one comparison.
 */
type Container = 'wav' | 'webm'

const CONTAINER_CODEC: Record<Container, string[]> = {
  wav: ['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'],
  webm: ['-ac', '1', '-c:a', 'libopus'],
}

/** Below this a chunk is dropped, mirroring the `len > sr // 2` rule of the
 * script that produced the published segmentation numbers. Its words still
 * count against the reference as deletions, which is what that script did. */
const MIN_CHUNK_SECONDS = 0.5

/** `hostedAsrRateLimit` is 5 per minute, so an unpaced segmented run through
 * the relay starts returning 429 at the sixth chunk. */
const RELAY_PACE_MS = 12_500

interface Segment {
  start: number
  end: number | null
  text: string
}

/** One HTTP call, whether direct to ILMU or through the deployed relay. */
interface CallResult {
  ms: number
  text: string
  language: string | null
  duration: number | null
  /** Billed seconds from the `usage` object, the one duration ILMU reliably returns. */
  usageSeconds: number | null
  segments: Segment[]
}

/** One run, which is one call when unsegmented and N calls when segmented. */
interface RunResult extends CallResult {
  /** Latency of each posted chunk, in order. One entry on an unsegmented run. */
  chunkMs: number[]
}

function usage(): never {
  console.error(
    'usage: bunx tsx evals/asr-ab.ts <audio-file> [--runs 3] [--probe-ms] [--label name] ' +
      '[--ground-truth turns.json] [--segment 8] [--container wav|webm] [--wer] ' +
      '[--via-relay https://origin]',
  )
  process.exit(2)
}

interface Args {
  audioPath: string
  runs: number
  probeMs: boolean
  label: string
  groundTruthPath: string | null
  /** Window width in seconds; `0` transcodes without cutting; `null` posts the file as-is. */
  segmentSeconds: number | null
  container: Container
  wer: boolean
  relayOrigin: string | null
}

function parseArgs(argv: string[]): Args {
  let audioPath: string | null = null
  let runs = 3
  let probeMs = false
  let label: string | null = null
  let groundTruthPath: string | null = null
  let segmentSeconds: number | null = null
  let container: Container = 'wav'
  let wer = false
  let relayOrigin: string | null = null

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
    } else if (arg === '--segment') {
      segmentSeconds = Number(argv[++i])
      if (!Number.isFinite(segmentSeconds) || segmentSeconds < 0) usage()
    } else if (arg === '--container') {
      const value = argv[++i]
      if (value !== 'wav' && value !== 'webm') usage()
      container = value
    } else if (arg === '--wer') {
      wer = true
    } else if (arg === '--via-relay') {
      const value = argv[++i]
      if (value === undefined) usage()
      relayOrigin = value.replace(/\/+$/, '')
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
    segmentSeconds,
    container,
    wer,
    relayOrigin,
  }
}

/**
 * Parsed rather than trusted, by hand: the shared Zod contract for this wire
 * shape arrives with the relay route (#154), and importing zod here would add
 * an undeclared dependency to the evals workspace for one shape.
 */
function parseResponse(body: unknown): Omit<CallResult, 'ms'> {
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

/**
 * The relay answers `HostedAsrResultSchema`, not ILMU's wire shape: no
 * `language`, and the billed seconds arrive as `durationSeconds` because
 * `transcribeWithIlmu` already folded `usage.seconds` into that field. Hand
 * parsed for the same reason as above.
 */
function parseRelayResponse(body: unknown): Omit<CallResult, 'ms'> {
  if (typeof body !== 'object' || body === null) throw new Error('relay body is not an object')
  const record = body as Record<string, unknown>
  if (typeof record.text !== 'string') throw new Error('relay response has no string `text`')
  return {
    text: record.text,
    language: null,
    duration: null,
    usageSeconds: typeof record.durationSeconds === 'number' ? record.durationSeconds : null,
    segments: [],
  }
}

async function transcribeOnce(
  audio: Buffer,
  filename: string,
  mime: string,
  language: string | null,
): Promise<CallResult> {
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

/** Signs in as the guest account and returns the cookie header for later calls.
 * Copied from `run.ts`, which `copilot-proposals.ts` also copies; a shared
 * module would drag two unrelated harnesses into this change. */
async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.EVAL_ORIGIN ?? origin },
  })
  if (!response.ok) {
    throw new Error(`guest sign-in failed: ${response.status} ${await response.text()}`)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length === 0) throw new Error('guest sign-in returned no session cookie')
  return cookies.map((c) => c.split(';')[0]).join('; ')
}

/** The relay takes raw audio bytes with an `audio/*` content type, not multipart. */
async function relayOnce(
  audio: Buffer,
  mime: string,
  origin: string,
  cookie: string,
): Promise<CallResult> {
  const startedAt = Date.now()
  const response = await fetch(`${origin}/api/asr/transcriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': mime,
      Origin: process.env.EVAL_ORIGIN ?? origin,
      Cookie: cookie,
    },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(180_000),
  })
  const ms = Date.now() - startedAt
  if (!response.ok) {
    throw new Error(`relay returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return { ms, ...parseRelayResponse(await response.json()) }
}

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
/** ffmpeg here is a machine-local install, not a repo dependency, so ffprobe is
 * looked for beside it before falling back to PATH. */
const FFPROBE =
  process.env.FFMPEG_PATH === undefined
    ? 'ffprobe'
    : join(dirname(process.env.FFMPEG_PATH), 'ffprobe')

function requireFfmpeg(): void {
  if (spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).error === undefined) return
  console.error(
    `--segment needs ffmpeg, and none was runnable at "${FFMPEG}". Install it or set ` +
      'FFMPEG_PATH to the binary. Nothing was sent.',
  )
  process.exit(2)
}

function probeSeconds(path: string): number {
  const probe = spawnSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { encoding: 'utf8' },
  )
  const seconds = Number(probe.stdout?.trim())
  return Number.isFinite(seconds) ? seconds : 0
}

interface Chunk {
  path: string
  seconds: number
}

/**
 * Cuts the input into fixed windows of `seconds`, or transcodes it whole when
 * `seconds` is 0. The whole-file arm goes through the same encoder as the cut
 * arms on purpose: if the control kept the original codec, a segmentation
 * penalty could not be told apart from a transcoding penalty.
 */
async function cutChunks(
  audioPath: string,
  seconds: number,
  container: Container,
  workDir: string,
): Promise<Chunk[]> {
  const codec = CONTAINER_CODEC[container]
  const args =
    seconds === 0
      ? ['-v', 'error', '-i', audioPath, ...codec, join(workDir, `whole.${container}`)]
      : [
          '-v',
          'error',
          '-i',
          audioPath,
          ...codec,
          '-f',
          'segment',
          '-segment_time',
          String(seconds),
          '-segment_format',
          container,
          '-reset_timestamps',
          '1',
          join(workDir, `chunk-%04d.${container}`),
        ]

  const cut = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  if (cut.status !== 0) {
    throw new Error(`ffmpeg failed (${cut.status}): ${(cut.stderr ?? '').slice(0, 500)}`)
  }

  const names = (await readdir(workDir)).sort()
  const chunks: Chunk[] = []
  for (const name of names) {
    const path = join(workDir, name)
    const length = probeSeconds(path)
    if (length >= MIN_CHUNK_SECONDS) chunks.push({ path, seconds: length })
  }
  if (chunks.length === 0) throw new Error('ffmpeg produced no chunk above the minimum length')
  return chunks
}

/** Folds the calls of one run into a single result, joining chunk texts with
 * single spaces and dropping empties, as the published segmentation script did. */
function foldCalls(calls: CallResult[]): RunResult {
  const first = calls[0]
  if (!first) throw new Error('a run completed no calls')
  const billed = calls.map((c) => c.usageSeconds).filter((s): s is number => s !== null)
  const durations = calls.map((c) => c.duration).filter((d): d is number => d !== null)
  return {
    ms: calls.reduce((total, c) => total + c.ms, 0),
    chunkMs: calls.map((c) => c.ms),
    text: calls
      .map((c) => c.text.trim())
      .filter((t) => t !== '')
      .join(' '),
    language: first.language,
    duration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null,
    usageSeconds: billed.length > 0 ? billed.reduce((a, b) => a + b, 0) : null,
    // Offsets are per chunk and cannot be rebased onto the joined text, so a
    // segmented run reports none rather than a set that would fail integrity
    // against a transcript it never described.
    segments: calls.length === 1 ? first.segments : [],
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  return sorted[index] ?? null
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

const asPercent = (rate: ErrorRate | null): string =>
  rate === null || rate.rate === null ? 'n/a' : `${(rate.rate * 100).toFixed(1)}%`

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
  if (args.wer && args.groundTruthPath === null) {
    console.error('--wer needs --ground-truth; nothing was sent.')
    process.exit(2)
  }
  if (args.probeMs && args.relayOrigin !== null) {
    console.error('--probe-ms cannot go through --via-relay: the route has no language field.')
    process.exit(2)
  }
  if (args.segmentSeconds !== null) requireFfmpeg()

  // Read before spending: a bad path used to surface only after every call was
  // already billed.
  const groundTruth = args.groundTruthPath ? await readGroundTruth(args.groundTruthPath) : null

  const audio = await readFile(args.audioPath)
  const filename = basename(args.audioPath)
  console.log(`${args.label}: ${filename} (${(audio.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  const target =
    args.relayOrigin === null ? `${MODEL} at ${BASE_URL}` : `relay at ${args.relayOrigin}`
  console.log(`model ${target}, ${args.runs} run(s)${args.probeMs ? ' + ms probe' : ''}`)

  const workDir = await mkdtemp(join(tmpdir(), 'asr-ab-'))
  try {
    let posts: { audio: Buffer; filename: string; mime: string; seconds: number | null }[]
    if (args.segmentSeconds === null) {
      posts = [{ audio, filename, mime, seconds: null }]
    } else {
      const chunks = await cutChunks(args.audioPath, args.segmentSeconds, args.container, workDir)
      const chunkMime = MIME_BY_EXTENSION[`.${args.container}`] ?? 'audio/wav'
      posts = await Promise.all(
        chunks.map(async (chunk) => ({
          audio: await readFile(chunk.path),
          filename: basename(chunk.path),
          mime: chunkMime,
          seconds: chunk.seconds,
        })),
      )
      const width = args.segmentSeconds === 0 ? 'whole file, transcoded' : `${args.segmentSeconds}s`
      console.log(`cut into ${posts.length} ${args.container} chunk(s) at ${width}`)
    }

    const cookie = args.relayOrigin === null ? null : await signIn(args.relayOrigin)
    const paced = args.relayOrigin !== null && posts.length > 1
    if (paced) {
      console.log(
        `pacing ${RELAY_PACE_MS / 1000}s between calls: the relay bucket is 5/min, so the ` +
          'wall clock is not the latency',
      )
    }

    const post = async (item: (typeof posts)[number], language: string | null) =>
      args.relayOrigin === null || cookie === null
        ? transcribeOnce(item.audio, item.filename, item.mime, language)
        : relayOnce(item.audio, item.mime, args.relayOrigin, cookie)

    const runOnce = async (language: string | null): Promise<RunResult> => {
      const calls: CallResult[] = []
      for (const [index, item] of posts.entries()) {
        if (paced && index > 0) await sleep(RELAY_PACE_MS)
        calls.push(await post(item, language))
      }
      return foldCalls(calls)
    }

    const runs: RunResult[] = []
    for (let i = 0; i < args.runs; i += 1) {
      const run = await runOnce(null)
      runs.push(run)
      const scored =
        groundTruth && args.wer ? ` WER ${asPercent(wordErrorRate(groundTruth, run.text))}` : ''
      console.log(
        `  run ${i + 1}: ${(run.ms / 1000).toFixed(1)}s total, ${run.chunkMs.length} call(s), ${run.segments.length} segments, language=${run.language ?? '?'}, duration=${run.duration ?? run.usageSeconds ?? '?'}${scored}`,
      )
    }
    const probe = args.probeMs ? await runOnce('ms') : null
    if (probe) {
      console.log(`  ms probe: ${(probe.ms / 1000).toFixed(1)}s, ${probe.segments.length} segments`)
    }

    const first = runs[0]
    if (!first) throw new Error('no runs completed')
    const texts = new Set(runs.map((r) => r.text))
    const segmentSets = new Set(runs.map((r) => JSON.stringify(r.segments)))
    const deterministic = texts.size === 1 && segmentSets.size === 1
    const integrity = checkIntegrity(first.segments, first.text)

    const wordRates = groundTruth ? runs.map((r) => wordErrorRate(groundTruth, r.text)) : []
    const charRates = groundTruth ? runs.map((r) => characterErrorRate(groundTruth, r.text)) : []
    const chunkLatencies = runs.flatMap((r) => r.chunkMs)

    const verboseHonoured =
      first.segments.length > 0 || first.duration !== null || first.language !== null
    console.log(`  deterministic across ${args.runs} run(s): ${deterministic ? 'yes' : 'NO'}`)
    console.log(`  verbose_json honoured: ${verboseHonoured ? 'yes' : 'no'}`)
    console.log(
      `  usable() verdict: ${integrity.usable ? 'pass' : `FAIL (${integrity.failures.join('; ')})`}`,
    )
    if (args.wer) {
      console.log(
        `  aggregate WER ${asPercent(aggregate(wordRates))}, CER ${asPercent(aggregate(charRates))}`,
      )
    }

    const segmented = args.segmentSeconds !== null
    const missing = args.relayOrigin === null ? '?' : 'n/a'
    const columns = [
      'Run',
      'Latency',
      ...(segmented ? ['Calls', 'Chunk p50', 'Chunk p90'] : []),
      'Segments',
      'Detected Language',
      'Reported Duration',
      'Billed Seconds',
      ...(args.wer ? ['WER', 'CER'] : []),
    ]
    const runRow = (name: string, r: RunResult, index: number | null): string => {
      const cells = [
        name,
        `${(r.ms / 1000).toFixed(1)}s`,
        ...(segmented
          ? [
              String(r.chunkMs.length),
              `${((percentile(r.chunkMs, 0.5) ?? 0) / 1000).toFixed(1)}s`,
              `${((percentile(r.chunkMs, 0.9) ?? 0) / 1000).toFixed(1)}s`,
            ]
          : []),
        String(r.segments.length),
        r.language ?? missing,
        String(r.duration ?? missing),
        String(r.usageSeconds ?? missing),
        ...(args.wer
          ? [
              asPercent(index === null ? null : (wordRates[index] ?? null)),
              asPercent(index === null ? null : (charRates[index] ?? null)),
            ]
          : []),
      ]
      return `| ${cells.join(' | ')} |`
    }

    const startedAt = new Date().toISOString()
    const lines = [
      `# ASR A/B: ${args.label}`,
      '',
      `- **When:** ${startedAt}`,
      `- **Model:** \`${MODEL}\` at ${args.relayOrigin ?? BASE_URL}`,
      `- **Path:** ${args.relayOrigin === null ? 'direct to provider' : 'through the deployed relay'}`,
      `- **File:** ${filename} (${audio.byteLength} bytes)`,
      `- **Runs:** ${args.runs}${args.probeMs ? ' plus one language=ms probe' : ''}`,
      ...(segmented
        ? [
            `- **Segmentation:** ${args.segmentSeconds === 0 ? 'whole file, transcoded, no cuts' : `fixed ${args.segmentSeconds}s windows`}, ${args.container}, ${first.chunkMs.length} chunk(s) per run`,
          ]
        : ['- **Segmentation:** none, the file was posted as-is']),
      ...(groundTruth
        ? [`- **Scored:** ${args.wer ? 'yes' : 'no, ground truth printed only'}`]
        : []),
      '',
      '## Runs',
      '',
      `| ${columns.join(' | ')} |`,
      `| ${columns.map(() => '---').join(' | ')} |`,
      ...runs.map((r, i) => runRow(String(i + 1), r, i)),
      ...(probe ? [runRow('ms probe', probe, null)] : []),
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
      ...(args.wer
        ? [
            `- **Aggregate WER:** ${asPercent(aggregate(wordRates))} over ${aggregate(wordRates).units} reference words`,
            `- **Aggregate CER:** ${asPercent(aggregate(charRates))} over ${aggregate(charRates).units} reference characters`,
          ]
        : []),
      ...(segmented
        ? [
            '',
            '## Chunks',
            '',
            `- **Count per run:** ${first.chunkMs.length}`,
            `- **Per-chunk latency p50:** ${((percentile(chunkLatencies, 0.5) ?? 0) / 1000).toFixed(2)}s`,
            `- **Per-chunk latency p90:** ${((percentile(chunkLatencies, 0.9) ?? 0) / 1000).toFixed(2)}s`,
            `- **Paced:** ${paced ? `yes, ${RELAY_PACE_MS / 1000}s between calls, excluded from the latencies above` : 'no'}`,
          ]
        : []),
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
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

await main()
