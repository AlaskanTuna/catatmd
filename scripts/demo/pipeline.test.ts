import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const schedule = join(import.meta.dir, 'schedule.py')
const assemble = join(import.meta.dir, 'assemble.sh')
const narrate = join(import.meta.dir, 'narrate.sh')
const subtitles = join(import.meta.dir, 'subtitles.py')
const speak = join(import.meta.dir, 'speak.py')
const narration = join(import.meta.dir, 'narration.txt')
const scratchDirs: string[] = []
const NBSP = String.fromCharCode(160)

// Every test below drives the real ffmpeg, ffprobe and python3, because the thing being checked is
// whether the pipeline actually produces a video rather than whether a mock was called. CI has none
// of those three installed, and a suite that goes red there for want of a codec says nothing about
// this code. Skipping is the same call the gateway and database tests already make: the external
// tool IS the fixture, so without it there is no test to run.
const TOOLS = ['ffmpeg', 'ffprobe', 'python3']
const missing = TOOLS.filter((binary) => Bun.which(binary) === null)
if (missing.length > 0)
  console.log(`demo pipeline tests skipped, not installed: ${missing.join(', ')}`)

const missingPdfTools = ['pdfinfo', 'pdftoppm'].some((binary) => Bun.which(binary) === null)
// Synthetic timeline fixtures exercise scheduling; these are not measured application runs.
const narrationBeats = [
  { name: 'open', ms: 0 },
  { name: 'landing', ms: 13_000 },
  { name: 'shot-1', ms: 30_000 },
  { name: 'shot-2', ms: 46_000 },
  { name: 'shot-3', ms: 59_000 },
  { name: 'shot-4', ms: 80_000 },
  { name: 'shot-5', ms: 133_000 },
  { name: 'shot-6', ms: 142_000 },
  { name: 'shot-7', ms: 155_000 },
  { name: 'shot-8', ms: 203_000 },
  { name: 'shot-9', ms: 215_000 },
  { name: 'shot-10', ms: 233_000 },
  { name: 'stack', ms: 255_000 },
  { name: 'close', ms: 271_000 },
  { name: 'end', ms: 286_000 },
]

const browserBeats = [
  { name: 'open', ms: 200 },
  { name: 'landing', ms: 500 },
  { name: 'shot-1', ms: 1_000 },
  { name: 'shot-2', ms: 14_000 },
  { name: 'shot-3', ms: 25_000 },
  { name: 'shot-4', ms: 38_000 },
  { name: 'shot-5', ms: 55_000 },
  { name: 'shot-6', ms: 68_000 },
  { name: 'shot-7', ms: 80_000 },
  { name: 'shot-8', ms: 92_000 },
  { name: 'shot-9', ms: 100_000 },
  { name: 'shot-10', ms: 108_000 },
  { name: 'stack', ms: 112_000 },
  { name: 'close', ms: 116_000 },
  { name: 'end', ms: 120_000 },
]

// These cases write audio, video and font fixtures, and the system temp dir on this machine is a 1 GB tmpfs shared
// with every other session. When it fills, the suite fails with ENOSPC, which names the symptom and not the cause.
// Defaulting to the cache directory puts the fixtures on real disk without anyone having to remember to export
// TMPDIR first; DEMO_SCRATCH overrides it for a run that wants them somewhere specific.
const scratchRoot =
  process.env.DEMO_SCRATCH ??
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'catatmd-demo', 'test')

function makeScratchDir() {
  mkdirSync(scratchRoot, { recursive: true })
  const path = mkdtempSync(join(scratchRoot, 'pipeline-'))
  scratchDirs.push(path)
  writeFileSync(join(path, 'take-ok'), 'catatmd-demo-v1\n')
  return path
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function runSchedule(...args: string[]) {
  const result = Bun.spawnSync(['python3', schedule, ...args])
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

function run(...command: string[]) {
  const result = Bun.spawnSync(command)
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

afterEach(() => {
  for (const path of scratchDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe.skipIf(missing.length > 0)('demo timeline assembly', () => {
  test('plans slide starts from the measured capture duration', () => {
    const demoDir = makeScratchDir()
    writeJson(join(demoDir, 'beats.json'), browserBeats)

    const result = runSchedule('plan-slides', demoDir, '120000', '3', '285000')

    expect(result.exitCode).toBe(0)
    expect(readJson(join(demoDir, 'slides.json'))).toEqual([
      { name: 'slide-1', ms: 120_000, duration_ms: 55_000 },
      { name: 'slide-2', ms: 175_000, duration_ms: 55_000 },
      { name: 'slide-3', ms: 230_000, duration_ms: 55_000 },
    ])
  })

  test('preserves measured shot offsets when slide beats are applied', () => {
    const demoDir = makeScratchDir()
    writeJson(join(demoDir, 'beats.json'), browserBeats)
    expect(runSchedule('plan-slides', demoDir, '120000', '3', '285000').exitCode).toBe(0)

    const result = runSchedule('apply-slides', demoDir)
    const beats = readJson(join(demoDir, 'beats.json'))

    expect(result.exitCode).toBe(0)
    expect(beats).toEqual([
      ...browserBeats.slice(0, -1),
      { name: 'slide-1', ms: 120_000 },
      { name: 'slide-2', ms: 175_000 },
      { name: 'slide-3', ms: 230_000 },
      { name: 'end', ms: 285_000 },
    ])
  })

  test('rejects a capture missing one of the recorder beats', () => {
    const demoDir = makeScratchDir()
    writeJson(
      join(demoDir, 'beats.json'),
      browserBeats.filter((beat) => beat.name !== 'shot-5'),
    )

    const result = runSchedule('plan-slides', demoDir, '120000', '3', '285000')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing required beat shot-5')
  })

  test('rejects a target that leaves no readable time for the deck', () => {
    const demoDir = makeScratchDir()
    writeJson(join(demoDir, 'beats.json'), browserBeats)

    const result = runSchedule('plan-slides', demoDir, '120000', '3', '130000')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('at least 5 seconds per slide')
  })

  test.skipIf(missingPdfTools)(
    'joins every deck page after the capture and publishes their beats',
    async () => {
      const demoDir = makeScratchDir()
      const deckPath = join(demoDir, 'source-deck.pdf')
      const ffmpegWrapper = join(demoDir, 'ffmpeg-wrapper.sh')
      const deckHashBefore = new Bun.CryptoHasher('sha256')
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << >> >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << >> >>',
      ]
      let pdf = '%PDF-1.4\n'
      const offsets = [0]
      for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf))
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
      }
      const xref = Buffer.byteLength(pdf)
      pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      writeFileSync(deckPath, pdf)
      deckHashBefore.update(readFileSync(deckPath))

      const video = run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=320x180:r=10',
        '-t',
        '10',
        '-c:v',
        'libvpx-vp9',
        join(demoDir, 'capture.webm'),
      )
      expect(video.exitCode).toBe(0)
      writeFileSync(
        ffmpegWrapper,
        ['#!/usr/bin/env bash', 'IFS= read -r -n 1 _ || true', 'exec ffmpeg "$@"', ''].join('\n'),
      )
      chmodSync(ffmpegWrapper, 0o755)
      writeJson(
        join(demoDir, 'beats.json'),
        browserBeats.map((beat, index) => ({
          ...beat,
          ms: beat.name === 'end' ? 9_800 : (index + 1) * 600,
        })),
      )

      const result = Bun.spawnSync(['bash', assemble], {
        env: {
          ...process.env,
          DEMO_DECK: deckPath,
          DEMO_DIR: demoDir,
          DEMO_FFMPEG: ffmpegWrapper,
          DEMO_FPS: '10',
          DEMO_PRESET: 'ultrafast',
          DEMO_TOTAL_SECONDS: '20',
        },
      })

      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(existsSync(join(demoDir, 'capture-joined.mp4'))).toBe(true)
      expect(readJson(join(demoDir, 'beats.json'))).toEqual([
        ...browserBeats.slice(0, -1).map((beat, index) => ({ ...beat, ms: (index + 1) * 600 })),
        { name: 'slide-1', ms: 10_000 },
        { name: 'slide-2', ms: 15_000 },
        { name: 'end', ms: 20_000 },
      ])
      expect(new Bun.CryptoHasher('sha256').update(readFileSync(deckPath)).digest('hex')).toBe(
        deckHashBefore.digest('hex'),
      )
      const dimensions = run(
        'ffprobe',
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0:s=x',
        join(demoDir, 'capture-joined.mp4'),
      )
      expect(dimensions.stdout.trim()).toBe('1920x1080')
    },
    30_000,
  )
})

describe.skipIf(missing.length > 0)('demo narration scheduling', () => {
  test('resolves narration from named beats instead of nominal timestamps', () => {
    const demoDir = makeScratchDir()
    const script = join(demoDir, 'narration.txt')
    writeJson(join(demoDir, 'beats.json'), browserBeats)
    writeFileSync(
      script,
      '# beat | offset_ms | text\nslide-2 | 500 | The deck follows.\nshot-1 | 250 | The capture starts.\n',
    )
    expect(runSchedule('plan-slides', demoDir, '120000', '3', '285000').exitCode).toBe(0)
    expect(runSchedule('apply-slides', demoDir).exitCode).toBe(0)

    const result = runSchedule('resolve', demoDir, script)

    expect(result.exitCode).toBe(0)
    expect(readJson(join(demoDir, 'lines.json'))).toEqual([
      { beat: 'shot-1', offset_ms: 250, ms: 1_250, text: 'The capture starts.' },
      { beat: 'slide-2', offset_ms: 500, ms: 175_500, text: 'The deck follows.' },
    ])
  })

  test('rejects narration that names a beat absent from the measured take', () => {
    const demoDir = makeScratchDir()
    const script = join(demoDir, 'narration.txt')
    writeJson(join(demoDir, 'beats.json'), browserBeats)
    writeFileSync(script, 'slide-1 | 0 | This slide was never assembled.\n')

    const result = runSchedule('resolve', demoDir, script)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unknown beat 'slide-1'")
  })

  test('pushes a line later when the prior wav is still speaking', () => {
    const demoDir = makeScratchDir()
    const segmentDir = join(demoDir, 'narration-segments')
    mkdirSync(segmentDir)
    writeJson(join(demoDir, 'lines.json'), [
      { beat: 'shot-1', offset_ms: 0, ms: 1_000, text: 'First line.' },
      { beat: 'shot-2', offset_ms: 0, ms: 1_500, text: 'Second line.' },
    ])
    for (const [index, duration] of [1, 0.5].entries()) {
      expect(
        run(
          'ffmpeg',
          '-y',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=8000:cl=mono',
          '-t',
          String(duration),
          '-c:a',
          'pcm_s16le',
          join(segmentDir, `${index}.wav`),
        ).exitCode,
      ).toBe(0)
    }

    const result = runSchedule('deconflict', demoDir)

    expect(result.exitCode).toBe(0)
    expect(readJson(join(demoDir, 'lines.json'))).toEqual([
      { beat: 'shot-1', offset_ms: 0, ms: 1_000, text: 'First line.', dur_ms: 1_000 },
      { beat: 'shot-2', offset_ms: 0, ms: 2_260, text: 'Second line.', dur_ms: 500 },
    ])
  })

  test('keeps padded one-line captions on the bottom track until the next line starts', () => {
    const demoDir = makeScratchDir()
    const segmentDir = join(demoDir, 'narration-segments')
    mkdirSync(segmentDir)
    writeFileSync(join(demoDir, 'narration-top.srt'), 'stale top caption\n')
    writeJson(join(demoDir, 'lines.json'), [
      { beat: 'shot-1', offset_ms: 0, ms: 1_000, text: 'First caption.' },
      { beat: 'shot-2', offset_ms: 0, ms: 2_500, text: 'Second caption.' },
    ])
    for (const [index, duration] of [2, 1].entries()) {
      expect(
        run(
          'ffmpeg',
          '-y',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=8000:cl=mono',
          '-t',
          String(duration),
          '-c:a',
          'pcm_s16le',
          join(segmentDir, `${index}.wav`),
        ).exitCode,
      ).toBe(0)
    }

    const result = run('python3', subtitles, demoDir)

    expect(result.exitCode).toBe(0)
    expect(readFileSync(join(demoDir, 'narration.srt'), 'utf8')).toBe(
      [
        '1',
        '00:00:01,000 --> 00:00:02,500',
        `${NBSP}First caption.${NBSP}`,
        '',
        '2',
        '00:00:02,500 --> 00:00:03,500',
        `${NBSP}Second caption.${NBSP}`,
        '',
      ].join('\n'),
    )
    expect(readFileSync(join(demoDir, 'narration-top.srt'), 'utf8')).toBe('')
  })

  test('writes two-line subtitles to synchronized independent tracks', () => {
    const demoDir = makeScratchDir()
    const segmentDir = join(demoDir, 'narration-segments')
    mkdirSync(segmentDir)
    writeJson(join(demoDir, 'lines.json'), [
      {
        beat: 'shot-1',
        offset_ms: 0,
        ms: 1_000,
        text: 'Independent black bands keep wrapped subtitle lines clearly separated.',
      },
    ])
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=8000:cl=mono',
        '-t',
        '2',
        '-c:a',
        'pcm_s16le',
        join(segmentDir, '0.wav'),
      ).exitCode,
    ).toBe(0)

    const result = run('python3', subtitles, demoDir)
    const timing = '00:00:01,000 --> 00:00:03,000'

    expect(result.exitCode).toBe(0)
    expect(readFileSync(join(demoDir, 'narration-top.srt'), 'utf8')).toBe(
      ['1', timing, `${NBSP}Independent black bands keep wrapped${NBSP}`, ''].join('\n'),
    )
    expect(readFileSync(join(demoDir, 'narration.srt'), 'utf8')).toBe(
      ['1', timing, `${NBSP}subtitle lines clearly separated.${NBSP}`, ''].join('\n'),
    )
  })

  test('splits long narration into readable two-line subtitle cards', () => {
    const demoDir = makeScratchDir()
    const segmentDir = join(demoDir, 'narration-segments')
    const text =
      'Each review keeps its clinical note, safety panels, and cited sources beside the findings so a clinician can inspect the evidence before deciding.'
    mkdirSync(segmentDir)
    writeJson(join(demoDir, 'lines.json'), [{ beat: 'slide-7', offset_ms: 0, ms: 1_000, text }])
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=8000:cl=mono',
        '-t',
        '6',
        '-c:a',
        'pcm_s16le',
        join(segmentDir, '0.wav'),
      ).exitCode,
    ).toBe(0)

    const result = run('python3', subtitles, demoDir)
    const bottomBlocks = readFileSync(join(demoDir, 'narration.srt'), 'utf8').trim().split('\n\n')
    const topBlocks = readFileSync(join(demoDir, 'narration-top.srt'), 'utf8').trim().split('\n\n')
    const captionLines = [...topBlocks, ...bottomBlocks]
      .flatMap((block) => block.split('\n').slice(2))
      .map((line) => line.replaceAll(NBSP, ''))

    expect(result.exitCode).toBe(0)
    expect(bottomBlocks).toHaveLength(2)
    expect(topBlocks).toHaveLength(2)
    expect(captionLines.every((line) => line.length <= 42)).toBe(true)
    expect(bottomBlocks[0]).toContain('00:00:01,000 -->')
    expect(bottomBlocks[1]).toContain('--> 00:00:07,000')
    expect(captionLines.at(-1)?.split(' ').length).toBeGreaterThan(2)
  })

  test('reports missing Kokoro assets before trying to synthesize', () => {
    const demoDir = makeScratchDir()
    const result = Bun.spawnSync({
      cmd: ['python3', speak, join(demoDir, 'line.wav')],
      env: { ...process.env, KOKORO_HOME: demoDir },
      stdin: Buffer.from('A clinician reviews the evidence.'),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('missing Kokoro model')
    expect(existsSync(join(demoDir, 'line.wav'))).toBe(false)
  })

  test('keeps every scripted line inside its measured shot or slide', () => {
    const demoDir = makeScratchDir()
    writeJson(join(demoDir, 'beats.json'), narrationBeats)
    expect(runSchedule('plan-slides', demoDir, '286000', '11', '440000').exitCode).toBe(0)
    expect(runSchedule('apply-slides', demoDir).exitCode).toBe(0)

    const result = runSchedule('resolve', demoDir, narration)
    expect(result.exitCode).toBe(0)
    const lines = readJson(join(demoDir, 'lines.json')) as Array<{ beat: string; ms: number }>
    const beats = readJson(join(demoDir, 'beats.json')) as Array<{ name: string; ms: number }>
    const starts = new Map(beats.map((beat) => [beat.name, beat.ms]))
    const expectedBeats = Array.from({ length: 10 }, (_, i) => `shot-${i + 1}`)
    expect(new Set(lines.map((line) => line.beat))).toEqual(new Set(expectedBeats))
    for (const line of lines) {
      const beatIndex = beats.findIndex((beat) => beat.name === line.beat)
      expect(line.ms).toBeGreaterThanOrEqual(starts.get(line.beat) ?? Number.POSITIVE_INFINITY)
      expect(line.ms).toBeLessThan(beats[beatIndex + 1]?.ms ?? 0)
    }
  })

  test('muxes scheduled speech and burned subtitles into the joined video', () => {
    const demoDir = makeScratchDir()
    const source = join(demoDir, 'capture-joined.mp4')
    const output = join(demoDir, 'finished.mp4')
    const script = join(demoDir, 'narration.txt')
    const fakeSpeak = join(demoDir, 'fake-speak.py')
    const ffmpegLog = join(demoDir, 'ffmpeg.log')
    const ffmpegWrapper = join(demoDir, 'ffmpeg-wrapper.sh')
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=320x180:r=10',
        '-t',
        '5',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        source,
      ).exitCode,
    ).toBe(0)
    writeJson(
      join(demoDir, 'beats.json'),
      browserBeats.map((beat, index) => ({
        ...beat,
        ms: beat.name === 'end' ? 5_000 : (index + 1) * 100,
      })),
    )
    writeFileSync(
      script,
      'shot-1 | 100 | Independent black bands keep wrapped subtitle lines clearly separated.\n',
    )
    writeFileSync(
      ffmpegWrapper,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$*" >> "$DEMO_FFMPEG_LOG"',
        'exec ffmpeg "$@"',
        '',
      ].join('\n'),
    )
    chmodSync(ffmpegWrapper, 0o755)
    writeFileSync(
      fakeSpeak,
      [
        'import sys, wave',
        'sys.stdin.read()',
        "with wave.open(sys.argv[1], 'wb') as audio:",
        '    audio.setnchannels(1)',
        '    audio.setsampwidth(2)',
        '    audio.setframerate(8000)',
        "    audio.writeframes(b'\\x00\\x00' * 8000)",
        '',
      ].join('\n'),
    )

    const result = Bun.spawnSync(['bash', narrate], {
      env: {
        ...process.env,
        DEMO_DIR: demoDir,
        DEMO_FFMPEG: ffmpegWrapper,
        DEMO_FFMPEG_LOG: ffmpegLog,
        DEMO_SOURCE: source,
        DEMO_FPS: '10',
        DEMO_OUT: output,
        DEMO_PRESET: 'ultrafast',
        DEMO_PYTHON: 'python3',
        DEMO_SCRIPT: script,
        DEMO_SPEAK: fakeSpeak,
      },
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(existsSync(output)).toBe(true)
    expect(readFileSync(join(demoDir, 'narration-top.srt'), 'utf8')).toContain(
      'Independent black bands keep wrapped',
    )
    expect(readFileSync(join(demoDir, 'narration.srt'), 'utf8')).toContain(
      'subtitle lines clearly separated.',
    )
    const ffmpegCalls = readFileSync(ffmpegLog, 'utf8')
    const bottomFilter = ffmpegCalls.indexOf('subtitles=filename=narration.srt')
    const topFilter = ffmpegCalls.indexOf('subtitles=filename=narration-top.srt')
    expect(bottomFilter).toBeGreaterThan(-1)
    expect(topFilter).toBeGreaterThan(bottomFilter)
    const streams = run(
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height',
      '-of',
      'csv=p=0',
      output,
    )
    expect(streams.stdout).toContain('video,1920,1080')
    expect(streams.stdout).toContain('audio')
  }, 30_000)

  // The bed is used on a decision rather than a licence, so the two things that make that decision legible in the
  // artifact are the credit inside the file and the voice-only twin beside it. Both are cheap to lose in a refactor
  // and neither throws when it goes missing, so they are asserted rather than trusted.
  const stageNarrateFixture = () => {
    const demoDir = makeScratchDir()
    const source = join(demoDir, 'capture-joined.mp4')
    const script = join(demoDir, 'narration.txt')
    const fakeSpeak = join(demoDir, 'fake-speak.py')
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=320x180:r=10',
        '-t',
        '5',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        source,
      ).exitCode,
    ).toBe(0)
    writeJson(
      join(demoDir, 'beats.json'),
      browserBeats.map((beat, index) => ({
        ...beat,
        ms: beat.name === 'end' ? 5_000 : (index + 1) * 100,
      })),
    )
    writeFileSync(script, 'shot-1 | 100 | The credit rides in the file.\n')
    writeFileSync(
      fakeSpeak,
      [
        'import sys, wave',
        'sys.stdin.read()',
        "with wave.open(sys.argv[1], 'wb') as audio:",
        '    audio.setnchannels(1)',
        '    audio.setsampwidth(2)',
        '    audio.setframerate(8000)',
        "    audio.writeframes(b'\\x00\\x00' * 8000)",
        '',
      ].join('\n'),
    )
    return { demoDir, output: join(demoDir, 'finished.mp4'), script, fakeSpeak }
  }

  const narrateEnv = (
    fixture: ReturnType<typeof stageNarrateFixture>,
    extra: Record<string, string>,
  ) => ({
    ...process.env,
    DEMO_DIR: fixture.demoDir,
    DEMO_FPS: '10',
    DEMO_OUT: fixture.output,
    DEMO_PRESET: 'ultrafast',
    DEMO_PYTHON: 'python3',
    DEMO_SCRIPT: fixture.script,
    DEMO_SOURCE: join(fixture.demoDir, 'capture-joined.mp4'),
    DEMO_SPEAK: fixture.fakeSpeak,
    ...extra,
  })

  test('refuses a bed that is not credited, before spending the run on speech', () => {
    const fixture = stageNarrateFixture()
    const music = join(fixture.demoDir, 'bed.wav')
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=220:duration=20',
        music,
      ).exitCode,
    ).toBe(0)

    const result = Bun.spawnSync(['bash', narrate], {
      env: narrateEnv(fixture, { DEMO_MUSIC: music }),
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('DEMO_MUSIC_CREDIT')
    expect(existsSync(fixture.output)).toBe(false)
    // The guard is worth nothing if it fires after the expensive half of the run.
    expect(existsSync(join(fixture.demoDir, 'narration.wav'))).toBe(false)
  }, 30_000)

  test('credits the bed in the film and leaves a voice-only twin beside it', () => {
    const fixture = stageNarrateFixture()
    const music = join(fixture.demoDir, 'bed.wav')
    expect(
      run(
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=220:duration=20',
        music,
      ).exitCode,
    ).toBe(0)

    const result = Bun.spawnSync(['bash', narrate], {
      env: narrateEnv(fixture, { DEMO_MUSIC: music, DEMO_MUSIC_CREDIT: 'A Named Source' }),
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const silent = join(fixture.demoDir, 'finished-silent.mp4')
    expect(existsSync(silent)).toBe(true)

    const tagOf = (file: string) =>
      run(
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'format_tags=comment',
        '-of',
        'csv=p=0',
        file,
      ).stdout.trim()
    expect(tagOf(fixture.output)).toBe('Music: A Named Source')
    expect(tagOf(silent)).toBe('')

    // Same picture, different audio: the twin is a re-mux of the film, not a second take of it.
    const videoOf = (file: string) =>
      run('ffmpeg', '-nostdin', '-v', 'error', '-i', file, '-map', '0:v', '-f', 'md5', '-').stdout
    expect(videoOf(silent)).toBe(videoOf(fixture.output))
    expect(readFileSync(fixture.output)).not.toEqual(readFileSync(silent))

    // Video first in both, because every take before the bed existed put it there.
    for (const file of [fixture.output, silent]) {
      const order = run(
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type',
        '-of',
        'csv=p=0',
        file,
      )
      expect(order.stdout.trim().split('\n')).toEqual(['0,video', '1,audio'])
    }
  }, 90_000)
})

// narration.txt holds the spoken lines and record.mjs holds the beat budgets, in two files that must agree. They
// drifted once already, when #166 re-chained shot-7's offsets and the recorder's budgets were not re-checked, and
// the failure would have been a line still being spoken over the start of the next beat rather than anything that
// throws. These cases read both files as they ship and refuse that drift.
describe('the narration fits the beats the recorder films', () => {
  // Kokoro at the voice the film uses, measured rather than assumed: 175 words per minute, not the 155 first taken
  // from the docs. This estimates a line's spoken length closely enough to catch drift, and is not a substitute for
  // the measured beats.json a real take produces.
  const WPM = 175
  const spokenMs = (text: string) => (text.split(/\s+/).filter(Boolean).length / WPM) * 60_000

  const source = readFileSync(join(import.meta.dir, 'workflow.mjs'), 'utf8')
  const budgets = new Map<string, number>()
  for (const [, name, value] of source.matchAll(/finishShot\('([a-z0-9-]+)', ([\d_]+)\)/g)) {
    budgets.set(name, Number(value.replaceAll('_', '')))
  }

  const script: Array<{ beat: string; offset: number; text: string }> = []
  for (const line of readFileSync(narration, 'utf8').split('\n')) {
    const match = /^(\S+) \| (\d+) \| (.*)$/.exec(line.trim())
    if (match?.[1] && match[2] && match[3])
      script.push({ beat: match[1], offset: Number(match[2]), text: match[3] })
  }

  const order = [...new Set(script.map((line) => line.beat))]

  // The regex above is the only link between this file and the recorder's budgets, so it checks its own catch rather
  // than silently skipping a call written in a shape it does not match.
  test('reads a budget for every awaited finishShot call in the recorder', () => {
    const awaited = [...source.matchAll(/await finishShot\(/g)].length
    expect(budgets.size).toBe(awaited)
    expect(budgets.size).toBeGreaterThan(0)
  })

  test('gives every beat in the narration a budget in the recorder', () => {
    expect(order.filter((beat) => !budgets.has(beat))).toEqual([])
  })

  // The assertion is that a line clears the next line, not that it fits inside its own beat. A line is allowed to run
  // past its beat's end, because the next beat opens with its own lead-in offset before anyone speaks again. Asserting
  // the narrower thing reports beats as broken when they are not: shot-8 runs 29ms past its budget and is fine.
  test('leaves every line finished before the next one starts', () => {
    const seams = order.slice(0, -1).map((beat, index) => {
      const lines = script.filter((line) => line.beat === beat)
      const ends = Math.max(...lines.map((line) => line.offset + spokenMs(line.text)))
      const next = order[index + 1] as string
      const starts =
        (budgets.get(beat) as number) + (script.find((line) => line.beat === next)?.offset ?? 0)
      return { beat, gap: starts - ends }
    })
    expect(seams.filter((seam) => seam.gap < 0).map((seam) => seam.beat)).toEqual([])
  })

  test('keeps nominal shot holds below five minutes, excluding navigation and analysis latency', () => {
    const total = [...budgets.values()].reduce((sum, value) => sum + value, 0)
    expect(total).toBeLessThanOrEqual(300_000)
  })
})
