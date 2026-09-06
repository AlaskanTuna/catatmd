import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEGMENT_BOUNDS,
  isSilentThroughout,
  rmsFromTimeDomain,
  type SegmentBounds,
  shouldCut,
} from './segment-policy'

const BOUNDS: SegmentBounds = { floorMs: 8_000, ceilingMs: 20_000, silenceHoldMs: 600 }

/** Speech running, no pause yet. */
const speaking = (elapsedMs: number) => ({ elapsedMs, silentMs: 0, voicedMs: elapsedMs })

/** A pause of `silentMs` at the end of a segment that carried speech. */
const paused = (elapsedMs: number, silentMs: number) => ({
  elapsedMs,
  silentMs,
  voicedMs: elapsedMs - silentMs,
})

describe('shouldCut', () => {
  it('does not cut before the floor, however long the pause', () => {
    expect(shouldCut(paused(4_000, 3_000), BOUNDS)).toBe(false)
  })

  it('does not cut at the floor while speech is still running', () => {
    expect(shouldCut(speaking(12_000), BOUNDS)).toBe(false)
  })

  it('does not cut at the floor on a pause shorter than the hold', () => {
    expect(shouldCut(paused(12_000, 599), BOUNDS)).toBe(false)
  })

  it('cuts past the floor once a pause has held', () => {
    expect(shouldCut(paused(12_000, 800), BOUNDS)).toBe(true)
  })

  it('cuts at the ceiling even mid-sentence', () => {
    expect(shouldCut(speaking(20_000), BOUNDS)).toBe(true)
  })

  it('treats both thresholds as inclusive', () => {
    expect(shouldCut(paused(8_000, 600), BOUNDS)).toBe(true)
    expect(shouldCut(speaking(20_000), BOUNDS)).toBe(true)
  })

  it('treats one millisecond below either threshold as not yet', () => {
    expect(shouldCut(paused(7_999, 600), BOUNDS)).toBe(false)
    expect(shouldCut(speaking(19_999), BOUNDS)).toBe(false)
  })

  /*
   * The floor is the expensive threshold to get wrong. Cutting below it cost
   * 23.5 points of Malay word error against 1.5 at eight seconds, because a
   * batch recogniser called per chunk starts cold and loses the surrounding
   * speech it disambiguates with (docs/trd.md 20.7).
   */
  it('honours a floor supplied by measurement rather than the default', () => {
    const wider: SegmentBounds = { floorMs: 12_000, ceilingMs: 20_000, silenceHoldMs: 600 }
    expect(shouldCut(paused(9_000, 800), wider)).toBe(false)
    expect(shouldCut(paused(12_000, 800), wider)).toBe(true)
  })
})

describe('isSilentThroughout', () => {
  it('is true when the window carried no speech at all', () => {
    expect(isSilentThroughout({ elapsedMs: 20_000, silentMs: 20_000, voicedMs: 0 })).toBe(true)
  })

  it('is false when any speech was heard, however little', () => {
    expect(isSilentThroughout({ elapsedMs: 20_000, silentMs: 19_900, voicedMs: 100 })).toBe(false)
  })
})

describe('rmsFromTimeDomain', () => {
  it('reads a frame pinned at the midpoint as silence', () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0)
  })

  it('reads full negative deflection as full scale', () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(0))).toBe(1)
  })

  it('reads full positive deflection as very nearly full scale', () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(255))).toBeCloseTo(0.9921875, 6)
  })

  // An analyser can hand back a zero-length frame before the graph is running,
  // and a mean over no samples is NaN, which compares false against every
  // threshold and would read as speech forever.
  it('reads an empty frame as silence rather than NaN', () => {
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0)
  })
})

describe('DEFAULT_SEGMENT_BOUNDS', () => {
  // The eight to twenty second window specified in docs/trd.md 20.7.
  it('carries the measured window', () => {
    expect(DEFAULT_SEGMENT_BOUNDS.floorMs).toBe(8_000)
    expect(DEFAULT_SEGMENT_BOUNDS.ceilingMs).toBe(20_000)
  })
})
