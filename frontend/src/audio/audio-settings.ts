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
 * `ambient` streams the whole consultation as it happens (#268); `manual` is
 * press-to-record. The Record tab shows one panel or the other, and both work,
 * which is the property #254 exists to protect: a stored `ambient` once blocked
 * the tab and claimed the room was being listened to while nothing listened,
 * taking away the only working capture and putting nothing in its place. A mode
 * whose provider is unconfigured now says so and offers one click back.
 */
export type CaptureMode = 'ambient' | 'manual'

/**
 * Which transcription engine a **press-to-record** recording uses. Hosted is
 * the ILMU relay. Ambient capture does not read this: it always streams to the
 * provider the API names, because that is the only one with a live socket.
 */
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
   * the quieter behaviour is the one a doctor gets without choosing. Ambient
   * capture sends audio off the device by design, so it is never where a doctor
   * lands without asking for it.
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
