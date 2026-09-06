/**
 * Device-scoped capture preferences, and the one boundary that keeps them safe.
 *
 * **Nothing here is consent.** These settings say *how* and *where* capture
 * happens on this machine; whether a given patient's audio may be sent is asked
 * per consultation by `audio/ConsentGate.tsx`, is never remembered, and never
 * reads from this module (docs/trd.md section 20.4). The distinction is the
 * whole reason the two live apart: a persisted setting that also implied
 * permission would be a privacy control that fails open, silently applying to
 * every patient after the one who agreed. That is precisely what #228 did to
 * the hosted engine for three weeks, and what #254 undid.
 *
 * Stored in `localStorage` because a preference that resets every session is
 * not a preference. It holds no clinical content and no identifier, which is
 * what makes browser storage acceptable here where it is not elsewhere.
 */

/**
 * `ambient` is specified (docs/trd.md section 20.7) and not built. The option
 * is kept in the type and in storage because #219 will need both, but it is
 * disabled in the Audio dialog and nothing acts on it: a stored `ambient` used
 * to block the Record tab and claim the room was being listened to, which took
 * away the only working capture and put nothing in its place (#254).
 */
export type CaptureMode = 'ambient' | 'manual'

/** Which transcription engine a recording uses. Hosted is the ILMU relay. */
export type TranscriptionEngine = 'local' | 'hosted'

export type AudioSettings = {
  mode: CaptureMode
  /** `deviceId` of the chosen input, or null for the system default. */
  deviceId: string | null
  suppressNoise: boolean
  boostQuietSpeech: boolean
  /**
   * A standing preference set in the Audio dialog, on the owner's decision
   * (2026-09-02, consulting decision log). A preference here rather than a
   * per-consultation tick because it names *where* the audio goes, which does
   * not change per patient. It is not sufficient on its own: sending also
   * needs the per-consultation gesture on the Record tab (#254).
   */
  engine: TranscriptionEngine
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  /*
   * Manual is the default, matching on-device transcription being the default:
   * the quieter behaviour is the one a doctor gets without choosing. It is also
   * the only mode that does anything until ambient capture is built (#219).
   */
  mode: 'manual',
  deviceId: null,
  suppressNoise: true,
  /*
   * Off by default. Automatic gain lifts quiet speech and lifts room noise with
   * it, and on a consultation held at conversational distance the second effect
   * usually wins. It is offered because a softly spoken patient is a real case,
   * not because it is generally better.
   */
  boostQuietSpeech: false,
  // On-device is the floor: audio never leaves the machine unless the doctor
  // has gone out of their way to move the engine to ILMU.
  engine: 'local',
}

const KEY = 'catatmd.audio'

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_AUDIO_SETTINGS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AUDIO_SETTINGS
    const value = parsed as Partial<AudioSettings>
    return {
      mode: value.mode === 'ambient' ? 'ambient' : 'manual',
      deviceId: typeof value.deviceId === 'string' ? value.deviceId : null,
      suppressNoise: value.suppressNoise !== false,
      boostQuietSpeech: value.boostQuietSpeech === true,
      engine: value.engine === 'hosted' ? 'hosted' : 'local',
    }
  } catch {
    /*
     * A private window, cleared site data, or a browser blocking storage. The
     * defaults are a complete working configuration, so a doctor whose browser
     * refuses to remember anything still gets a usable microphone rather than
     * an error about a preference.
     */
    return DEFAULT_AUDIO_SETTINGS
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Storage being unavailable must not stop the doctor changing a device.
  }
}

/**
 * Maps the two plain-language toggles onto the real constraints the browser
 * understands, so the labels stay honest about what they do.
 */
export function toConstraints(settings: AudioSettings): MediaTrackConstraints {
  return {
    ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
    noiseSuppression: settings.suppressNoise,
    autoGainControl: settings.boostQuietSpeech,
    echoCancellation: true,
  }
}
