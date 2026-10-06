import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputMeter } from './InputMeter.js'

/**
 * The wave is the icon-sized form of the meter, for a header with no room for
 * words. It inherits the meter's one rule: it reads a real `AnalyserNode` and
 * shows silence as silence, so a still wave is never decoration.
 */

/** What every sample in the analyser's buffer reads; 128 is the midpoint, silence. */
let sample = 128

class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 256,
      getByteTimeDomainData: (bins: Uint8Array) => bins.fill(sample),
    }
  }
  createMediaStreamSource() {
    return { connect: () => {} }
  }
  close() {
    return Promise.resolve()
  }
}

const STREAM = { getTracks: () => [] } as unknown as MediaStream

/** The bars carry their height inline; the strike-through does not. */
const bars = (meter: HTMLElement) =>
  Array.from(meter.querySelectorAll<HTMLElement>('[style*="height"]')).map((bar) =>
    Number.parseFloat(bar.style.height),
  )

const reduceMotion = (reduce: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) =>
      ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
      }) as MediaQueryList,
  })

beforeEach(() => {
  sample = 128
  vi.stubGlobal('AudioContext', FakeAudioContext)
  // One frame only, so the level is whatever the first read measured.
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  reduceMotion(false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InputMeter, wave variant', () => {
  it('lies flat and says so to assistive tech when the room is silent', async () => {
    render(<InputMeter variant="wave" stream={STREAM} />)

    const meter = await screen.findByRole('img', { name: 'Microphone level: silent' })
    expect(new Set(bars(meter)).size).toBe(1)
    // The words are gone from the screen; the name is where they went.
    expect(screen.queryByText('Silent')).toBeNull()
  })

  it('raises its bars with the measured level', async () => {
    sample = 128 + 60
    render(<InputMeter variant="wave" stream={STREAM} />)

    const meter = await screen.findByRole('img', { name: 'Microphone level: hearing you' })
    const heights = bars(meter)
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights))
  })

  it('greys out and strikes through when no microphone is connected', async () => {
    vi.stubGlobal('AudioContext', undefined)
    render(<InputMeter variant="wave" stream={STREAM} />)

    const meter = await screen.findByRole('img', { name: 'Microphone level: not connected' })
    expect(meter.querySelector('[data-strike]')).not.toBeNull()
  })

  it('holds a still shape under reduced motion, and still changes state', async () => {
    reduceMotion(true)
    sample = 128 + 60
    render(<InputMeter variant="wave" stream={STREAM} />)

    const meter = await screen.findByRole('img', { name: 'Microphone level: hearing you' })
    // Every bar raised at once rather than echoing outward over time, and no
    // height transition left to animate between frames.
    const [outer, , centre] = bars(meter)
    expect(outer).toBeGreaterThan(3)
    expect(centre).toBeGreaterThan(outer ?? 0)
    expect(meter.innerHTML).not.toContain('transition')
  })
})

describe('InputMeter, default variant', () => {
  it('keeps the bar and its words for the surfaces that have room for them', async () => {
    render(<InputMeter stream={STREAM} />)

    expect(await screen.findByText('Silent')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
