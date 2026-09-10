import { describe, expect, test } from 'bun:test'
import { assertCompleteTake, normalizedBeatOffsets } from './beats.mjs'

const complete = [
  { name: 'shot-1', ms: 1_200 },
  { name: 'shot-2', ms: 14_200 },
  { name: 'shot-3', ms: 25_200 },
  { name: 'shot-4', ms: 38_200 },
  { name: 'shot-5', ms: 55_200 },
  { name: 'shot-6', ms: 75_200 },
  { name: 'shot-7', ms: 89_200 },
  { name: 'shot-8', ms: 102_200 },
  { name: 'shot-9', ms: 115_200 },
  { name: 'shot-10', ms: 128_200 },
  { name: 'end', ms: 134_200 },
]

describe('demo recording beats', () => {
  test('rejects a take that omits a required beat', () => {
    expect(() => assertCompleteTake(complete.filter((beat) => beat.name !== 'shot-5'))).toThrow(
      'shot-5',
    )
  })

  test('rejects beats that run backwards', () => {
    const outOfOrder = complete.map((beat) => ({ ...beat }))
    outOfOrder[6] = { name: 'shot-7', ms: 70_000 }

    expect(() => assertCompleteTake(outOfOrder)).toThrow('strictly increasing')
  })

  test('normalizes measured offsets to the first filmed frame', () => {
    expect(normalizedBeatOffsets(complete).slice(0, 3)).toEqual([
      { name: 'shot-1', ms: 0 },
      { name: 'shot-2', ms: 13_000 },
      { name: 'shot-3', ms: 24_000 },
    ])
  })

  test('rejects a take missing the final beat', () => {
    expect(() => assertCompleteTake(complete.filter((beat) => beat.name !== 'end'))).toThrow('end')
  })
})
