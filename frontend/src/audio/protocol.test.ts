import { describe, expect, it } from 'vitest'
import { CHUNK_LENGTH_S, countChunks, STRIDE_LENGTH_S, TARGET_SAMPLE_RATE } from './protocol.js'

/**
 * `countChunks` predicts how many times the model will run, and the progress
 * bar divides by it. If it disagrees with the pipeline's own windowing the bar
 * finishes early or stalls short of the end, which is worse than showing
 * nothing, so the prediction is pinned against a transcription of the
 * library's loop rather than against observed output.
 */

/** `_call_whisper`'s loop, transcribed. The oracle this is checked against. */
function actualChunks(samples: number): number {
  const window = TARGET_SAMPLE_RATE * CHUNK_LENGTH_S
  const stride = TARGET_SAMPLE_RATE * STRIDE_LENGTH_S
  const jump = window - 2 * stride

  let offset = 0
  let count = 0
  while (true) {
    count += 1
    if (offset + window >= samples) break
    offset += jump
  }
  return count
}

const seconds = (s: number) => s * TARGET_SAMPLE_RATE

describe('countChunks', () => {
  it('is one chunk for audio inside a single window', () => {
    expect(countChunks(seconds(4))).toBe(1)
    expect(countChunks(seconds(30))).toBe(1)
  })

  it('counts a 20 second advance per chunk, not a full window', () => {
    // The stride overlaps both ends, so each step advances window - 2*stride,
    // which is 20s and not 30s. Assuming 30 would under-count every long
    // recording and the bar would reach 100% while work continued.
    expect(countChunks(seconds(50))).toBe(2)
    expect(countChunks(seconds(70))).toBe(3)
  })

  it('matches the pipeline loop across the range a consultation spans', () => {
    for (let s = 1; s <= 900; s += 1) {
      expect({ s, n: countChunks(seconds(s)) }).toEqual({ s, n: actualChunks(seconds(s)) })
    }
  })

  it('never returns zero, so a division by it cannot produce Infinity', () => {
    expect(countChunks(0)).toBe(1)
    expect(countChunks(1)).toBe(1)
  })
})
