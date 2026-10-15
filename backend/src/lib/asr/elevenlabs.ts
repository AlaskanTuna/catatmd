import type { BatchAsrConfig } from '@shared/types'
import { z } from 'zod'
import type { BatchSessionFailureReason } from '../../audit/index.js'
import { env } from '../../config/env.js'
import { asrContextTerms } from './vocabulary.js'

/**
 * The only module that may talk to ElevenLabs, behind the third audio egress
 * (#436, docs/trd.md §20.14).
 *
 * **It never sees audio.** After Stop on an untranslated ambient consultation,
 * the browser uploads the finished recording straight to the vendor's batch
 * endpoint, because relaying it through `/api/*` would run into Vercel's 120 s
 * time-to-first-byte cap on a long consultation (§17). What this module does is
 * mint the single-use credential for that one upload, which keeps the account
 * key on the server and the policy decision in the API: the `soniox.ts` shape.
 *
 * Native fetch and no SDK, for the reason `ilmu.ts` and `soniox.ts` give: the
 * provider-SDK inventory is pinned at one, inside `lib/llm/`, and
 * `no-stray-fetch.test.ts` pins this call.
 *
 * Every error thrown here carries a fixed message. The upstream response body
 * is never read on a failure path, because on this path it can name a
 * credential.
 */
export class ElevenLabsMintError extends Error {
  constructor(
    message: string,
    readonly reason: BatchSessionFailureReason,
  ) {
    super(message)
    this.name = 'ElevenLabsMintError'
  }
}

/**
 * The one host, as a literal. It must be the origin of `BATCH_ASR_UPLOAD_URL`
 * in `shared/` and the `connect-src` entry in `vercel.json`; `elevenlabs.test.ts`
 * pins all three together. There is no region variable: the residency hosts are
 * Enterprise-only and a separate workspace (§20.13), so none is offered.
 */
export const BATCH_API_ORIGIN = 'https://api.elevenlabs.io'

/** The model the browser uploads under, and the one audit rows record. */
const BATCH_MODEL = 'scribe_v2'

/**
 * Ten seconds, as for the Soniox mint: the request carries no body and the
 * doctor is waiting on a refined transcript, so a slow mint is a failed one and
 * the live transcript is used instead. No retries, for the same reason.
 */
const REQUEST_TIMEOUT_MS = 10_000

/** Upstream statuses with a specific meaning; anything else is `unavailable`. */
const REASON_BY_STATUS: Record<number, BatchSessionFailureReason> = {
  400: 'rejected',
  401: 'rejected',
  402: 'rejected',
  403: 'rejected',
  404: 'rejected',
  422: 'rejected',
  429: 'rate_limited',
}

/**
 * The vendor's wire shape for a single-use token, stripped to the one field
 * used. Unknown keys are dropped rather than rejected, so a vendor adding a
 * field cannot fail a refinement.
 */
const SingleUseTokenWireSchema = z.object({ token: z.string().min(1) })

/**
 * The recognition settings the browser uploads under.
 *
 * **Static by construction, for every reason `soniox.ts` gives for its
 * `MODE_SETTINGS`.** The settings cross the egress with the recording, where
 * nothing can be de-identified, so this takes no argument and reads nothing a
 * caller supplies. `elevenlabs.test.ts` pins the returned object in full, and
 * the SPA re-checks it against the literal `BatchAsrConfigSchema`.
 *
 * - **`scribe_v2`, never `scribe_v2_medical`.** §20.13 measured the medical
 *   model merging voices on 45 of 60 results, and with Malay keyterms
 *   translating Tamil into Malay. The standard model diarised at 99.9%.
 * - **Two speakers, which the vendor reads as a maximum.** A doctor and a
 *   patient, the configuration §20.13 measured.
 * - **No speaker roles.** Roles come from `voteRolesBySpeaker` in the SPA, the
 *   mechanism that already labels the live transcript, so there is one.
 * - **Audio events off**, so a cough is never written into the text as a word.
 * - **The ambient vocabulary as keyterms**, all 120, which the spike accepted.
 */
export function batchRefinementConfig(): BatchAsrConfig {
  return {
    modelId: BATCH_MODEL,
    diarize: true,
    numSpeakers: 2,
    timestampsGranularity: 'word',
    tagAudioEvents: false,
    // A fresh array per call: a caller that mutated what it was handed would
    // change what the next consultation uploads under.
    keyterms: asrContextTerms(),
  }
}

/**
 * Mints one single-use credential for one batch upload.
 *
 * **What the token binds is unmeasured.** The vendor documents single-use
 * tokens for its realtime socket; that this one is single use, that it expires
 * in fifteen minutes, and what else it constrains have not been measured for
 * the batch endpoint (§20.14, "What Is Not Measured"). It binds no duration
 * and no reference id, so the audit row and the per-caller limiter are what
 * bound it here, and the vendor credit quota on the key is what bounds spend.
 */
export async function mintBatchToken(): Promise<{ token: string }> {
  // The route answers 503 before calling; this is the fail-closed backstop.
  if (!env.ELEVENLABS_API_KEY) {
    throw new ElevenLabsMintError('ELEVENLABS_API_KEY is not set', 'unavailable')
  }

  let response: Response
  try {
    response = await fetch(`${BATCH_API_ORIGIN}/v1/single-use-token/batch_scribe`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
      // This request carries the account credential. Following a redirect
      // would present it to whatever host answered.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new ElevenLabsMintError(
      'ElevenLabs could not be reached before the timeout',
      'unavailable',
    )
  }

  if (!response.ok) {
    throw new ElevenLabsMintError(
      `ElevenLabs returned HTTP ${response.status}`,
      REASON_BY_STATUS[response.status] ?? 'unavailable',
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ElevenLabsMintError('ElevenLabs returned a non-JSON response', 'unavailable')
  }

  const parsed = SingleUseTokenWireSchema.safeParse(payload)
  if (!parsed.success) {
    // Fixed message, no prettified issues: a Zod issue can quote received
    // values, and on this path one of them is a credential.
    throw new ElevenLabsMintError('ElevenLabs response failed schema validation', 'unavailable')
  }

  return { token: parsed.data.token }
}

/**
 * Provider and model for audit stamps, mirroring `getLiveAsrDescriptor`: read
 * without touching the key, so an audit write that only wants two strings
 * cannot fail.
 */
export function getBatchAsrDescriptor(): { provider: 'elevenlabs'; model: string } {
  return { provider: 'elevenlabs', model: BATCH_MODEL }
}
