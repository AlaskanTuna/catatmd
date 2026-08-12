# 07 — GitHub / OSS Engineering Research

**Stream:** high-starred GitHub / OSS with direct engineering payoff
**Date:** 13/08/26
**Scope:** (1) PHI/PII de-identification libraries usable from TypeScript, (2) medical NER, (3) browser Whisper via transformers.js in production, (4) OSS AI scribes worth mining.

**Evidence convention**

| Tag          | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| **VERIFIED** | Read directly from the cited page (GitHub API, HF file listing, issue body).    |
| **REPORTED** | Quoted from a search index snippet of the cited page; page itself did not load. |
| **INFERRED** | My reasoning over verified facts. Not a source claim.                           |
| **VENDOR**   | Marketing/editorial content with a commercial interest. Low trust.              |

No benchmark in this document is mine. Every number is attributed.

---

## 1. De-Identification Libraries — The Verdict First

> **VERDICT: Keep the hand-rolled Malaysian regex. Nothing available beats it for Malaysian PHI in the current build window.** Every drop-in candidate is either (a) Python-only, (b) a regex engine with zero Malaysian coverage, or (c) a 350 MB+ model with a stale JS runner. The three upgrades worth making are cheap and additive — see [What This Changes](#what-this-changes).

### 1.1 Microsoft Presidio — Capable, But Not Reachable From Node

| Fact               | Value                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Stars              | 10,459                                                                                    |
| Last push          | 2026-08-11 (actively maintained)                                                          |
| License / language | MIT / Python                                                                              |
| Open issues        | 105                                                                                       |
| Home               | Moved from `microsoft/presidio` to the `data-privacy-stack` org; docs now on a new domain |

**VERIFIED** — https://api.github.com/repos/microsoft/presidio · https://github.com/microsoft/presidio

**No JavaScript/TypeScript port exists.** The maintainer (`omri374`) answered discussion #1633 (16/06/25) with: _"The best approach is to use Presidio in Docker and call through a rest API."_
**REPORTED** — https://github.com/microsoft/presidio/discussions/1633 (page would not load for direct fetch; quote is from the search index of that discussion)

**No Malaysian recognizer.** The supported-entities list covers global entities (`CREDIT_CARD`, `DATE_TIME`, `EMAIL_ADDRESS`, `IP_ADDRESS`, `LOCATION`, `PERSON`, `PHONE_NUMBER`, `MEDICAL_LICENSE`, `URL`, `IBAN_CODE`, `CRYPTO`, `MAC_ADDRESS`, `NRP`) plus country blocks for USA, UK, Spain, Italy, Poland, **Singapore (`SG_NRIC_FIN`, `SG_UEN`)**, Australia, India, Finland, Korea, Nigeria, Philippines, Canada, Sweden, South Africa, Thailand, Turkey, Germany. **Malaysia / MyKad is absent.**
**VERIFIED** — https://presidio.dataprivacystack.org/supported_entities/

**English-only by default.** Adding a language requires both a new NLP model (spaCy / Stanza / transformers) _and_ new language-specific recognizers, because "context words used to increase the PII detection confidence aren't [language agnostic]". Malay is not listed.
**VERIFIED** — https://presidio.dataprivacystack.org/analyzer/languages/

**Cost to adopt (INFERRED):** a second runtime (Python), a second Render service, a network hop **inside** the PHI trust boundary carrying raw transcript text, and we would still hand-write every Malaysian recognizer ourselves. That is a worse security story than the current in-process gate, not a better one.

### 1.2 The `PERSON` Entity Is The Weak Spot In Presidio Too

This matters because "adopt Presidio" implicitly means "adopt spaCy/transformer NER for names".

- **Behind the Mask: Demographic bias in name detection for PII masking** (Mansfield, Paullada, Howell; arXiv 2022): _"all systems demonstrate significant differences in error rate based on demographics. In particular, the highest error rates occurred for names associated with Black and Asian/Pacific Islander individuals."_ **VERIFIED** — https://arxiv.org/abs/2205.04505
- **Do "English" Named Entity Recognizers Work Well on Global Englishes?** (EMNLP Findings 2023): models trained on CoNLL/OntoNotes suffered _"significant performance drops — over 10 F1 in some cases"_ on the Worldwide English dataset. **VERIFIED** — https://arxiv.org/abs/2404.13465
- Presidio's own docs and third-party write-ups note the underlying spaCy NER performs poorly for `LOCATION`, `NRP` and `PERSON`. **REPORTED** — https://blog.px.dev/detect-pii/

**INFERRED:** an off-the-shelf English NER would likely be _worse_ on `Ahmad bin Ismail` or `Muthu a/l Ramasamy` than a regex keyed on `bin` / `binti` / `a/l` / `a/p` and Malay honorifics. Our patronymic-particle rule is a genuinely stronger signal for this population than a CoNLL-trained model.

### 1.3 JavaScript / TypeScript De-Identification Libraries

| Library                     | Stars | Last push  | License | Approach                   | MY coverage | Verdict                                                              |
| --------------------------- | ----- | ---------- | ------- | -------------------------- | ----------- | -------------------------------------------------------------------- |
| `solvvy/redact-pii`         | 217   | n/a        | MIT     | Regex (+ optional GCP DLP) | None        | US-English by the README's own admission                             |
| `able-wong/redact-pii-core` | small | n/a        | MIT     | Fork, DLP removed          | None        | Same patterns, smaller bundle                                        |
| `sam247/openredaction`      | 99    | 2026-08-07 | MIT     | Regex, "570+ patterns"     | None        | Only candidate worth reading — for its _API shape_, not its patterns |
| `wrannaman/redactpii-node`  | small | n/a        | —       | Regex, zero-dep            | None        | Advertises a SaaS tie-in (`redactpii.com`) for audit logs            |

**`redact-pii` (solvvy)** — 217 stars, MIT, not archived on GitHub. Detectors: credentials, credit card, email, IP, names, passwords, phone, street address, username, US SSN, zip, URL, digits. README states: _"the built-in redaction rules are mostly applicable for identifying (US-)english PII"_ and recommends Google DLP for anything else.
**VERIFIED (repo page)** — https://github.com/solvvy/redact-pii
Conflicting signal: the npm listing shows latest `3.4.0` published ~4 years ago with an author note that the package is no longer supported. **REPORTED** — https://www.npmjs.com/package/redact-pii

**`openredaction`** — 99 stars, MIT, TypeScript, created 2025-11-21, last push 2026-08-07, 13 open issues. **VERIFIED** — https://api.github.com/repos/sam247/openredaction

- Claims "570+ PII patterns", "government IDs (50+ countries)", healthcare identifiers. **README does not mention Malaysia, MyKad or NRIC.** **VERIFIED** — https://raw.githubusercontent.com/sam247/openredaction/main/README.md
- Root npm package is a 5.8 KB meta-package re-exporting `@openredaction/core|react|server|express`, v1.1.5, MIT. **VERIFIED** — https://registry.npmjs.org/openredaction/latest
- npm reports ~82,000 downloads for 11/07/26–09/08/26. **VERIFIED (raw npm counter)** — https://api.npmjs.org/downloads/point/last-month/openredaction — but raw npm counts include CI, mirrors and bots; for a package 9 months old with 99 stars, treat this as unusable as a quality signal. **INFERRED**
- **The one genuinely useful idea:** it ships a `token-replace` mode with `deterministic: true` plus a `redactor.restore(response, redactionMap)` call — i.e. exactly our tokenise-then-rehydrate vault shape. Useful as a **design cross-check** that our API surface is the conventional one. Nothing more.

**Structural point (INFERRED):** every JS option here is a regex engine. Adopting one means replacing _our_ regex with _their_ regex. Ours is Malaysia-specific; theirs is not. The only incremental coverage on offer is for identifier classes that do not appear in a Malaysian GP consultation transcript (IBAN, crypto wallets, US SSN).

### 1.4 The Real Gap, And What Would Actually Close It

Regex cannot catch a bare given name with no honorific, no particle, and no label. That is the only true recall gap. Closing it needs a model **or** a gazetteer.

**Option A — token-classification NER in-process via transformers.js (Node)**

| Model                  | Smallest usable ONNX                                                                 | Note                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `Xenova/bert-base-NER` | `model_q4f16` 93.7 MB · `model_int8` 108 MB · `model_quantized` 109 MB (fp32 431 MB) | CoNLL-2003 English; the exact model class the bias papers indict |

**VERIFIED** — https://huggingface.co/Xenova/bert-base-NER/tree/main/onnx

**Option B — GLiNER zero-shot NER (define your own labels)**

| Artefact                             | Fact                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onnx-community/gliner_multi_pii-v1` | `model_int8`/`model_quantized`/`model_uint8` **349 MB**, `model_q4f16` 472 MB, `model_fp16` 580 MB, fp32 1.16 GB. ~779 downloads/month. **VERIFIED** — https://huggingface.co/onnx-community/gliner_multi_pii-v1/tree/main/onnx                                                                                                                                                                 |
| `gliner` (npm, the JS runner)        | v0.0.19, published **2025-03-02**, MIT, deps `onnxruntime-web@1.19.2` + `@xenova/transformers@2.17.2` (v2 — two majors behind), peer `onnxruntime-node@1.19.2`. **VERIFIED** — https://registry.npmjs.org/gliner                                                                                                                                                                                |
| `Ingvarstep/GLiNER.js`               | **28 stars**, Apache-2.0, last push **2025-03-02**, 9 open issues. **VERIFIED** — https://api.github.com/repos/Ingvarstep/GLiNER.js                                                                                                                                                                                                                                                             |
| Alternatives                         | `@lmoe/gliner-onnx` (GLiNER2 fork of Knowledgator/GLiNER.js); model family `knowledgator/gliner-pii-{edge,small,base,large}-v1.0`; `nvidia/gliner-PII` (55+ PII/PHI categories); `onnx-community/multilang-pii-ner-ONNX` (xlm-roberta-base, EN/DE/IT/FR — **no Malay**). **REPORTED** — https://huggingface.co/onnx-community/multilang-pii-ner-ONNX · https://huggingface.co/nvidia/gliner-PII |

**INFERRED:** the model is attractive (zero-shot, multilingual base, define labels like `person name` / `identity card number` / `clinic name`), but the JS runner is a 28-star repo unchanged for ~17 months pinned to a superseded transformers.js major. A 349 MB weight file also sits badly on a small Render instance alongside Node. This is a _future-work_ item with a real cost estimate, not a build-window adoption.

**Option C — the reference clinical de-id model**

- `obi/deid_roberta_i2b2` — MIT, trained on i2b2 2014, roberta-large. Reported >99% accuracy / 96.7% precision-recall. **REPORTED** — https://huggingface.co/obi/deid_roberta_i2b2
- **No ONNX weights in the repo** (only `pytorch_model.bin` / `model.safetensors`) → would require an Optimum conversion before any JS runtime could load it. **VERIFIED (file listing)** — https://huggingface.co/obi/deid_roberta_i2b2/tree/main
- Source project and benchmarks worth citing as future work: https://github.com/obi-ml-public/ehr_deidentification · https://physionet.org/content/transformer-deid/1.0.0/ · https://www.medrxiv.org/content/10.1101/2025.05.05.25326979v1.full

**Option D — a gazetteer (deny list). The only one that fits the build window.**

Presidio's own fastest-path recommendation is a **deny-list recognizer**: a list of terms, exact-matched, flagged as an entity type. **REPORTED** — https://microsoft.github.io/presidio/tutorial/01_deny_list/

Seed corpora for Malay names exist, though none is a purpose-built name gazetteer:

- `mesolitica/malaysian-dataset` — https://github.com/mesolitica/malaysian-dataset
- `keyreply/Malay-NLP-Dataset` — https://github.com/keyreply/Malay-NLP-Dataset
- Malay NER dataset, 28,991 sentences / 384,010 tokens, PER/LOC/ORG — https://arxiv.org/pdf/2109.01293
  **REPORTED** for all three (search index; not individually opened).

### 1.5 Malaysian NRIC — There _Is_ Something Off-The-Shelf

| Package          | What it does                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mykad` (wmthor) | Validates 12 digits, **valid date of birth**, **place-of-birth code**; `parse()` returns birth date, place, gender; `isValid()`, `format()`, `unformat()`, `generateRandom()`. Ships a 17-entry state-code table incl. `UNKNOWN_STATE`. **No checksum exists in MyKad** — date + PB code is the only structural check available. **VERIFIED** — https://raw.githubusercontent.com/wmthor/mykad/main/README.md |
| `nric-validator` | TypeScript, `YYMMDD-PB-###G`. https://github.com/hoangtranson/nric-validator                                                                                                                                                                                                                                                                                                                                  |
| `my-nric`        | TS validator/formatter, returns birth date, gender, place of birth. https://github.com/d30jeff/my-nric                                                                                                                                                                                                                                                                                                        |
| `malaysia-mykad` | Validate + extract metadata. https://www.npmjs.com/package/malaysia-mykad                                                                                                                                                                                                                                                                                                                                     |

**INFERRED — this is the highest-value single finding in the de-id stream.** Our NRIC regex currently matches shape only. Adding date-validity and a PB-code check turns a shape match into a validated match, which cuts false positives (`03-1234-5678` style noise, dates, lot numbers) **without touching recall**. This is precisely Presidio's `PatternRecognizer` contract: regex + validation + context words. We can copy the state-code table (MIT) rather than take a dependency.

---

## 2. Medical NER — Nothing Reachable From TypeScript

| Project  | Stars | Last push  | License    | Language          |
| -------- | ----- | ---------- | ---------- | ----------------- |
| scispaCy | 1,983 | 2025-12-04 | Apache-2.0 | Python            |
| medspaCy | 673   | 2026-06-04 | MIT        | Python / Notebook |

**VERIFIED** — https://api.github.com/repos/allenai/scispacy · https://api.github.com/repos/medspacy/medspacy

- Both are spaCy pipelines. Neither has a JS runtime. Adopting either means the same Python sidecar problem as Presidio, with the same PHI-crosses-a-process-boundary cost. Stanza is likewise Python (Presidio lists it as one of three supported NLP engines — https://presidio.dataprivacystack.org/analyzer/languages/).
- **They also solve a problem we do not have.** Our clinical structuring is LLM structured output against a Zod schema, and our red flags are a deterministic rules engine. Medical NER would only ever serve de-id recall, which section 1.4 already covers more cheaply.
- **Worth citing as future work, not adopting.** In a README "limitations / next steps" section, `scispaCy` + `medspaCy` + `obi/deid_roberta_i2b2` are the credible names to drop.

---

## 3. Browser Whisper — The Latency Reality

### 3.1 What Is Stale, What Is Live

| Project                         | Stars  | Last push      | License    | Status                                                                 |
| ------------------------------- | ------ | -------------- | ---------- | ---------------------------------------------------------------------- |
| `xenova/whisper-web`            | 3,340  | **2024-10-01** | MIT        | **Effectively unmaintained.** 49 open issues. WebGPU only on a branch. |
| `huggingface/transformers.js`   | 16,245 | 2026-07-31     | Apache-2.0 | Live. 269 open issues. npm latest **4.2.0**.                           |
| `tanpreetjolly/browser-whisper` | 194    | 2026-05-31     | MIT        | New (created 2026-03-09), 0 open issues, single maintainer.            |
| `huggingface/ratchet`           | 768    | 2026-05-26     | MIT        | Rust/WGPU browser ML framework; cited as the better memory model.      |

**VERIFIED** — https://api.github.com/repos/xenova/whisper-web · https://api.github.com/repos/huggingface/transformers.js · https://api.github.com/repos/tanpreetjolly/browser-whisper · https://api.github.com/repos/huggingface/ratchet · https://registry.npmjs.org/@huggingface/transformers

**transformers.js v4** shipped 2026-02-09: new WebGPU runtime rewritten in C++, tested across ~200 architectures, ~4x speedup **for BERT-based embedding models**, WebGPU across browsers/Node/Bun/Deno, ~10% smaller bundles. **The v4 blog publishes no Whisper/ASR numbers.**
**VERIFIED** — https://huggingface.co/blog/transformersjs-v4

**`browser-whisper`** — `mediabunny` + WebCodecs decoder worker → 16 kHz mono chunks → Whisper worker; automatic WASM fallback; OPFS model caching for offline reuse; default `whisper-base` ≈ **136 MB**; model range ~32 MB (Moonshine Tiny) → 2.7 GB (large-v3-turbo). Claims WebGPU on Chrome 113+, Firefox 141+, Safari 18+. **Publishes no benchmarks and no memory guidance.**
**VERIFIED** — https://raw.githubusercontent.com/tanpreetjolly/browser-whisper/main/README.md

### 3.2 Numbers We Can Actually Cite

**Issue #894 — "Whisper webgpu vs wasm performance"** (opened 2024-08-19, closed). Model `onnx-community/whisper-base`, **60 s audio**, Mac mini M2:

| Config              | WebGPU | WASM      |
| ------------------- | ------ | --------- |
| fp32 enc + q4 dec   | 9.5 s  | **5.9 s** |
| fp32 enc + fp32 dec | 9.6 s  | **4.9 s** |
| q8 + q8             | 27 s   | **5.2 s** |

Follow-up comments: v3.0.0-alpha.14 on M2 gave WebGPU 1,798 ms vs WASM 3,434 ms (reversed); v3.0.2 gave WebGPU 8.2 s vs WASM 6.2 s. Maintainer `xenova`: _"Transformers.js v4 mostly fixes this now"_ and WebGPU _"should be significantly faster than WASM now"_.
**VERIFIED** — https://github.com/huggingface/transformers.js/issues/894

> **INFERRED:** on Apple silicon, WASM `whisper-base` ran at roughly **10–12x real time**, and WebGPU was _slower_ than WASM through v3.0.2. "WebGPU or bust" is the wrong design assumption. Benchmark the actual target hardware.

**The low-end floor.** HF Space discussion: Intel Core i3-3110M @ 2.40 GHz, 4 GB RAM, Chrome 109 — **60 s of audio took 4–5 minutes** (≈ 0.2–0.25x real time). Maintainer advised quantized weights or the `base` model, noting `small` at ~250M params explains the slowness.
**VERIFIED** — https://huggingface.co/spaces/Xenova/whisper-web/discussions/9

> **INFERRED — this is the number that should drive the design.** A 15-minute consultation spans **~90 seconds on a modern Mac** to **over an hour on a 2012-era clinic PC**. A Malaysian GP clinic front desk is much closer to the second machine than the first.

**Browser WASM carries a real tax vs native.** Issue #1336 (opened 2025-06-10, closed): same model, same thread count, same dtype — web WASM **1,400 ms/batch** vs Python **400 ms/batch**; Node WASM _"almost on par with python"_. Node does not expose WebGPU (CPU/DML only).
**VERIFIED** — https://github.com/huggingface/transformers.js/issues/1336

**Memory — the exact shape of our workload.** Issue #860, _"[Severe] Memory leak issue under WebGPU Whisper transcribe pipeline"_ (opened 2024-07-23, **closed 2024-09-30**), GTX 1080: tensors not disposed after the pipeline completes, _"memory consumption keeps growing until either it goes out-of memory (for smaller GPUs) or looses the device"_, and **longer audio makes it worse**. Reporter pointed at Ratchet's static+dynamic graph and KV-caching as the better memory model.
**VERIFIED** — https://github.com/huggingface/transformers.js/issues/860

**A live regression that would hit our review UI.** Issue #1590, _"[webgpu] Whisper encoder fp16 precision issues"_ (opened 2026-03-17, **still OPEN**): on v4.0.0-next.7 with `onnx-community/whisper-large-v3-turbo_timestamped` + WebGPU + fp16, the ASR pipeline **merges all audio into a single 0–29.98 s segment**, where v3.8.1 correctly produced six phrase-level segments. Varying `chunk_length_s`, `stride_length_s`, `num_beams`, `temperature` did not help. **No workaround documented.** Related: #1357, #1358.
**VERIFIED** — https://github.com/huggingface/transformers.js/issues/1590

**Other stability signals (titles verified via search index, bodies not read):**

- #740 Chrome on Android crashes when starting Whisper — https://github.com/huggingface/transformers.js/issues/740
- #988 "Aw, Snap!" crash in Chrome using Whisper — https://github.com/huggingface/transformers.js/issues/988
- #1298 Whisper web demo not working on iOS — https://github.com/huggingface/transformers.js/issues/1298
- #958 Model reload blocked after page close/reopen — https://github.com/xenova/transformers.js/issues/958
- #1358 `whisper-base_timestamped` broken with `chunk_length_s=30` — https://github.com/huggingface/transformers.js/issues/1358

> **INFERRED:** mobile browsers are not a supportable surface for this. Scope the ASR to desktop Chrome/Edge explicitly.

### 3.3 Model Download Sizes (VERIFIED From HF File Listings)

`onnx-community/whisper-base` — https://huggingface.co/onnx-community/whisper-base/tree/main/onnx

| Component            | fp32    | fp16    | int8 / quantized | q4      |
| -------------------- | ------- | ------- | ---------------- | ------- |
| encoder              | 82.5 MB | 41.3 MB | 23.2 MB          | 18.8 MB |
| decoder_model_merged | 209 MB  | —       | —                | —       |
| decoder_with_past    | 196 MB  | 98 MB   | 50.1 MB          | 121 MB  |

→ a practical int8 `whisper-base` download is ≈ 73–76 MB of weights; `browser-whisper` cites ~136 MB for its default `whisper-base` bundle.

`onnx-community/whisper-large-v3-turbo-ONNX` — https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX/tree/main/onnx

| Component         | fp32           | fp16    | q4f16  |
| ----------------- | -------------- | ------- | ------ |
| encoder           | 2.55 GB (data) | 1.27 GB | 370 MB |
| decoder           | 688 MB         | 344 MB  | 193 MB |
| decoder_with_past | 635 MB         | 318 MB  | 186 MB |

→ even at q4f16, turbo is **≈ 560 MB+** on first load. **INFERRED:** not viable as a default.

**VENDOR (low trust, contradicts #894 — do not cite in the TRD):** an OfflineTTS editorial (updated 01/08/26, promotes its own tooling and carries affiliate links) claims hybrid-quantized sizes of tiny ~120 MB / base ~210 MB / small ~590 MB, WebGPU real-time factors of 10–15x / 5–8x / 2–4x, and a "5–10x speedup over WASM". — https://offlinetts.com/blog/browser-speech-recognition-whisper-comparison/

### 3.4 Chunking, Caching, Browser Support

- **Chunking:** Whisper is architecturally fixed to 30 s windows; long-form is handled with 30 s windows plus overlapping strides (`chunk_length_s` / `stride_length_s`). Verify the exact model+params combo — #1358 reports `whisper-base_timestamped` breaking at `chunk_length_s=30`.
- **Caching:** transformers.js caches automatically — browser Cache API / IndexedDB, Node filesystem at `~/.cache/huggingface/`. Weights survive reload, so the ~136 MB cost is first-visit only. **REPORTED** — https://github.com/huggingface/skills/blob/main/skills/transformers-js/references/CACHE.md · https://github.com/huggingface/transformers.js/issues/900
- **WebGPU availability:** the official guide warns that as of October 2024 global WebGPU support was ~70%, with Firefox and Safari behind feature flags; it recommends `device: 'webgpu'` and notes _"you may experience issues when trying to run a model (even if it can run in WASM)"_. **VERIFIED** — https://huggingface.co/docs/transformers.js/en/guides/webgpu
- **WASM multithreading needs cross-origin isolation** (`Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` response headers). **REPORTED** — https://huggingface.co/docs/transformers.js/index — **INFERRED:** setting these on Vercel also constrains cross-origin fetches, including model weights pulled from the HF CDN. Test before assuming multi-threaded WASM speeds.

### 3.5 Malay / Manglish ASR Accuracy

**Mesolitica publishes Malaysian-context Whisper fine-tunes** — `malaysian-whisper-{tiny, base, small-v2, small-v3, medium, medium-v2}`. Trained on IMDA STT, Malay Conversational Speech Corpus, pseudolabelled Malaysian YouTube and Nusantara audiobooks. `base` is 72.6M params BF16. `small-v3` adds a `transcribeprecise` task for word-level timestamps.
**VERIFIED** — https://huggingface.co/mesolitica/malaysian-whisper-base · https://huggingface.co/mesolitica/malaysian-whisper-small-v3

Caveats, all **VERIFIED** from those model cards:

- **No ONNX weights published** → an Optimum conversion is required before transformers.js could load them.
- **No WER/CER numbers on the cards read.** The quality claim ("better for Malay, Manglish, Mandarin, Tamil") is unbenchmarked in public.
- Low adoption: 58 and 141 downloads in the last month respectively.

**INFERRED:** conversion + validation is a multi-day side quest with unverified payoff. The right move is to **name it as the answer to "how would you improve Malay/Manglish accuracy"** rather than attempt it. It is a strong, specific, in-region answer to have ready.

**Moonshine** (`usefulsensors/moonshine`, in transformers.js via PR #1099): tiny 5.8M / base 61M params, ~32–61 MB, handles variable-length audio without 30 s padding, claimed 5x faster than Whisper at equal-or-better WER on 10 s segments. **English-only.** **REPORTED** — https://github.com/huggingface/transformers.js/pull/1099 · https://huggingface.co/posts/Xenova/486935205804807
**INFERRED:** wrong tool for a code-switched Manglish/BM consultation. Only relevant if we ever add a short push-to-talk field.

---

## 4. Open-Source AI Scribes — The Category Tops Out At ~200 Stars

| Project                                | Stars | Last push  | License     | Stack             |
| -------------------------------------- | ----- | ---------- | ----------- | ----------------- |
| `sammargolis/OpenScribe`               | 198   | 2026-08-07 | MIT         | TypeScript        |
| `1984Doc/AI-Scribe`                    | 53    | 2024-12-05 | **GPL-3.0** | Python (27 forks) |
| `trevorpfiz/scribeHC`                  | 25    | 2024-07-08 | MIT         | TypeScript        |
| `lukehollis/open-healthcare-ai-scribe` | 8     | 2024-12-04 | MIT         | TypeScript        |

**VERIFIED** — https://api.github.com/repos/sammargolis/OpenScribe · https://api.github.com/repos/1984Doc/AI-Scribe · https://api.github.com/repos/trevorpfiz/scribeHC · https://api.github.com/repos/lukehollis/open-healthcare-ai-scribe

**OpenScribe is the only live, comparable project.** Architecture (**VERIFIED** — https://raw.githubusercontent.com/sammargolis/OpenScribe/main/README.md):

- Monorepo: `apps/web` (Next.js App Router), `packages/pipeline` (audio, transcription, assembly), `packages/storage` (AES-GCM encrypted localStorage), `packages/llm` (**provider-agnostic** client), `packages/shell` (Electron).
- Three runtimes: mixed-web (local `whisper.cpp` server, `tiny.en` default) · local desktop (Whisper + Ollama `llama3.2` / `gemma3:4b`) · cloud fallback (OpenAI Whisper API).
- Note generation defaults to Anthropic Claude through the provider client.
- Security posture: AES-GCM encrypted localStorage, audio in-memory and not persisted, TLS/HTTPS enforced.
- **No de-identification step is documented anywhere in the README.**
- Its own disclaimer: _"OpenScribe includes foundational privacy/security features, but this alone does not make the application HIPAA-compliant."_

**What to mine (INFERRED):**

1. The **provider-agnostic LLM package boundary** — independent convergence on our `backend/src/lib/llm/` port/adapter split. Good corroboration for the TRD's rationale.
2. The **encrypted-at-rest local storage** pattern for anything the browser holds.
3. The **honest compliance disclaimer wording** — a good model for our README's limitations section.

**What NOT to mine:** its de-identification approach — it has none. `1984Doc/AI-Scribe` is **GPL-3.0**: do not copy code from it into this repo.

**Positioning fact worth stating in the README (INFERRED, grounded in the table above):** the leading open-source AI scribe, at ~200 stars and actively maintained, ships **no de-identification stage at all**. A verified PHI boundary in front of the LLM is a real differentiator in this category, not table stakes.

---

## What This Changes

### De-Identification (TRD §deid, README limitations)

1. **Keep the hand-rolled Malaysian regex.** Record it as a _decision with evidence_, not silence: Presidio is Python-only (maintainer says Docker + REST — #1633), has no Malaysian recognizer (`SG_NRIC_FIN` exists, MyKad does not), is English-only by default, and its `PERSON` path is documented to fail hardest on non-Western names (arXiv 2205.04505, arXiv 2404.13465). Every JS alternative is a US-centric regex engine with zero Malaysian coverage. **Nothing to adopt.**
2. **Add NRIC structural validation.** Layer a date-of-birth validity check and a place-of-birth state-code check on top of the existing `YYMMDD-PB-###G` shape match. MyKad has no checksum, so this is the only structural check that exists. Copy the state-code table from the MIT-licensed `mykad` package rather than adding a dependency. Cuts false positives, zero recall cost. **Cheapest real win in this document.**
3. **Reshape detectors as `pattern + score + context-words`,** matching Presidio's `PatternRecognizer` contract, instead of flat boolean regex. Lets a low-confidence pattern be promoted by nearby context (`IC`, `no. kad pengenalan`, `pesakit`, `patient`). It is the industry-standard shape and is citable as such.
4. **Add a name deny-list gazetteer** (Malay/Chinese/Indian given names + honorifics) as a second recall pass for names carrying no particle or honorific. This is Presidio's own fastest-path recommendation and is the **only** measure in this survey that raises name recall in the build window without a model.
5. **State the residual failure mode explicitly** in the TRD and README, with citations: an unmarked novel name can be missed — and an ML NER would miss it too, disproportionately for Malay names. Mitigations to name: the reviewable redacted payload, the request-scoped vault, and `LLMClient` as the sole egress point.
6. **Write the future-work paragraph with real costs** (this is what makes the weakest component read as deliberate): GLiNER multi-PII ONNX in-process (349 MB int8; JS runner is a 28-star repo last touched 2025-03-02, pinned to transformers.js v2) · Presidio in Docker, in-region, as a second pass · a fine-tuned Malaysian de-id NER seeded from `obi/deid_roberta_i2b2` (MIT, no ONNX shipped).

### ASR (TRD §asr, README constraints)

7. **Stop referencing `xenova/whisper-web` as the implementation.** Last push 2024-10-01, WebGPU only on a branch, 49 open issues. Depend on `@huggingface/transformers` (npm latest 4.2.0) directly, or evaluate `browser-whisper` (194★, MIT, WebCodecs + OPFS caching, WASM fallback) with eyes open about its age.
8. **Pin the version and test the exact model × dtype × device combo before shipping.** Issue #1590 is **open**: v4 + WebGPU + fp16 + `whisper-large-v3-turbo_timestamped` collapses all segments into one. If the review UI needs per-segment timestamps, verify on v3.8.x as well.
9. **Default to `whisper-base`, not turbo.** `whisper-base` int8 ≈ 73–76 MB of weights (~136 MB packaged); `large-v3-turbo` at q4f16 is ≈ 560 MB+ on first load. Offer `small` as an explicit opt-in.
10. **Do not assume WebGPU is faster.** Through transformers.js v3.0.2, WASM beat WebGPU on `whisper-base` on an M2 (4.9–5.9 s vs 9.5–9.6 s for 60 s audio, #894). v4's C++ runtime may have flipped this, but the v4 blog publishes no ASR numbers. Measure on the target machine; keep the WASM path first-class, not a fallback afterthought.
11. **Put an honest range in the README.** ~60 s of audio takes **4.9 s on an M2 (WASM, whisper-base)** and **4–5 minutes on a 2012 Core i3 with 4 GB RAM**. A 15-minute consultation therefore ranges from ~90 seconds to over an hour depending on the clinic's hardware. Design consequences: chunk and stream partial results, show real progress, and keep a paste-a-transcript fallback. **Never promise real-time.**
12. **Scope ASR to desktop Chromium explicitly.** Documented crashes on Android Chrome (#740), iOS (#1298), plus a WebGPU memory-growth class of bug that worsens with longer audio (#860, fixed but exactly our workload shape).
13. **Check cross-origin isolation before counting on multi-threaded WASM.** COOP/COEP headers are required, and enabling them on Vercel constrains cross-origin model fetches from the HF CDN.
14. **Have the Malay-accuracy answer ready:** `mesolitica/malaysian-whisper-*` (IMDA STT + Malay Conversational Speech Corpus + pseudolabelled Malaysian YouTube), no ONNX published, no public WER. Cite it as the improvement path — do not attempt the conversion now.

### Positioning (README)

15. **Say that the leading OSS scribe has no de-identification stage.** OpenScribe (198★, MIT, active) ships encrypted local storage and a provider-agnostic LLM client but no PHI gate, and disclaims HIPAA compliance itself. Our de-identification boundary is the differentiator; make the reviewer see it.

### What This Changes Nothing About

- **Medical NER** — scispaCy (1,983★) and medspaCy (673★) are Python-only, solve a problem we do not have, and would reintroduce the Python sidecar. Cite as future work; adopt nothing.
- **The LLM adapter layer** — OpenScribe independently arrived at the same provider-agnostic boundary. No change; treat as corroboration.
- **The deterministic-first red-flag design** — nothing in this stream touches it.
