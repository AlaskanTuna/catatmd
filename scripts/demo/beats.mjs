export const SHOT_COUNT = 10
export const SHOT_NAMES = Array.from({ length: SHOT_COUNT }, (_, index) => `shot-${index + 1}`)
export const REQUIRED_BEATS = [...SHOT_NAMES, 'end']

export function assertCompleteTake(beats) {
  for (const name of REQUIRED_BEATS) {
    if (!beats.some((beat) => beat.name === name)) {
      throw new Error(`take is missing required beat ${name}`)
    }
  }

  const ordered = REQUIRED_BEATS.map((name) => beats.find((beat) => beat.name === name))
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].ms <= ordered[index - 1].ms) {
      throw new Error('required beats must be strictly increasing')
    }
  }
}

export function normalizedBeatOffsets(beats) {
  assertCompleteTake(beats)
  const first = beats.find((beat) => beat.name === 'shot-1').ms
  return beats.filter((beat) => beat.ms >= first).map((beat) => ({ ...beat, ms: beat.ms - first }))
}
