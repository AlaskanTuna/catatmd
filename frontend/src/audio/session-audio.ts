/**
 * The recording behind the settled transcript, held in memory and nowhere else
 * (#293).
 *
 * **The absence of persistence here is the feature, not an omission.** A
 * consultation recording is the one kind of PHI that cannot be de-identified,
 * because a voice is an identifier in its own right; `.claude/rules/security.md`
 * bans clinical content from `localStorage`, `sessionStorage` and IndexedDB,
 * and sanctions in-memory state that dies on reload. So this is a module
 * variable and an object URL, deliberately, and
 * `no-stray-audio-persistence.test.ts` fails the build if that ever changes.
 * Nothing here uploads, and playback is a local blob, so this adds no egress.
 *
 * Module scope rather than component state because `CapturePanel` unmounts the
 * moment a transcript exists, which is exactly when the review that needs the
 * audio begins. Module scope survives that, and survives navigating away and
 * back inside the SPA. It does not survive a reload, and it is not meant to:
 * the doctor gets a transcript with inert rows, which is the honest degraded
 * state rather than a broken one.
 *
 * **One recording at a time.** A consultation is minutes of audio, and holding
 * several would be a real amount of memory for no gain: a doctor reviews one
 * consultation at a time. Keeping a second releases the first, which is the
 * only way anything is released: there is no explicit drop, because the store
 * is a cache in front of `GET /api/consultations/:id/audio` rather than the
 * only copy. What actually destroys a recording is erasure or the retention
 * window, both server-side (`backend/src/audio/`).
 */

let held: { consultationId: string; url: string } | undefined

/**
 * Takes the recording for a consultation, releasing whatever was held before.
 *
 * Called only for a pass that produced timing. A second recording appended to
 * the same consultation restarts its timebase, so its audio cannot be indexed
 * by the offsets already in the transcript; the caller keeps the first pass's
 * audio, and the later turns simply carry no timing and stay inert.
 */
export function keepRecording(consultationId: string, blob: Blob): void {
  release()
  held = { consultationId, url: URL.createObjectURL(blob) }
}

/** The object URL for this consultation's audio, if it is the one being held. */
export function recordingUrl(consultationId: string): string | undefined {
  return held?.consultationId === consultationId ? held.url : undefined
}

function release(): void {
  if (held === undefined) return
  URL.revokeObjectURL(held.url)
  held = undefined
}
