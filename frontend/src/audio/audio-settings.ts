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
 * Which transcription engine a **press-to-record** recording uses. Hosted is
 * the ILMU relay. Ambient capture does not read this: it always streams to the
 * provider the API names, because that is the only one with a live socket.
 */
export type TranscriptionEngine = 'local' | 'hosted'

/**
 * Where a **dictated prescription phrase** is recognised (#357).
 *
 * A separate field rather than a reuse of `engine` below, and the reason is the
 * whole point of having two. `'hosted'` means the ILMU relay everywhere it is
 * read, which is our API and Malaysia. Streaming dictation is Soniox, held by
 * the browser, in the United States. One stored value meaning two processors in
 * two countries is a residency answer nobody can give from the interface, and
 * `docs/dpia.md` calls the Soniox transfer the only one here that leaves ASEAN.
 */
export type DictationEngine = 'local' | 'streaming'

export type AudioSettings = {
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
  /**
   * The same standing-preference half of the consent rule, for the review
   * page's microphone (#357). Not sufficient on its own: streaming also needs
   * the per-consultation tick, which lives in `PrescriptionBlock` and is
   * remembered by nothing.
   *
   * **Unlike `engine`, this one ships pre-set to the value that sends**
   * (10/09/26, owner decision, `docs/decisions.md` D-001). A preference the
   * doctor has not moved is not a choice they made, so on that surface the
   * rule is one defaulted preference plus one deliberate tick rather than two
   * chosen controls. The tick still gates every send.
   */
  dictationEngine: DictationEngine
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
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
  /*
   * Not the same floor, and the asymmetry is the decision rather than an
   * oversight (10/09/26, owner, `docs/decisions.md` D-001). On-device stays
   * the fallback on the review page and every failure still lands on it or on
   * typing, but it is no longer what a doctor who changes nothing gets:
   * measurement in `docs/trd.md` section 20 put the on-device real-time factor
   * above 1.0 on the hardware most clinics run, and words appearing as the
   * doctor speaks is not reachable there. What did not move is the tick in
   * `PrescriptionBlock`, which is asked per consultation and gates every send.
   */
  dictationEngine: 'streaming',
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
      deviceId: typeof value.deviceId === 'string' ? value.deviceId : null,
      suppressNoise: value.suppressNoise !== false,
      boostQuietSpeech: value.boostQuietSpeech === true,
      // Still read positively for the value that sends: anything unrecognised,
      // absent or corrupted falls to on-device. The relay's default did not
      // move, so this field has one rule and needs no split.
      engine: value.engine === 'hosted' ? 'hosted' : 'local',
      /*
       * **Absent and corrupt are different here, and only here.** An absent
       * field is a device that has never chosen, including one whose settings
       * were written before this field existed, and it takes the current
       * default. Any present value other than `'streaming'` is a value nobody
       * meant, and it falls to on-device.
       *
       * The split is what lets the 10/09/26 default reach a device that
       * already has a `catatmd.audio` key while corruption still fails closed.
       * Reading positively for both, as `engine` does above, would leave every
       * existing device on-device and make the new default reach nobody.
       */
      dictationEngine:
        value.dictationEngine === undefined
          ? DEFAULT_AUDIO_SETTINGS.dictationEngine
          : value.dictationEngine === 'streaming'
            ? 'streaming'
            : 'local',
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
