import { randomUUID } from 'node:crypto'
import type { LiveAsrMode, LiveAsrRegion, LiveSessionConfig } from '@shared/types'
import { z } from 'zod'
import type { LiveSessionFailureReason } from '../../audit/index.js'
import { env } from '../../config/env.js'
import { asrContextTerms, dictationContextTerms } from './vocabulary.js'

/**
 * The only module that may talk to Soniox, and the second audio egress in the
 * system (docs/trd.md §20.10, issue #268).
 *
 * **It never sees audio.** Ambient capture streams from the browser straight to
 * the provider, because a WebSocket cannot pass through the Vercel rewrite that
 * makes the session cookie first-party (§17, issue #156). What this module does
 * is mint the short-lived credential that opens one such stream, which is what
 * keeps the account key on the server and the policy decision in the API.
 *
 * Native fetch and no SDK, for the reason `ilmu.ts` gives: the repo-wide
 * provider-SDK inventory is pinned at one, inside `lib/llm/`, and that boundary
 * is worth more than the convenience. `no-stray-fetch.test.ts` pins this call.
 *
 * Every error thrown here carries a fixed message and, at most, the numeric
 * upstream status. The upstream response body is never read on a failure path.
 */
export class SonioxMintError extends Error {
  constructor(
    message: string,
    readonly reason: LiveSessionFailureReason,
  ) {
    super(message)
    this.name = 'SonioxMintError'
  }
}

/**
 * The two hosts per region, as literals rather than a template over the env.
 *
 * A hostname assembled from a free-text variable is one typo away from sending
 * patient audio somewhere else, and the value travels to the browser, so the
 * region is an enum and the addresses are written out. The websocket values are
 * the ones `LIVE_ASR_WEBSOCKET_URL` in `shared/` accepts, and the CSP in
 * `vercel.json` pins the configured one; the three must be changed together.
 */
const REGION_HOSTS: Record<LiveAsrRegion, { api: string; websocket: string }> = {
  us: {
    api: 'https://api.soniox.com',
    websocket: 'wss://stt-rt.soniox.com/transcribe-websocket',
  },
  eu: {
    api: 'https://api.eu.soniox.com',
    websocket: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
  },
  jp: {
    api: 'https://api.jp.soniox.com',
    websocket: 'wss://stt-rt.jp.soniox.com/transcribe-websocket',
  },
  in: {
    api: 'https://api.in.soniox.com',
    websocket: 'wss://stt-rt.in.soniox.com/transcribe-websocket',
  },
}

export function sonioxHosts(region: LiveAsrRegion): { api: string; websocket: string } {
  return REGION_HOSTS[region]
}

/**
 * How long the minted key may be used to open a connection.
 *
 * Thirty seconds, and the number matters more than it looks. **Measured
 * 06/09/26: one temporary key opens more than one connection inside its
 * window**, so this is not "one key, one session" however much the shape
 * suggests it. It is the width of the window in which a key can be used at
 * all, by us or by anyone who obtained it.
 *
 * Thirty is generous for the only caller there is: the browser already holds
 * an open microphone before it asks, so the gap between minting and connecting
 * is one round trip. The permission prompt, which is the slow part, happens
 * before the mint precisely so it cannot eat this budget.
 */
export const TEMPORARY_KEY_TTL_SECONDS = 30

/**
 * The spend cap on one session, and the only one that binds.
 *
 * **Thirty minutes for ambient:** six to ten times a Malaysian GP
 * consultation, which runs three to five, so it bounds a session the doctor
 * forgets to stop without cutting a long one short.
 *
 * **It was an hour, and an hour was wrong.** The limiter allows five keys a
 * minute per caller, and a key's cost is its session length rather than a
 * single bounded request, so the two compose: at an hour, one caller reaches
 * roughly three hundred concurrent streams in steady state. Halving this
 * halves that, which is a mitigation rather than a fix. The real gap is that
 * no global budget exists, and `.claude/rules/security.md` states it rather
 * than implying coverage.
 *
 * **Two minutes for dictation, because thirty was a cap that did not bind.** A
 * dictated prescription is a phrase of ten to twenty seconds; a bound six
 * orders of magnitude above the thing it bounds is a number, not a control. Two
 * minutes leaves room for a doctor who pauses mid-sheet and still ends a
 * forgotten socket in the time one ambient session takes to notice nothing is
 * being said.
 *
 * **These bound a session, not a caller, and measurement made that worse rather
 * than better.** A temporary key was assumed to authenticate one connection; on
 * 06/09/26 it was measured opening a second, so the caps below bound each
 * stream while the number of streams a key can start inside its window is
 * unbounded. `TEMPORARY_KEY_TTL_SECONDS` is what narrows that window and is the
 * reason it is short. Recorded in docs/trd.md §20.10.
 */
export const MAX_SESSION_DURATION_SECONDS: Record<LiveAsrMode, number> = {
  ambient: 1_800,
  dictation: 120,
}

/**
 * The languages the recogniser is biased toward.
 *
 * Hints bias rather than restrict, and the set is constrained on purpose:
 * Indonesian is excluded because Malay was tagged Indonesian on three of four
 * measured clips (issue #218), and every vendor supporting code-switching
 * advises naming the languages expected. Tamil is listed by this vendor and is
 * unmeasured here, which docs/trd.md §20.10 says plainly rather than claiming.
 */
const LANGUAGE_HINTS = ['ms', 'en', 'zh', 'ta'] as const

/**
 * Narrower for dictation, on the same reasoning one step further.
 *
 * A prescription is drug names in English inside Malay dosing phrases, and
 * nothing else. Mandarin and Tamil are in the ambient set because a patient may
 * speak either; a doctor reading out a sig will not, so naming them only widens
 * the candidate set the identifier has to choose from. Unmeasured, exactly like
 * the set it narrows.
 */
const DICTATION_LANGUAGE_HINTS = ['ms', 'en'] as const

/** Every field one mode changes. Nothing outside this shape varies. */
type ModeSettings = {
  readonly languageHints: readonly string[]
  readonly speakerDiarization: boolean
  readonly endpointDetection: boolean
  readonly general: readonly { readonly key: string; readonly value: string }[]
  /** The function, not its result: each call must hand out a fresh array. */
  readonly terms: () => string[]
}

/**
 * The recognition settings and domain hints each mode sends, including the
 * vendor's documented lever on diarisation: naming the speakers in the
 * `general` section "can help the model more reliably separate voices".
 *
 * **Static by construction, and it must stay that way.** All of this travels in
 * the socket's first frame, so it crosses the audio egress, and audio cannot be
 * de-identified on the way out. `liveSessionConfig()` selects one of these two
 * entries by a closed enum and can reach nothing else, which is what
 * structurally prevents a consultation, a patient, or anything else a caller
 * supplies from reaching these values. Do not make any of it a function of a
 * request; `soniox.test.ts` pins both returned objects in full.
 *
 * `general` says how many voices to expect and in what setting, and nothing
 * about who they are.
 *
 * **Written out per mode rather than composed from a base**, so a third mode is
 * a compile error until someone writes its whole config down, and the test
 * compares each entry against an object spelled out by hand for the same
 * reason. A mode inheriting a default is a mode whose egress nobody reviewed.
 *
 * **The `terms` section was deliberately absent and no longer is (issue #307).**
 * The reason recorded here was that clinical vocabulary targets word
 * recognition rather than diarisation, and was unmeasured. The first half was
 * right and is now the point: §20.7.1 measured a clinical Malay vocabulary
 * carrying a Malay clip from unusable to one word wrong, and measured "batuk"
 * returning as "betul", a pair `mishears.ts` structurally cannot claim. Word
 * recognition is where that has to be fixed.
 *
 * The second half still stands and is the honest limit: §20.7.1 ran on **Qwen**,
 * with a system context rather than this vendor's `terms` array. Nothing here
 * has been measured on Soniox, so both vocabularies are a reasoned decision on
 * this provider rather than an evidenced one, and §20.10 says so rather than
 * implying coverage. `vocabulary.ts` holds the lists and the argument.
 */
const MODE_SETTINGS: Record<LiveAsrMode, ModeSettings> = {
  ambient: {
    languageHints: LANGUAGE_HINTS,
    speakerDiarization: true,
    endpointDetection: false,
    general: [
      { key: 'domain', value: 'Healthcare' },
      { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
    ],
    terms: asrContextTerms,
  },
  /**
   * **Dictation inverts both diarisation settings, and the second inversion is
   * only correct because of the first.** The argument above for endpoint
   * detection off is conditional on diarisation being on: an early finalisation
   * is harmful because it freezes a speaker id that can never be revised. With
   * one speaker there is no id to freeze, so the cost disappears and what is
   * left is the benefit the vendor's own guidance describes, `<end>` markers
   * that settle words promptly instead of waiting on the SPA's 1.5 s pause
   * backstop. A doctor reading out a prescription is watching for the text to
   * appear, so that latency is the whole experience.
   */
  dictation: {
    languageHints: DICTATION_LANGUAGE_HINTS,
    speakerDiarization: false,
    endpointDetection: true,
    general: [
      { key: 'domain', value: 'Healthcare' },
      { key: 'speakers', value: 'One speaker: a doctor dictating a prescription' },
    ],
    terms: dictationContextTerms,
  },
}

/**
 * The lookup, and the reason it is a function rather than a bracket.
 *
 * **`Object.hasOwn`, not a truthiness check or a `??`.** A plain object
 * inherits `constructor`, `toString` and the rest, so `MODE_SETTINGS['toString']`
 * resolves to a function rather than to `undefined`, and a nullish fallback
 * would hand that inherited value on instead of refusing. And a `?? AMBIENT`
 * fallback of any kind is the specific defect this shape exists to prevent: it
 * would send one mode's settings across the audio egress while the caller
 * believed it had asked for the other's.
 *
 * The thrown message names no value. On this path the argument is
 * caller-influenced, and a message that quoted it would be the one place an
 * unvalidated string could reach a drain.
 */
function settingsFor<T>(table: Record<LiveAsrMode, T>, mode: LiveAsrMode): T {
  if (!Object.hasOwn(table, mode)) throw new Error('Unknown live ASR mode')
  return table[mode]
}

/** Upstream statuses with a specific meaning; anything else is `unavailable`. */
const REASON_BY_STATUS: Record<number, LiveSessionFailureReason> = {
  400: 'rejected',
  401: 'rejected',
  402: 'rejected',
  403: 'rejected',
  404: 'rejected',
  429: 'rate_limited',
}

/**
 * Ten seconds, against ILMU's 120: this request carries a few hundred bytes of
 * JSON and the doctor is waiting with a live microphone, so a slow mint is a
 * failed one. No retries, for the same reason.
 */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Soniox's wire shape for a temporary key, quarantined here the way each other
 * adapter quarantines its provider's. Unknown keys are stripped rather than
 * rejected, so a vendor adding a field cannot fail a consultation.
 */
const SonioxTemporaryKeyWireSchema = z.object({
  api_key: z.string().min(1),
  expires_at: z.string().min(1),
})

/**
 * The recognition settings the browser sends as its first frame.
 *
 * **Endpoint detection is off for ambient, and that is the whole point of it.**
 * The vendor states that it "forces tokens to finalize early, which reduces
 * diarization accuracy", and separately that a final token "will never change
 * in future responses". Together those mean an early finalisation freezes a
 * speaker id before the diariser has the context to settle it, and nothing on
 * the wire can correct it afterwards. That is what produced turns attributed to
 * the wrong speaker for the rest of a consultation. Their own guidance is "for
 * the highest diarization accuracy, do not use endpoint detection", and there
 * knowing who spoke outranks settling the text a moment sooner.
 *
 * The cost is real and accepted: without `<end>` markers, `tokensToSegments` in
 * the SPA closes a group on a speaker change or the pause backstop only, so
 * text settles slightly later. In a two-person consultation the speaker change
 * is the dominant boundary, and it is the boundary that was unreliable before.
 * `MODE_SETTINGS.dictation` inverts both and says why.
 *
 * **The argument is a closed enum, and that is a stronger guarantee than the
 * no-argument rule it replaces** (issue #356). Arity zero was one way to state
 * the property "nothing a caller supplies reaches a value crossing the audio
 * egress", never the property itself. A closed enum lets a caller pick which of
 * two static module constants is sent and never what is in either, an unknown
 * value throws rather than falling back, and the replacement tests assert both
 * of those against adversarial strings.
 */
export function liveSessionConfig(mode: LiveAsrMode): LiveSessionConfig {
  const settings = settingsFor(MODE_SETTINGS, mode)

  return {
    model: env.SONIOX_RT_MODEL,
    languageHints: [...settings.languageHints],
    languageIdentification: true,
    speakerDiarization: settings.speakerDiarization,
    endpointDetection: settings.endpointDetection,
    context: {
      general: settings.general.map((entry) => ({ ...entry })),
      // The term builders return a fresh array per call for the same reason
      // `general` is copied: a caller that mutated what it was handed would
      // change what the next consultation sends across the audio egress.
      terms: settings.terms(),
    },
  }
}

/**
 * Mints one browser-usable credential for one live session.
 *
 * The mode is here for one reason: the session cap it carries is per mode, and
 * the provider binds that cap to the key at mint time, so it cannot be chosen
 * later. Same closed-enum lookup as `liveSessionConfig`, so an unknown value
 * throws before the account credential is put on the wire rather than sending
 * `undefined` as a duration.
 *
 * The returned `clientReferenceId` is generated here rather than accepted from
 * the client, and is bound to the key by the provider: it appears in their
 * usage log for every request the key authenticates and cannot be overridden by
 * whoever holds it. That is what lets the audit row we write be reconciled
 * against the provider's own record of an egress our server never observed.
 */
export async function mintSonioxSession(mode: LiveAsrMode): Promise<{
  apiKey: string
  expiresAt: string
  clientReferenceId: string
}> {
  const maxSessionSeconds = settingsFor(MAX_SESSION_DURATION_SECONDS, mode)

  // The route answers 503 before calling; this is the fail-closed backstop.
  if (!env.SONIOX_API_KEY) {
    throw new SonioxMintError('SONIOX_API_KEY is not set', 'unavailable')
  }

  const clientReferenceId = randomUUID()
  // Unquoted keys, as in `ilmu.ts`: these are vendor wire fields rather than
  // clinical constants, and the clinical-constants guard refuses quoted
  // literals outside the versioned data files.
  const payload = {
    usage_type: 'transcribe_websocket',
    expires_in_seconds: TEMPORARY_KEY_TTL_SECONDS,
    max_session_duration_seconds: maxSessionSeconds,
    client_reference_id: clientReferenceId,
  }

  let response: Response
  try {
    response = await fetch(`${sonioxHosts(env.SONIOX_REGION).api}/v1/auth/temporary-api-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SONIOX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // This request carries the account credential. Following a redirect would
      // present it to whatever host answered.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new SonioxMintError('Soniox could not be reached before the timeout', 'unavailable')
  }

  if (!response.ok) {
    throw new SonioxMintError(
      `Soniox returned HTTP ${response.status}`,
      REASON_BY_STATUS[response.status] ?? 'unavailable',
    )
  }

  let payloadBack: unknown
  try {
    payloadBack = await response.json()
  } catch {
    throw new SonioxMintError('Soniox returned a non-JSON response', 'unavailable')
  }

  const parsed = SonioxTemporaryKeyWireSchema.safeParse(payloadBack)
  if (!parsed.success) {
    // Fixed message, no prettified issues: a Zod issue can quote received
    // values, and on this path one of them is a credential.
    throw new SonioxMintError('Soniox response failed schema validation', 'unavailable')
  }

  return {
    apiKey: parsed.data.api_key,
    expiresAt: parsed.data.expires_at,
    clientReferenceId,
  }
}

/**
 * Provider, model and region for audit stamps, mirroring `getAsrDescriptor`:
 * read from the environment without touching the key, so an audit write that
 * only wants three strings cannot fail.
 */
export function getLiveAsrDescriptor(): {
  provider: 'soniox'
  model: string
  region: LiveAsrRegion
} {
  return { provider: 'soniox', model: env.SONIOX_RT_MODEL, region: env.SONIOX_REGION }
}
