import { BATCH_ASR_UPLOAD_URL, type BatchSession, BatchSessionSchema } from '@shared/types'
import { z } from 'zod'

/*
 * The SPA's only cross-origin fetch, and the third audio egress (#436,
 * docs/trd.md §20.14).
 *
 * After Stop on an untranslated ambient consultation, the finished recording
 * is uploaded from the browser straight to the vendor's batch endpoint for a
 * second, diarised transcription. Straight, because a relay through `/api/*`
 * would meet Vercel's 120 s time-to-first-byte cap on a long consultation. The
 * API stays the policy point by minting the single-use token this module is
 * handed; what happens after that is here, in one file, pinned by
 * `frontend/src/no-stray-fetch.test.ts`.
 *
 * Nothing in this module logs. A failure is a value from a closed set, because
 * the vendor's own error text is free-form and can name a credential.
 */

/**
 * One element of the vendor's response, quarantined here the way
 * `soniox-stream.ts` quarantines its provider's wire shape.
 *
 * **Only what the mapping reads survives.** Zod strips the rest: the
 * transcript-wide `text`, the language guess, `logprob` and the per-character
 * timings never leave this module, so nothing downstream can come to rely on
 * them. `type` is a closed enum, so a vendor adding an element kind fails the
 * refinement closed and the live transcript is used, rather than an unknown
 * element being read as speech.
 */
const BatchWordWireSchema = z.object({
  text: z.string(),
  start: z.number().nullable().optional(),
  end: z.number().nullable().optional(),
  type: z.enum(['word', 'spacing', 'audio_event']),
  speaker_id: z.string().nullable().optional(),
})

const BatchResponseWireSchema = z.object({ words: z.array(BatchWordWireSchema) })

export type BatchWord = z.infer<typeof BatchWordWireSchema>

export type BatchUploadFailure =
  /** The session failed the shared literal schema. Nothing was sent. */
  | 'refused'
  /** The vendor refused the request, which usually means the token. */
  | 'rejected'
  | 'rate_limited'
  /** The network failed, or the vendor did. */
  | 'unavailable'
  /** A 2xx whose body is not the documented shape. */
  | 'invalid_response'
  /** The caller's signal fired: the doctor skipped, or the bound ran out. */
  | 'aborted'

/**
 * `sent` says whether the recording may have left the device, which the audit
 * trail records whether or not the transcript is used: a refused refinement
 * still sent the audio.
 */
export type BatchUploadResult =
  | { ok: true; sent: true; words: BatchWord[] }
  | { ok: false; reason: BatchUploadFailure; sent: boolean }

/** Upstream statuses with a specific meaning; anything else is `unavailable`. */
const REASON_BY_STATUS: Record<number, BatchUploadFailure> = {
  400: 'rejected',
  401: 'rejected',
  402: 'rejected',
  403: 'rejected',
  404: 'rejected',
  413: 'rejected',
  422: 'rejected',
  429: 'rate_limited',
}

/**
 * Where the upload goes: the pinned address, with the single-use token as its
 * only query parameter.
 *
 * **How the vendor expects this token is unmeasured** (§20.14). Its documented
 * single-use tokens ride as a `token` query parameter on the realtime socket,
 * and this follows that convention. A wrong guess fails closed: the vendor
 * answers 401, and the doctor gets the live transcript with a notice.
 */
function uploadTarget(session: BatchSession): string {
  const target = new URL(BATCH_ASR_UPLOAD_URL)
  target.searchParams.set('token', session.token)
  return target.toString()
}

/**
 * The form the vendor reads, built from the literal config and nothing else.
 * The vendor's snake_case names exist in this module only, as Soniox's exist
 * only in `soniox-stream.ts`.
 */
function uploadForm(session: BatchSession, recording: Blob): FormData {
  const form = new FormData()
  form.append('model_id', session.config.modelId)
  form.append('diarize', String(session.config.diarize))
  form.append('num_speakers', String(session.config.numSpeakers))
  form.append('timestamps_granularity', session.config.timestampsGranularity)
  form.append('tag_audio_events', String(session.config.tagAudioEvents))
  for (const term of session.config.keyterms) form.append('keyterms', term)
  form.append('file', recording, 'recording.webm')
  return form
}

/**
 * Uploads one finished recording and returns the vendor's words, or a closed
 * failure reason.
 *
 * **The session is re-checked here, whatever the caller already did.** It came
 * from our own API, and this is the one place in the SPA that sends a
 * recording to a third party: a misconfigured or compromised API answering
 * with another address, the medical model or speaker roles is refused before
 * a byte leaves. The CSP `connect-src` pins the host again underneath.
 */
export async function transcribeRecording(
  session: BatchSession,
  recording: Blob,
  signal: AbortSignal,
): Promise<BatchUploadResult> {
  const checked = BatchSessionSchema.safeParse(session)
  if (!checked.success || checked.data.uploadUrl !== BATCH_ASR_UPLOAD_URL) {
    return { ok: false, reason: 'refused', sent: false }
  }

  let response: Response
  try {
    response = await fetch(uploadTarget(checked.data), {
      method: 'POST',
      body: uploadForm(checked.data, recording),
      // No cookie of ours goes to a third party, no redirect is followed with
      // a recording in the body, and the vendor is not told which page sent it.
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    })
  } catch {
    return { ok: false, reason: signal.aborted ? 'aborted' : 'unavailable', sent: true }
  }

  // The body is never read on a failure: it is vendor text, and on this path
  // it can name a credential.
  if (!response.ok) {
    return { ok: false, reason: REASON_BY_STATUS[response.status] ?? 'unavailable', sent: true }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: signal.aborted ? 'aborted' : 'invalid_response', sent: true }
  }

  const parsed = BatchResponseWireSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, reason: 'invalid_response', sent: true }

  return { ok: true, sent: true, words: parsed.data.words }
}
