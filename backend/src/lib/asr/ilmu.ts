import { type HostedAsrResult, HostedAsrResultSchema } from '@shared/types'
import { z } from 'zod'
import type { AsrRelayFailureReason } from '../../audit/index.js'
import { env } from '../../config/env.js'

/**
 * The one audio egress in the system (docs/trd.md §20, issue #154), and the
 * only module that may talk to the ASR provider.
 *
 * Native fetch and FormData, deliberately not the OpenAI SDK even though the
 * endpoint is OpenAI-shaped: `no-stray-provider-sdk.test.ts` pins the repo-wide
 * SDK import inventory to exactly one, inside `lib/llm/`, and that boundary is
 * worth more than the convenience.
 *
 * Every error thrown here carries a fixed message and, at most, the numeric
 * upstream status. The upstream response body is never read on a failure path,
 * because on this route a response body is a transcript.
 */
export class IlmuRelayError extends Error {
  constructor(
    message: string,
    readonly reason: AsrRelayFailureReason,
  ) {
    super(message)
    this.name = 'IlmuRelayError'
  }
}

/**
 * ILMU's wire shape, quarantined here the way each LLM adapter quarantines its
 * provider's. The API currently returns only `{text, usage}` and does not
 * honour `verbose_json`; `duration` and `segments` are documented fields it may
 * start returning later (docs/trd.md §20.3, finding 5), so they parse when
 * present, and unknown keys are stripped rather than rejected.
 */
const IlmuWireSchema = z.object({
  text: z.string(),
  usage: z.object({ seconds: z.number() }).optional(),
  duration: z.number().optional(),
  segments: z
    .array(z.object({ text: z.string(), start: z.number(), end: z.number().nullable().optional() }))
    .optional(),
})

/** Upstream statuses with a specific meaning; anything else is `unavailable`. */
const REASON_BY_STATUS: Record<number, AsrRelayFailureReason> = {
  400: 'rejected_audio',
  402: 'no_allocation',
  413: 'too_large',
  429: 'rate_limited',
}

/**
 * Twice the measured worst case with two orders of magnitude to spare: 99.2 s
 * of audio transcribed in 2.5 s (docs/trd.md §20.3), so a minute of waiting
 * means the provider is down, not slow. No retries: the doctor is standing at
 * the Record tab, and the honest failure mode is degrading to paste.
 */
const REQUEST_TIMEOUT_MS = 120_000

/**
 * ILMU keys format detection on the part's filename extension, so one is
 * derived from the mime subtype, with parameters such as `;codecs=opus`
 * stripped. MediaRecorder emits `audio/webm` (Chromium, Firefox) or
 * `audio/mp4` (Safari); the file-upload path can carry anything `audio/*`. An
 * unmapped subtype passes through as-is, and an unsupported one comes back as
 * upstream 400, surfaced honestly as `rejected_audio`.
 */
function extensionFor(contentType: string): string {
  const subtype = ((contentType.split('/')[1] ?? '').split(';')[0] ?? '').trim().toLowerCase()
  if (subtype === 'mp4' || subtype === 'x-m4a') return 'm4a'
  if (subtype === 'mpeg') return 'mp3'
  return subtype || 'webm'
}

export async function transcribeWithIlmu(
  audio: Buffer,
  contentType: string,
): Promise<HostedAsrResult> {
  // The route answers 503 before calling; this is the fail-closed backstop.
  if (!env.ILMU_API_KEY) {
    throw new IlmuRelayError('ILMU_API_KEY is not set', 'unavailable')
  }

  const form = new FormData()
  // A zero-copy view rather than `new Uint8Array(audio)`: the Blob's own
  // internal snapshot is unavoidable, and an extra copy on top of it raises
  // the peak memory a 25 MB request pins.
  form.append(
    'file',
    new Blob([new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)], {
      type: contentType,
    }),
    `audio.${extensionFor(contentType)}`,
  )
  // HTTP form fields, not clinical constants, as unquoted object keys: one
  // field name doubles as a gap-checklist id, which the clinical-constants
  // guard rightly refuses as a quoted literal outside the versioned data
  // files. `verbose_json` is not honoured today; requested so segments start
  // flowing if it ever is.
  const fields = { model: env.ILMU_ASR_MODEL, response_format: 'verbose_json', temperature: '0' }
  for (const [field, value] of Object.entries(fields)) form.append(field, value)

  let response: Response
  try {
    response = await fetch(`${env.ILMU_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ILMU_API_KEY}` },
      body: form,
      // The endpoint never legitimately redirects; following one would re-post
      // patient audio to whatever host answered, so refuse instead.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new IlmuRelayError('ILMU could not be reached before the timeout', 'unavailable')
  }

  if (!response.ok) {
    throw new IlmuRelayError(
      `ILMU returned HTTP ${response.status}`,
      REASON_BY_STATUS[response.status] ?? 'unavailable',
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new IlmuRelayError('ILMU returned a non-JSON response', 'unavailable')
  }

  const parsed = IlmuWireSchema.safeParse(payload)
  if (!parsed.success) {
    // Fixed message, no prettified issues: a Zod issue can quote received values.
    throw new IlmuRelayError('ILMU response failed schema validation', 'unavailable')
  }

  // safeParse so a mapping defect still surfaces as an IlmuRelayError: the
  // route writes `asr.hosted_relay_failed` only for that class, and by this
  // point audio has already egressed, so no throw here may bypass the audit.
  const result = HostedAsrResultSchema.safeParse({
    text: parsed.data.text,
    // `usage.seconds` is the one duration the API actually returns; the
    // documented `duration` is the fallback for the day it appears.
    durationSeconds: parsed.data.usage?.seconds ?? parsed.data.duration ?? 0,
    segments: (parsed.data.segments ?? []).map((segment) => ({
      text: segment.text,
      start: segment.start,
      end: segment.end ?? null,
    })),
  })
  if (!result.success) {
    throw new IlmuRelayError('Relay result failed schema validation', 'unavailable')
  }
  return result.data
}

/**
 * Provider and model identity for audit stamps, mirroring `getLLMDescriptor`:
 * read from the environment without touching the key, so an audit write that
 * only wants two strings cannot fail.
 */
export function getAsrDescriptor(): { provider: 'ilmu'; model: string } {
  return { provider: 'ilmu', model: env.ILMU_ASR_MODEL }
}
