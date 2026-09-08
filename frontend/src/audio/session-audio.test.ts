import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The store holds one recording in memory and revokes what it replaces (#293).
 *
 * Revocation is the half worth testing rather than assuming: an object URL
 * keeps its blob alive for the life of the document, so a store that dropped
 * the reference without revoking would hold every consultation's audio until
 * the tab closed, which is the opposite of what this module exists to promise.
 *
 * The module is re-imported per test because its whole design is one module
 * variable. Sharing it across cases would make each test depend on the last,
 * and the first thing to break would be the "holds nothing yet" case.
 */

let created = 0
const revoked: string[] = []

type Store = typeof import('./session-audio.js')

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('./session-audio.js')
}

beforeEach(() => {
  created = 0
  revoked.length = 0
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      created += 1
      return `blob:test/${created}`
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const audio = () => new Blob(['x'], { type: 'audio/webm' })

describe('session audio', () => {
  it('hands back the recording it was given, for that consultation only', async () => {
    const { keepRecording, recordingUrl } = await freshStore()
    keepRecording('c1', audio())

    expect(recordingUrl('c1')).toBe('blob:test/1')
    expect(recordingUrl('c2')).toBeUndefined()
  })

  it('holds nothing before anything is kept', async () => {
    const { recordingUrl } = await freshStore()
    expect(recordingUrl('c1')).toBeUndefined()
  })

  it('keeps one recording at a time and revokes the one it replaces', async () => {
    const { keepRecording, recordingUrl } = await freshStore()
    keepRecording('c1', audio())
    keepRecording('c2', audio())

    expect(revoked).toEqual(['blob:test/1'])
    expect(recordingUrl('c1')).toBeUndefined()
    expect(recordingUrl('c2')).toBe('blob:test/2')
  })

  it('replacing the same consultation still revokes the old url', async () => {
    const { keepRecording, recordingUrl } = await freshStore()
    keepRecording('c1', audio())
    keepRecording('c1', audio())

    expect(revoked).toEqual(['blob:test/1'])
    expect(recordingUrl('c1')).toBe('blob:test/2')
  })
})
