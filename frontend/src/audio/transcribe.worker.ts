/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />
import {
  type AutomaticSpeechRecognitionPipeline,
  BaseStreamer,
  env,
  pipeline,
} from '@huggingface/transformers'
import {
  CHUNK_LENGTH_S,
  countChunks,
  HEARTBEAT_TOKENS,
  STRIDE_LENGTH_S,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.js'

/**
 * On-device speech recognition (issue #2, docs/trd.md §20).
 *
 * **No audio byte reaches the API.** Transcription runs entirely in this
 * worker, in the doctor's browser, and the only thing that leaves it is text
 * the doctor then reviews and edits. That is not a performance choice: it is
 * what lets the product claim a consultation recording never crosses the
 * network, and it is why hosted ASR is specified but deliberately not built.
 *
 * It runs in a worker rather than on the main thread because a `whisper-small`
 * forward pass on WASM blocks for seconds at a time, and a frozen review screen
 * during a consultation is worse than a slow one.
 *
 * **The model is fetched from the HuggingFace CDN on first use and cached by
 * the browser thereafter, never bundled into the build.** Hundreds of MB of
 * weights in a Vercel deployment would be absurd, and the CDN fetch is the one
 * runtime call to a third party in this product; `docs/` discloses it, because
 * a reviewer who finds it unannounced in a network trace has every reason to
 * ask what else is undisclosed.
 */

/**
 * `whisper-small`, and the size is a measured decision rather than a default.
 *
 * `base` was tried first and rejected: on Malaysian English it rendered
 * "auntie" as "until" and dropped "pasar malam" entirely (docs/trd.md §20.1,
 * decisions.md 13/08). Those are not exotic edge cases in a Malaysian GP
 * consultation, they are the register the transcript is written in, and a model
 * that silently drops them produces a clean-looking transcript that is wrong.
 *
 * The multilingual checkpoint rather than the `.en` one, because the `.en`
 * variants take no `language` argument and pinning the language is the control
 * below.
 *
 * `onnx-community` rather than the older `Xenova` mirror of the same model, and
 * that is a measured choice too. `Xenova/whisper-small` fails to load at all on
 * this runtime: the quantised decoder is missing a scale tensor the bundled
 * ONNX Runtime requires, and the session never opens.
 *
 *   Can't create a session. qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
 *   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
 *
 * It surfaces only after the full weight download, and the pipeline reports it
 * as a generic failure rather than as a bad artefact, which is why it is worth
 * naming here rather than leaving the next person to rediscover it.
 */
const MODEL = 'onnx-community/whisper-small'

/**
 * Where the weights come from, overridable.
 *
 * Defaults to the HuggingFace CDN, which is the one third-party request this
 * product makes at runtime and is disclosed as such. `VITE_ASR_MODEL_HOST`
 * points it somewhere else instead, which is what a clinic needs if its network
 * policy does not permit that fetch: mirror the files, serve them from the same
 * origin as the app, and the on-device claim becomes an on-premises one with no
 * third-party call at all.
 *
 * The path layout under the host matches HuggingFace's own
 * (`{model}/resolve/{revision}/…`), so a mirror is a plain file copy rather
 * than a rewrite.
 */
const MODEL_HOST = import.meta.env.VITE_ASR_MODEL_HOST as string | undefined
if (MODEL_HOST) env.remoteHost = MODEL_HOST

const post = (message: WorkerResponse) => self.postMessage(message)

function onProgress(event: unknown) {
  const p = event as { status?: string; loaded?: number; total?: number }
  /*
   * Only the aggregate figure. The library also emits per-file `progress`
   * events, and forwarding those is how the bar used to sawtooth: each
   * artefact drove it to 100 and the next reset it, and summing them by hand
   * walks backwards as files register their sizes. `progress_total`'s
   * denominator covers every expected file from its first event. A zero total
   * (a mirror without content-length) is still posted: it cannot render as a
   * percentage, but it rearms the caller's silence budget.
   */
  if (p.status === 'progress_total') {
    post({ type: 'progress', loaded: p.loaded ?? 0, total: p.total ?? 0 })
  }
}

/**
 * The path proven end to end in this product's own testing, and what WebGPU
 * falls back to below. Kept byte-for-byte unchanged from the single-device
 * version this replaced, precisely so this remains true.
 */
async function loadWasm() {
  return pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    /*
     * A scalar, so every module is quantised: encoder and decoder both run
     * q8, which is the library's own WASM default made explicit and pinned.
     * The quantised decoder refuses to open under default session options,
     * and the fix for that is the disabled optimisation pass below, not a
     * different dtype (docs/trd.md section 20 records the diagnosis).
     */
    dtype: 'q8',
    /*
     * Graph optimisation off, and this is the fix for a load failure rather
     * than a performance knob.
     *
     * With optimisation on, the session never opens:
     *
     *   Can't create a session. qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
     *   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
     *
     * The scale is not actually missing. That tensor name appears 341 times in
     * the decoder, and the failure is inside an ONNX Runtime *optimisation
     * pass*, which rewrites quantised MatMuls and cannot resolve the reference
     * in this graph. Skipping the pass loads the same weights unchanged.
     *
     * Measured rather than guessed at each step: the failure is identical on
     * `Xenova/whisper-small` and `onnx-community/whisper-small`, so it is not a
     * bad mirror, and `decoder_model_merged_int8.onnx` is byte-identical to the
     * `_quantized` one, so switching dtype was never going to help either.
     */
    session_options: { graphOptimizationLevel: 'disabled' },
    progress_callback: onProgress,
  })
}

/**
 * Whether a real WebGPU adapter exists, not just the API surface (issue #129).
 *
 * `'gpu' in navigator` is not the check, and that is measured rather than a
 * style preference: this project's own testing (14/08/26) found an
 * environment where `navigator.gpu` exists and `requestAdapter()` resolves to
 * `null`. Testing for the API's presence would select WebGPU on a machine it
 * cannot run on.
 */
/**
 * How long the adapter probe may take before WASM is chosen anyway. A hung
 * GPU process never rejects, it just never answers, and WASM is first-class
 * here rather than a degradation, so a slow probe simply means WASM.
 */
const ADAPTER_PROBE_MS = 3_000

async function hasWebGpuAdapter(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false
  try {
    const adapter = await Promise.race([
      navigator.gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ADAPTER_PROBE_MS)),
    ])
    return adapter !== null
  } catch {
    return false
  }
}

/**
 * WebGPU when a real adapter exists, WASM otherwise (issue #129).
 *
 * The two are not offered the same options. `dtype: 'q8'` and the disabled
 * graph-optimisation pass in `loadWasm` are measured fixes for a bug in the
 * WASM execution provider specifically, never checked against WebGPU's, so
 * carrying them across backends would be a guess wearing the shape of a fix.
 * WebGPU instead pins the pairing the library's own Whisper demos ship for
 * models this size: a full-precision encoder with a `q4` decoder (issue
 * #144). Left at the device default everything comes down at `fp32`, roughly
 * 968 MB against this pairing's roughly 586 MB, and scalar `q8` is not the
 * answer either: transformers.js issue #894 measures it pathologically slow
 * on WebGPU, and the q8 decoder is independently known not to open on this
 * runtime (see `loadWasm`).
 *
 * A WebGPU adapter existing is not proof every operator this model needs is
 * implemented in it, so a failure here still falls back to the WASM path
 * rather than surfacing an error a plain WASM run would never have had. That
 * fallback has not been exercised against real WebGPU hardware by this
 * product's own testing; only the detection-finds-nothing path has.
 */
/*
 * Single-flight: the in-flight promise is memoised, not just the result, so
 * two near-simultaneous requests can never start two parallel multi-hundred
 * megabyte downloads. A failed load clears the memo, so the next request
 * starts clean rather than replaying the rejection forever.
 */
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  loading ??= doLoad().catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

async function doLoad() {
  if (!(await hasWebGpuAdapter())) return loadWasm()

  try {
    return await pipeline('automatic-speech-recognition', MODEL, {
      device: 'webgpu',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      progress_callback: onProgress,
    })
  } catch {
    return loadWasm()
  }
}

/*
 * One run at a time. The shipped component disables its controls while busy,
 * so this guards a future caller: two interleaved runs would weave two
 * message streams into one state machine on the other side.
 */
let running = false

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'load') {
    try {
      await load()
      post({ type: 'ready' })
    } catch (error) {
      post({
        type: 'error',
        message: error instanceof Error ? error.message : 'Transcription failed',
      })
    }
    return
  }

  if (running) return
  running = true
  try {
    const asr = await load()
    /*
     * The model is loaded; everything after this is inference. Without this
     * the caller never leaves `loading-model`, because `ready` was only ever
     * posted for an explicit `load` request and nothing sends one. The
     * component's "Transcribing on this device" copy was therefore
     * unreachable, and a long recording spent its whole run claiming to be
     * downloading a model it had already cached.
     */
    post({ type: 'ready' })

    /*
     * Real per-chunk progress, not an animation.
     *
     * The pipeline calls `generate()` once per audio chunk and `generate()`
     * calls `streamer.end()` exactly once before it returns, so `end()` is a
     * precise "one chunk finished" tick. `streamer` is a documented generation
     * parameter and every kwarg here is spread into the generation config by
     * `_call_whisper`, so this rides a public API rather than a private hook.
     *
     * `put` fires per decoded token. Posting every one would flood the main
     * thread, so it posts a throttled `alive` heartbeat instead: liveness for
     * the caller's silence budget, never a number to render.
     */
    const total = countChunks(event.data.audio.length)
    let done = 0
    let tokens = 0
    let finished = false

    class ChunkCounter extends BaseStreamer {
      /*
       * Must never decode or log what it is given. `WhisperTextStreamer`
       * without a `callback_function` prints decoded text via `console.log`,
       * and logging transcript bodies is banned (AGENTS.md), so any streamer
       * swap here has to keep this a `BaseStreamer` that touches nothing but
       * a counter. The worker test asserts the console stays silent.
       */
      override put() {
        tokens += 1
        if (tokens % HEARTBEAT_TOKENS === 0) post({ type: 'alive' })
      }
      override end() {
        done += 1
        // Clamped because the count is a prediction of the pipeline's own
        // windowing. If it is ever wrong, a progress bar that stops at 100 is a
        // much smaller lie than one that reports 14 of 13.
        post({ type: 'transcribing', done: Math.min(done, total), total })
        /*
         * After the last chunk the merge and decode tail blocks this thread,
         * so no further message is possible until the result. `finishing`
         * hands the caller that fact, so it can stop the percentage claim and
         * stand down the silence budget. `generate()` calls `end()` exactly
         * once per chunk in the pinned library and `countChunks` is pinned to
         * the same loop by protocol.test.ts, so this fires on the true last
         * chunk; the guard is insurance against a future windowing change.
         */
        if (done >= total && !finished) {
          finished = true
          post({ type: 'finishing' })
        }
      }
    }

    /*
     * The declared type for `streamer` is wrong, and it is the only thing
     * corrected here.
     *
     * The library types it as `BaseStreamer & TextStreamer`, which demands a
     * tokenizer and nine other members. But `generation/parameters.js`
     * documents the parameter as a plain `BaseStreamer`, and `generate()` only
     * ever calls `put()` and `end()` on it, both of which `ChunkCounter`
     * implements by extending the exported base class.
     *
     * So the field is replaced rather than the object cast: every other option
     * below stays fully checked, and exactly one documented cast bridges the
     * bad declaration at the call.
     */
    type AsrOptions = Omit<NonNullable<Parameters<typeof asr>[1]>, 'streamer'> & {
      streamer?: BaseStreamer
    }

    const options: AsrOptions = {
      streamer: new ChunkCounter(),
      /*
       * Pinned to English, never read from a locale or from the patient's
       * recorded language (docs/prd.md §12).
       *
       * Declaring the wrong language does not produce an error, it produces
       * fluent nonsense: §20.1 measured a 238-word grammatical loop out of 50
       * seconds of speech. Malaysian English with Malay and Hokkien loanwords
       * is still English for Whisper's purposes, and asking it to detect the
       * language of a code-switched consultation is how that loop starts.
       */
      language: 'en',
      task: 'transcribe',
      // A consultation runs far past Whisper's 30-second window, so it is
      // chunked, with overlap so a word spoken across a boundary is not lost.
      // Shared with `countChunks`, which predicts how many times the model will
      // run so progress can be a real fraction. Two copies of these numbers is
      // how a progress bar starts lying.
      chunk_length_s: CHUNK_LENGTH_S,
      stride_length_s: STRIDE_LENGTH_S,
      /*
       * Segment timestamps feed the draft speaker labels (docs/trd.md §20.2).
       * Measured on this exact config before being relied on: 17 clean,
       * monotonic segments over an 83 s recording, at a real cost of roughly
       * +50% transcription wall clock. The known failure shapes elsewhere
       * (segment collapse, NaN) did not appear here, but the narrowing below
       * still refuses anything malformed rather than trusting the type.
       */
      return_timestamps: true,
    }

    const output = await asr(event.data.audio, options as NonNullable<Parameters<typeof asr>[1]>)

    /*
     * Every part is joined, as before #118: a multi-part result must never
     * drop its tail, because a dropped span is a red flag that never fires.
     * Segments are read from a single-part result only; joined text cannot
     * line up with one part's timestamps, so a multi-part result degrades to
     * unlabelled prose rather than to confidently mislabelled lines.
     */
    const parts = Array.isArray(output) ? output : [output]
    const text = parts
      .map((part) => ('text' in part ? part.text : ''))
      .join(' ')
      .trim()
    /*
     * Hand-rolled narrowing instead of Zod, deliberately: this repo has been
     * burned by this runtime's declared types not matching reality, and the
     * check is three fields. Malformed segments become an empty list, which
     * downstream treats as "no usable timing", never as an error.
     */
    const segments: { text: string; start: number; end: number | null }[] = []
    const single = parts.length === 1 ? parts[0] : undefined
    const chunks: unknown = single && 'chunks' in single ? single.chunks : undefined
    if (Array.isArray(chunks)) {
      for (const chunk of chunks as unknown[]) {
        const c = chunk as { text?: unknown; timestamp?: unknown }
        const stamp = Array.isArray(c.timestamp) ? (c.timestamp as unknown[]) : null
        const start = stamp?.[0]
        const end = stamp?.[1] ?? null
        if (typeof c.text !== 'string' || typeof start !== 'number') {
          segments.length = 0
          break
        }
        segments.push({ text: c.text, start, end: typeof end === 'number' ? end : null })
      }
    }
    post({ type: 'result', text, segments })
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Transcription failed',
    })
  } finally {
    running = false
  }
}
