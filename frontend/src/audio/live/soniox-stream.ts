import type { LiveSession } from '@shared/types'
import { z } from 'zod'
import type { LiveToken } from './live-tokens.js'

/*
 * The one WebSocket in this application, and the audio egress it carries.
 *
 * Ambient capture streams from the browser straight to the provider, because a
 * socket cannot pass through the Vercel rewrite that makes the session cookie
 * first-party and a direct socket to our own API would lose it. The API stays
 * the policy point by minting the short-lived key this module is handed; what
 * happens after that is here, in one file, pinned by
 * `no-stray-websocket.test.ts`.
 *
 * Nothing in this module logs. A failure is a value from a closed set, because
 * the vendor's own error text is free-form and this path is one where it can
 * name a credential.
 */

/**
 * The provider's wire shape, quarantined here the way each backend adapter
 * quarantines its provider's.
 *
 * **`error_message` and `error_type` are deliberately absent.** Zod strips
 * unknown keys, so the vendor's free text cannot survive parsing and therefore
 * cannot be rendered, stored, or reported by accident. Only `error_code` is
 * kept, and only to notice that a failure happened: nothing here reads the
 * value, and a field nothing reads is a field a later change reaches for.
 */
const SonioxTokenSchema = z.object({
  text: z.string(),
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
  is_final: z.boolean().optional(),
  // A speaker label is an opaque identity, and the vendor has shipped it as
  // both a string and a number. It is never parsed as a person.
  speaker: z.union([z.string(), z.number()]).optional(),
  language: z.string().optional(),
  /*
   * How sure the recogniser was of this token (issue #309).
   *
   * Bounded to the vendor's documented range rather than trusted, because this
   * number reaches a doctor as a cue to re-read a word. `.catch` is what makes
   * the bound safe to enforce on a live path: an out-of-range value becomes
   * absent, which `toLiveToken` maps to "unknown", instead of failing the whole
   * message and ending a consultation mid-sentence. The `speaker` field above
   * records that this vendor has already changed a field's type once.
   */
  confidence: z.number().min(0).max(1).optional().catch(undefined),
  /*
   * Whether a token is speech or a machine translation of speech (#393).
   *
   * Kept as a raw string here and judged in `toLiveToken`, because what an
   * unexpected value means depends on the session. Unlike `confidence`, this
   * decides what counts as something a person said, so on a translated
   * session an unknown value ends the stream rather than being read as speech.
   */
  translation_status: z.string().optional(),
  source_language: z.string().optional(),
})

/** The statuses a translated session may carry, from the vendor's docs and #389. */
const SPEECH_STATUSES = new Set(['original', 'none'])

const SonioxMessageSchema = z.object({
  tokens: z.array(SonioxTokenSchema).default([]),
  finished: z.boolean().optional(),
  error_code: z.number().optional(),
})

/**
 * Control words the recogniser emits as tokens. They mark boundaries rather
 * than speech, and rendering one would put a stray marker in a clinical
 * transcript, so they are recognised by shape and never by exact spelling: a
 * vendor adding a marker must not be able to leak it into a consultation.
 */
const CONTROL_TOKEN = /^<[a-z]+>$/

/**
 * How long to wait for the socket to open before giving up.
 *
 * The doctor is holding an open microphone and a patient is waiting, so a slow
 * connection is a failed one: better to say so and offer Press To Record than
 * to sit on a silent screen that looks like it is listening.
 */
export const CONNECT_TIMEOUT_MS = 10_000

/**
 * How often the recorder hands a chunk to the socket.
 *
 * Here rather than in a capture component because it is a property of what the
 * socket wants, not of any one surface: ambient capture and prescription
 * dictation both feed the same stream and must not drift apart on it.
 */
export const TIMESLICE_MS = 250

/**
 * How long to wait, after the end frame, for the provider to acknowledge that
 * it has finished.
 *
 * Bounded because the alternative is worse than a slightly truncated tail: a
 * doctor who has pressed stop and sees nothing has no way to tell a slow drain
 * from a dead session. On timeout the settled text is delivered anyway, with
 * `finished: false` so the caller knows the last words may be missing.
 */
export const FINISH_TIMEOUT_MS = 10_000

export type LiveStreamFailure =
  /** The socket never opened. Nothing was sent. */
  | 'connect_failed'
  /** The provider refused the session, which usually means the key. */
  | 'rejected'
  /** The socket closed mid-consultation. Settled text is still good. */
  | 'closed'
  /** A message did not match the contract, so the stream is not trustworthy. */
  | 'invalid_message'

export type SonioxStreamHandlers = {
  onOpen: () => void
  onTokens: (tokens: readonly LiveToken[]) => void
  onFailure: (failure: LiveStreamFailure) => void
}

export type SonioxStream = {
  readonly state: 'connecting' | 'streaming' | 'draining' | 'closed'
  /** Forwards one recorder chunk. Ignored unless the socket is streaming. */
  send: (chunk: Blob) => void
  /** Ends the stream and waits, briefly, for the provider to acknowledge it. */
  finish: () => Promise<{ finished: boolean }>
  /** Drops the session without ceremony. Fires no handler. */
  abort: () => void
}

/**
 * Whether a token is a translation, or `null` when a translated session sent a
 * status this client cannot place.
 *
 * **Fails closed on a translated session only.** There every token carries a
 * status (#389 measured all of them), so an absent or unknown one means the
 * contract moved, and reading it as speech could put a translation into the
 * transcript as words somebody said, labelled as the doctor's. An untranslated
 * session never asked for translation, so its status is ignored, and a stray
 * translation token there is marked and dropped by every reader rather than
 * ending a consultation over a field it does not use.
 */
function translationOf(
  raw: z.infer<typeof SonioxTokenSchema>,
  translatedSession: boolean,
): boolean | null {
  if (CONTROL_TOKEN.test(raw.text)) return false
  if (raw.translation_status === 'translation') return true
  if (!translatedSession) return false
  return raw.translation_status !== undefined && SPEECH_STATUSES.has(raw.translation_status)
    ? false
    : null
}

function toLiveToken(raw: z.infer<typeof SonioxTokenSchema>, translated: boolean): LiveToken {
  const endpoint = CONTROL_TOKEN.test(raw.text)
  return {
    // A control token contributes no text, so a caller that ignores `endpoint`
    // still cannot render the marker.
    text: endpoint ? '' : raw.text,
    startMs: raw.start_ms ?? 0,
    endMs: raw.end_ms ?? raw.start_ms ?? 0,
    isFinal: raw.is_final ?? false,
    speaker: raw.speaker === undefined ? null : String(raw.speaker),
    language: raw.language ?? null,
    // Absent maps to `null`, never to 0. An unknown is not an uncertainty, and
    // a missing field read as "least confident" would underline a whole
    // consultation the moment a vendor stopped sending this.
    confidence: raw.confidence ?? null,
    endpoint,
    // Only ever set on a translation, so an untranslated stream produces
    // tokens byte-identical to the ones it produced before #393.
    ...(translated ? { translated: true, sourceLanguage: raw.source_language ?? null } : {}),
  }
}

/**
 * Opens one recognition session.
 *
 * The lifecycle is `connecting` to `streaming` to `draining` to `closed`, and
 * every path out of it ends closed exactly once: a failure fires `onFailure`
 * one time and never again, so a caller can treat it as terminal.
 *
 * `onerror` is deliberately not handled. Browsers always follow it with
 * `onclose`, which is where the decision is made; acting on both would double
 * every failure.
 */
export function openSonioxStream(
  session: LiveSession,
  handlers: SonioxStreamHandlers,
): SonioxStream {
  let state: SonioxStream['state'] = 'connecting'
  const translation = session.config.translation
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let finishTimer: ReturnType<typeof setTimeout> | undefined
  let settleFinish: ((result: { finished: boolean }) => void) | undefined

  const socket = new WebSocket(session.websocketUrl)
  socket.binaryType = 'arraybuffer'

  const clearTimers = () => {
    if (connectTimer !== undefined) clearTimeout(connectTimer)
    if (finishTimer !== undefined) clearTimeout(finishTimer)
    connectTimer = undefined
    finishTimer = undefined
  }

  const closeSocket = () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000)
    }
  }

  /** The single exit. Anything already closed is left alone. */
  const settle = (failure: LiveStreamFailure | null) => {
    if (state === 'closed') return
    /*
     * A socket dying inside a drain the caller asked for is not a failure the
     * caller needs told about: it already holds `finished: false`, which says
     * the tail may be short, and reporting a lost connection on top of a clean
     * stop puts a false alarm on screen after a consultation that ended
     * normally. Reporting it also invites a second delivery of the same
     * transcript from a caller that treats a failure as terminal.
     */
    const report = state === 'draining' ? null : failure
    state = 'closed'
    clearTimers()
    closeSocket()
    // A caller awaiting the drain must never hang on a session that ended
    // another way.
    settleFinish?.({ finished: false })
    settleFinish = undefined
    if (report) handlers.onFailure(report)
  }

  connectTimer = setTimeout(() => settle('connect_failed'), CONNECT_TIMEOUT_MS)

  socket.onopen = () => {
    if (state !== 'connecting') return
    clearTimeout(connectTimer)
    connectTimer = undefined
    // The provider's snake_case wire names live here and nowhere else.
    socket.send(
      JSON.stringify({
        api_key: session.apiKey,
        model: session.config.model,
        // The recorder's own container, forwarded as produced. No transcoding
        // and no PCM path in the browser.
        audio_format: 'auto',
        language_hints: session.config.languageHints,
        enable_language_identification: session.config.languageIdentification,
        enable_speaker_diarization: session.config.speakerDiarization,
        enable_endpoint_detection: session.config.endpointDetection,
        // Static domain hints the API composed. Forwarded as received and never
        // added to here: this frame is the audio egress, and the one guarantee
        // behind this field is that no request shaped it.
        context: session.config.context,
        // Present only on a translated session, so every other frame is
        // byte-identical to what it was before #393. The values are the API's
        // closed literals, mapped to the vendor's wire names here and nowhere
        // else.
        ...(translation === undefined
          ? {}
          : {
              translation: {
                type: translation.type,
                language_a: translation.languageA,
                language_b: translation.languageB,
              },
            }),
      }),
    )
    state = 'streaming'
    handlers.onOpen()
  }

  socket.onmessage = (event: MessageEvent) => {
    if (state !== 'streaming' && state !== 'draining') return

    let payload: unknown
    try {
      payload = JSON.parse(String(event.data))
    } catch {
      settle('invalid_message')
      return
    }

    const parsed = SonioxMessageSchema.safeParse(payload)
    if (!parsed.success) {
      settle('invalid_message')
      return
    }

    if (parsed.data.error_code !== undefined) {
      settle('rejected')
      return
    }

    if (parsed.data.tokens.length > 0) {
      const tokens: LiveToken[] = []
      for (const raw of parsed.data.tokens) {
        const translated = translationOf(raw, translation !== undefined)
        if (translated === null) {
          settle('invalid_message')
          return
        }
        tokens.push(toLiveToken(raw, translated))
      }
      handlers.onTokens(tokens)
    }

    if (parsed.data.finished) {
      const resolve = settleFinish
      settleFinish = undefined
      state = 'closed'
      clearTimers()
      closeSocket()
      resolve?.({ finished: true })
    }
  }

  socket.onclose = () => {
    // Reached only when the stream ended without being settled first, which is
    // a drop rather than a stop.
    settle(state === 'connecting' ? 'connect_failed' : 'closed')
  }

  return {
    get state() {
      return state
    },
    send(chunk) {
      if (state !== 'streaming' || socket.readyState !== WebSocket.OPEN) return
      if (chunk.size === 0) return
      socket.send(chunk)
    },
    finish() {
      if (state !== 'streaming') return Promise.resolve({ finished: false })
      state = 'draining'
      // An empty frame is end-of-audio. The provider answers with `finished`
      // once it has transcribed what it still holds.
      socket.send('')
      return new Promise((resolve) => {
        settleFinish = resolve
        finishTimer = setTimeout(() => {
          const settleNow = settleFinish
          settleFinish = undefined
          state = 'closed'
          clearTimers()
          closeSocket()
          settleNow?.({ finished: false })
        }, FINISH_TIMEOUT_MS)
      })
    },
    abort() {
      settle(null)
    },
  }
}
