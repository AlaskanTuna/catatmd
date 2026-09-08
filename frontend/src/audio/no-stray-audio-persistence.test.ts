import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Consultation audio stays in memory, and nothing may quietly change that
 * (#293).
 *
 * This is the SPA half of the same argument `no-stray-websocket.test.ts` makes:
 * an invariant the type system cannot express, covering a place no server check
 * can see. The claim being defended is stated in `session-audio.ts` and in
 * `.claude/rules/security.md`: a recording is the one kind of PHI that cannot
 * be de-identified, because a voice is an identifier in its own right, so it is
 * held for the review session and never written down or sent anywhere.
 *
 * A source scan rather than a behavioural test because the failure it guards
 * against is a future edit, not a bug in today's code. Someone adding an
 * "keep the audio between sessions" convenience would not think to delete this
 * test, and that is exactly the point.
 */

const AUDIO_DIR = join(import.meta.dirname, '.')

/**
 * Storage APIs that outlive the tab. `localStorage` is allowed exactly one key
 * repo-wide (the theme) and that key does not live here, so under `audio/` any
 * hit at all is a finding.
 */
const PERSISTENCE = /\b(localStorage|sessionStorage|indexedDB|showSaveFilePicker)\b/

/**
 * The one module under `audio/` allowed to touch persistent storage, and why.
 *
 * `audio-settings.ts` remembers the device's chosen engine, capture mode and
 * microphone. `.claude/rules/security.md` describes that preference as one of
 * the two halves of the ASR consent rule, so it is deliberate rather than
 * tolerated. It holds configuration and never content: no transcript, no
 * recording, no consultation id.
 *
 * Adding a name here is a decision about where PHI may rest. Make it in
 * review, not by widening the pattern.
 */
const MAY_PERSIST = new Set(['audio-settings.ts'])

/**
 * Sending a recording anywhere. The two audio egresses this app has are the
 * ILMU relay in `AudioCapture` and the Soniox socket in `live/`, both of which
 * predate this rule and are governed by `.claude/rules/security.md`; what must
 * never appear is a *third* one carrying the retained blob, which is what an
 * upload of `session-audio`'s contents would be.
 */
const UPLOAD = /\b(?:api\.[A-Za-z]*[Uu]pload|uploadRecording|putObject|createUpload)\b/

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
    found.push(path)
  }
  return found
}

describe('audio is never persisted', () => {
  const files = sourceFiles(AUDIO_DIR)

  it('scans a non-trivial number of files, so a broken glob cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files.map((path) => [path.slice(AUDIO_DIR.length + 1), path] as const))(
    '%s reaches for no storage that outlives the tab',
    (name, path) => {
      const hits = readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => [index + 1, line] as const)
        // A comment saying why this is banned must not itself trip the ban.
        .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter(([, line]) => PERSISTENCE.test(line))

      const allowed = MAY_PERSIST.has(name.replaceAll('\\', '/'))
      expect(allowed ? [] : hits, `${path} persists audio or clinical content`).toEqual([])
    },
  )

  it('states which modules are allowed to persist, so the list is reviewable', () => {
    expect([...MAY_PERSIST]).toEqual(['audio-settings.ts'])
  })

  it.each(files.map((path) => [path.slice(AUDIO_DIR.length + 1), path] as const))(
    '%s adds no new upload of a retained recording',
    (_name, path) => {
      const hits = readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter(([, line]) => UPLOAD.test(line))

      expect(hits, `${path} looks like a new audio egress`).toEqual([])
    },
  )

  it('keeps the retained recording in exactly one module', () => {
    const holders = sourceFiles(AUDIO_DIR).filter((path) =>
      /\bURL\.createObjectURL\b/.test(readFileSync(path, 'utf8')),
    )

    expect(holders.map((path) => path.slice(AUDIO_DIR.length + 1))).toEqual(['session-audio.ts'])
  })
})
