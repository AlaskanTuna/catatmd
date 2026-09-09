import { TARGET_SAMPLE_RATE } from './protocol.js'

/**
 * The pieces two on-device speech surfaces must agree on, in one module
 * because a disagreement between them is silent (#313).
 *
 * `AudioCapture` records a whole consultation; `PrescriptionBlock` records one
 * dictated medication phrase on the review page. They share no lifecycle and
 * deliberately do not try to: the second is a short push-to-talk path written
 * directly rather than a mode of the first. But they must resample identically,
 * refuse the same hardware, ask the microphone for the same signal, and bound
 * silence by the same number, and each of those is a copy that fails quietly
 * when it drifts. A wrong resample does not throw, it transcribes the wrong
 * pitch and tempo; a disagreeing floor is a tab killed mid-consultation.
 *
 * **Nothing here may import `@huggingface/transformers`**, for the reason
 * `protocol.ts` states at length: both callers sit on the main chunk. Importing
 * `TARGET_SAMPLE_RATE` from `protocol.js` is safe because that module imports
 * nothing at all.
 */

/**
 * `whisper-small` on WASM against a browser on a thin machine is a plausible
 * out-of-memory kill in the middle of a consultation, which is a far worse
 * failure than not offering the feature (docs/prd.md §12).
 *
 * So the floor is a default, not a lock: a doctor who knows their machine can
 * proceed. Both signals are advisory. `deviceMemory` is coarse and Chromium
 * only, and `hardwareConcurrency` is missing on some browsers, so an unknown
 * value is treated as capable rather than blocked. The check is there to stop
 * someone stumbling into a crash, not to police hardware.
 */
export function belowHardwareFloor() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = navigator.hardwareConcurrency
  const memory = nav.deviceMemory
  return (cores !== undefined && cores < 4) || (memory !== undefined && memory < 8)
}

/**
 * Whisper wants 16 kHz mono. `OfflineAudioContext` does the resample and the
 * channel downmix in one pass, which is both less code and more correct than
 * decimating by hand.
 */
export async function toMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const decoder = new AudioContext()
  // Closed in a finally: browsers cap live AudioContexts, so one leaked by a
  // throwing decode would cost a later recording its decoder.
  const decoded = await decoder.decodeAudioData(bytes).finally(() => void decoder.close())

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/**
 * Dictation constraints, not the defaults: the browser's voice-call DSP
 * attenuates exactly the low-energy consonant bursts that separate b/p and
 * d/t, the devoicing family docs/trd.md §20.3 measured on both ASR arms
 * ("patut" for "batuk"), and echo cancellation has no far end to cancel here.
 * Gain control stays on because two speakers sit at different distances from
 * one microphone, and a quiet track costs more than gain pumping. Values are
 * ideals per the mediacapture spec, never OverconstrainedError;
 * track.getSettings() reports what was actually applied, which every TRD §20
 * measurement must record.
 *
 * **`toConstraints` in `./audio-settings.ts` is not a substitute.** It turns
 * echo cancellation back on, which §20.6 measured as wrong for dictation.
 */
export const DICTATION_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
  channelCount: 1,
}

/**
 * The silence budget: how long an on-device run may go without a worker
 * message before it is declared wedged and terminated (issue #139).
 *
 * A budget on silence rather than on the whole job, because a
 * consultation-length recording legitimately transcribes for many minutes
 * (docs/trd.md section 20.1 measures a real-time factor of 1.5 to 3.0) and a
 * total deadline would abort exactly the recordings most expensive to lose.
 * The floor is set by ONNX session creation, which blocks the worker thread
 * on a roughly 240 MB decoder and is legitimately silent throughout.
 *
 * A dictated phrase is seconds of audio rather than minutes, but it pays that
 * same session open on a cold model, so it takes the same number rather than a
 * shorter one sized for the inference alone.
 */
export const STALL_TIMEOUT_MS = 180_000
