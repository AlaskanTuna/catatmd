import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  toConstraints,
} from './audio-settings.js'

/**
 * The properties worth pinning are the ones that decide whether a doctor with a
 * hostile browser still gets a working microphone, and whether the two
 * plain-language toggles mean what their labels say.
 *
 * There is deliberately no test asserting that consent is stored here, because
 * consent is never stored here. The guard for that is the last case below.
 */

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('loadAudioSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS)
  })

  it('round-trips a saved configuration', () => {
    const settings: AudioSettings = {
      deviceId: 'mic-2',
      suppressNoise: false,
      boostQuietSpeech: true,
      engine: 'local',
      dictationEngine: 'streaming',
    }
    saveAudioSettings(settings)

    expect(loadAudioSettings()).toEqual(settings)
  })

  /**
   * Both engine fields decide whether audio leaves the device, so both are read
   * positively for the value that sends it. Anything else, including a value
   * written by an older build that had no such field, has to read as on-device:
   * a privacy preference that fails open is the one failure mode neither may
   * have, and #228 is what happens when one does.
   */
  it.each([
    ['streaming', 'streaming'],
    ['local', 'local'],
    ['hosted', 'local'],
    ['STREAMING', 'local'],
    ['', 'local'],
    [null, 'local'],
    [true, 'local'],
  ])('reads a stored dictationEngine of %o as %s', (stored, expected) => {
    localStorage.setItem(
      'catatmd.audio',
      JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, dictationEngine: stored }),
    )

    expect(loadAudioSettings().dictationEngine).toBe(expected)
  })

  it('defaults dictation to on-device, so a doctor who changes nothing sends nothing', () => {
    expect(DEFAULT_AUDIO_SETTINGS.dictationEngine).toBe('local')
    // A settings object written before this field existed.
    localStorage.setItem(
      'catatmd.audio',
      JSON.stringify({
        deviceId: null,
        suppressNoise: true,
        boostQuietSpeech: false,
        engine: 'hosted',
      }),
    )

    expect(loadAudioSettings().dictationEngine).toBe('local')
  })

  it('keeps both engines in the one permitted key, and adds no second one', () => {
    saveAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, dictationEngine: 'streaming' })

    // `no-stray-audio-persistence.test.ts` allows this module exactly one key.
    // A second one for the second engine would be a new persistence surface.
    expect(Object.keys(localStorage)).toEqual(['catatmd.audio'])
  })

  it('falls back to the defaults on malformed stored JSON', () => {
    localStorage.setItem('catatmd.audio', '{not json')

    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS)
  })

  it('ignores a legacy device-scoped capture mode', () => {
    localStorage.setItem(
      'catatmd.audio',
      JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, mode: 'ambient' }),
    )

    expect(loadAudioSettings()).not.toHaveProperty('mode')
  })

  it('survives storage throwing, which a private window does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS)
  })

  it('does not throw when saving is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => saveAudioSettings(DEFAULT_AUDIO_SETTINGS)).not.toThrow()
  })
})

describe('toConstraints', () => {
  it('maps the labels onto the constraints they claim to control', () => {
    expect(
      toConstraints({
        deviceId: null,
        suppressNoise: true,
        boostQuietSpeech: false,
        engine: 'local',
        dictationEngine: 'local',
      }),
    ).toEqual({ noiseSuppression: true, autoGainControl: false, echoCancellation: true })
  })

  it('omits deviceId entirely for the system default', () => {
    // An `exact` constraint on an empty string fails the getUserMedia call
    // rather than falling back, so absence has to mean absence.
    expect(toConstraints(DEFAULT_AUDIO_SETTINGS)).not.toHaveProperty('deviceId')
  })

  it('pins a chosen device exactly', () => {
    const constraints = toConstraints({ ...DEFAULT_AUDIO_SETTINGS, deviceId: 'mic-7' })

    expect(constraints.deviceId).toEqual({ exact: 'mic-7' })
  })

  it('carries nothing about consent into the media constraints', () => {
    // Capture settings describe the microphone. Whether a patient agreed is
    // asked per consultation and must not be derivable from this object.
    const keys = Object.keys(toConstraints(DEFAULT_AUDIO_SETTINGS))

    expect(keys).not.toContain('mode')
    expect(keys.some((k) => /consent|ambient/i.test(k))).toBe(false)
  })
})
