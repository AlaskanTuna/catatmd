/// <reference lib="webworker" />
import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse } from './protocol.js'

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
 * the browser thereafter, never bundled into the build.** Roughly 250 MB of
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

let transcriber: AutomaticSpeechRecognitionPipeline | null = null

async function load() {
  if (transcriber) return transcriber
  transcriber = await pipeline('automatic-speech-recognition', MODEL, {
    // WASM is first-class here rather than a fallback (docs/trd.md §20). WebGPU
    // is faster where it exists, but availability across clinic desktops is not
    // something this product can assume, and a path that works everywhere beats
    // a faster one that strands some users.
    device: 'wasm',
    /*
     * Split by module, and both halves are forced rather than tuned.
     *
     * **The `q8` decoder does not load at all**, on either published repo, and
     * that was measured rather than assumed: the same failure appears with
     * `Xenova/whisper-small` and `onnx-community/whisper-small`, so it is a
     * property of how the quantised decoder is converted against the ONNX
     * Runtime bundled here, not of one mirror.
     *
     *   Can't create a session. qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
     *   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
     *
     * It surfaces only after the full weight download and is reported as a
     * generic session failure, which is why it is written down here.
     *
     * So the decoder stays unquantised and the encoder carries the saving. That
     * is also the better half to quantise on the merits: the encoder runs once
     * over the audio, while the decoder runs per token and is where a
     * quantisation artefact turns into a wrong word.
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
    progress_callback: (event: unknown) => {
      const p = event as { status?: string; file?: string; loaded?: number; total?: number }
      if (p.status === 'progress' && p.total) {
        post({ type: 'progress', loaded: p.loaded ?? 0, total: p.total, file: p.file ?? '' })
      }
    },
  })
  return transcriber
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === 'load') {
      await load()
      post({ type: 'ready' })
      return
    }

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
    const output = await asr(event.data.audio, {
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
      chunk_length_s: 30,
      stride_length_s: 5,
      /*
       * Segment timestamps feed the draft speaker labels (docs/trd.md §20.2).
       * Measured on this exact config before being relied on: 17 clean,
       * monotonic segments over an 83 s recording, at a real cost of roughly
       * +50% transcription wall clock. The known failure shapes elsewhere
       * (segment collapse, NaN) did not appear here, but the narrowing below
       * still refuses anything malformed rather than trusting the type.
       */
      return_timestamps: true,
    })

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
  }
}
