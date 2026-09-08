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
 * Where a recording may be sent, pinned as an inventory rather than as a ban.
 *
 * **This used to assert that nothing under `audio/` uploaded at all, and it
 * went on passing after #293 added exactly that.** The pattern looked for the
 * word "upload" and the call is named `putConsultationAudio`, so a guard whose
 * whole job was to notice a new egress quietly stopped noticing. A named test
 * that is wrong is worse than no test, because the next reader trusts it.
 *
 * An inventory cannot fail that way. Storing the recording is now deliberate
 * and bounded by the retention window in `backend/src/audio/`; what must still
 * never appear is a second module sending one.
 */
const SENDS_AUDIO = /\bapi\.(putConsultationAudio|getConsultationAudio)\b/
const MAY_SEND_AUDIO = new Set(['use-transcript-audio.ts'])

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
    '%s sends the recording nowhere unless it is the one module allowed to',
    (name, path) => {
      const hits = readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter(([, line]) => SENDS_AUDIO.test(line))

      const allowed = MAY_SEND_AUDIO.has(name.replaceAll('\\', '/'))
      expect(allowed ? [] : hits, `${path} is a second audio egress`).toEqual([])
    },
  )

  it('names the one module that may send a recording, so the list is reviewable', () => {
    expect([...MAY_SEND_AUDIO]).toEqual(['use-transcript-audio.ts'])
  })

  /*
   * The guard has to actually fire. Its predecessor passed green against a real
   * upload for a whole PR because its pattern missed the call's name, so the
   * pattern is now tested against the call it exists to notice.
   */
  it('matches the calls it is written to notice', () => {
    expect(SENDS_AUDIO.test('void api.putConsultationAudio(consultationId, blob)')).toBe(true)
    expect(SENDS_AUDIO.test('await api.getConsultationAudio(consultationId)')).toBe(true)
    expect(SENDS_AUDIO.test('const detail = await api.approve(id)')).toBe(false)
  })

  it('keeps the retained recording in exactly one module', () => {
    const holders = sourceFiles(AUDIO_DIR).filter((path) =>
      /\bURL\.createObjectURL\b/.test(readFileSync(path, 'utf8')),
    )

    expect(holders.map((path) => path.slice(AUDIO_DIR.length + 1))).toEqual(['session-audio.ts'])
  })
})
