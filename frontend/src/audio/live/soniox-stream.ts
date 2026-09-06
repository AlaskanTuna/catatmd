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
})

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

function toLiveToken(raw: z.infer<typeof SonioxTokenSchema>): LiveToken {
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
    endpoint,
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
      handlers.onTokens(parsed.data.tokens.map(toLiveToken))
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
