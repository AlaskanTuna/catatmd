# 08 — Companion Mascot: Live2D / VTuber-Style Character in CatatMD

**Stream:** Exploratory. The product owner is _curious about_, not committed to, an interactive Live2D or 3D VTuber-style companion character embedded in the CatatMD web app.
**Date:** 13/08/26 · **Audience:** product owner · **Status:** research only — nothing here changes the PRD.

---

## How To Read This

| Tag                     | Meaning                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **VERIFIED**            | I fetched the page or licence text and quoted it. URL given.                           |
| **VERIFIED (metadata)** | Read from a machine API (GitHub API, npm registry) rather than a human-facing page.    |
| **INFERRED**            | My synthesis, or a search-result snippet I could not fetch end to end. Flagged inline. |
| **NOT VERIFIED**        | I tried and failed (403 / DNS / paywall). Said so rather than guessed.                 |

**Two disclosures up front:**

1. **I cannot see images.** Every visual candidate below was chosen from written descriptions, illustrator credits, stated purpose, licence terms and community usage — not from looking at it. I verified each image URL returns real image bytes (file size and format noted), but I cannot tell you whether a given model is _pretty_. That judgement is yours, and the model page is linked next to every image.
2. **The images embedded are the store thumbnails** Live2D publishes on its own WordPress uploads path. They are small (35–68 KB) and in at least two cases are narrow banner crops. Click the source link for the real render.

---

## 1. Executive Verdict

| Question                                                               | Answer                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Is it technically feasible in this React 19 + Vite SPA?**            | Yes, comfortably. Two mature paths (Live2D 2D, VRM 3D), both with app-event-driven expression APIs.                                                                                                                                |
| **Is the licensing clean for a prototype?**                            | Yes for the prototype. Live2D's SDK licence is free below **¥10M annual sales**, and the free sample models are commercially usable — **but they stay Live2D's IP and require a printed credit line**.                             |
| **Can you get a beautiful, cute, medical-appropriate model for free?** | **Not really.** The free pool is either Live2D's own characters (borrowed IP, credit required, design changes sometimes forbidden) or CC0 VRM avatars whose art direction is nowhere near "polished VTuber commission".            |
| **What does a custom one cost?**                                       | Live2D art + rigging **~USD 500–2,000**; rigging only **~USD 100–400**; custom 3D/VRM **~USD 1,000–5,000+**.                                                                                                                       |
| **Are there free ways to _create_ one?**                               | Yes — VRoid Studio, VIVERSE's browser creator, Blender + VRM add-on, Cubism FREE, Meshy free tier. All genuinely free. None of them produce commission-grade _art direction_ on their own; they produce competent generic avatars. |
| **Would an evaluator read it as polish or as a liability?**            | **Liability, with evidence.** A 2026 PRISMA systematic review of 32 studies finds anthropomorphic design "backfires" specifically in domains where professional expertise is the point — healthcare named explicitly.              |
| **Recommendation**                                                     | **Keep it out of the evaluated build.** If you want it, ship it later as an off-by-default, non-human, state-signalling companion — the Microsoft _Mico_ shape, not the VTuber shape. See §7.                                      |

---

## 2. Runtime Tech For A React SPA

### 2.1 Live2D (2D, The "VTuber Look")

**The licence is the thing to understand first, and it is better than its reputation.**

Live2D ships two agreements. The Framework/Samples sit under the **Live2D Open Software License Agreement**; the compiled runtime core sits under the **Live2D Proprietary Software License Agreement**, which covers "Live2D Cubism Core and Live2D Cubism MotionSync Core" ([proprietary agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), VERIFIED).

The proprietary agreement's §2.1 is the gate:

> "the Customer may not Publish or Distribute Derivative Work for personal, Internal, Non-commercial, commercial, or any other purposes unless otherwise agreed in writing with Live2D"

…and to publish you "must execute and enter into a separate 'Live2D Publication License Agreement.'" ([ibid](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), VERIFIED)

**But §2.2 exempts you if you are small.** The definitions are explicit:

- **General User (§1.21):** "individuals, students, circles, private organizations…whose…sales from commercial activities for the most recent fiscal year…is **less than 10 million yen**"
- **Small-Scale Enterprise (§1.22):** "enterprises with the Latest Sales of **less than 10 million yen** (including individuals, corporations and other organizations that operate commercial activities)"

Live2D "may exempt such party from entering into 'Live2D Publication License Agreement' and paying the applicable license fee." ([ibid](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), VERIFIED)

¥10,000,000 is roughly USD 65k at ¥150/USD (my arithmetic, not a cited figure). Below that line: free. Above it: you negotiate, and Live2D does **not** publish fees — the SDK licence page routes you to "Contact Us" and lists only plan names (Non-profit Content Plans, One-time Purchase Content Plans, Running Royalty Content Plans, Expandable Applications) ([live2d.com/en/sdk/license](https://www.live2d.com/en/sdk/license/), VERIFIED). The same page states: **"License only required upon releasing your content. Not during trial or development."**

> **Verdict for a prototype:** zero licence cost, zero paperwork, no ambiguity. The threshold only becomes a live question if CatatMD ever becomes a revenue-generating product above ¥10M/yr — at which point it is a commercial negotiation, not a blocker.

**The web runtime options — and the maintenance trap.**

| Package                                                                                        | Version    | Renderer peer         | Size (npm unpacked) | Licence     | Last activity                      | Verdict                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------- | --------------------- | ------------------- | ----------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`pixi-live2d-display`](https://github.com/guansss/pixi-live2d-display)                        | 0.4.0      | `@pixi/*` **^6**      | 1.50 MB             | MIT         | repo pushed **2024-08-20**; 1,489★ | The canonical one, and **two major Pixi versions behind**.                                                             |
| [`pixi-live2d-display-lipsyncpatch`](https://github.com/RaSan147/pixi-live2d-display)          | 0.5.0-ls-8 | `pixi.js` **^7**      | 2.42 MB             | MIT         | repo pushed **2025-06-23**; 192★   | Fork, adds audio lip-sync, Pixi 7.                                                                                     |
| [`untitled-pixi-live2d-engine`](https://github.com/Untitled-Story/untitled-pixi-live2d-engine) | 1.3.5      | `pixi.js` **^8.13.1** | 3.41 MB             | MIT         | current                            | "PixiJS v8 Live2D Engine \| Supports Cubism 2-5 SDK \| Lip-sync & Parallel Motion". The only modern-Pixi option found. |
| [`easy-live2d`](https://github.com/Panzer-Jack/easy-live2d)                                    | 0.4.4      | Pixi v8 (bundled)     | 3.18 MB             | **MPL-2.0** | current                            | Lightweight wrapper; note the copyleft-ish licence.                                                                    |

Sources: [npm registry](https://registry.npmjs.org/pixi-live2d-display/latest) · [npm](https://registry.npmjs.org/pixi-live2d-display-lipsyncpatch/latest) · [npm](https://registry.npmjs.org/untitled-pixi-live2d-engine/latest) · [npm](https://registry.npmjs.org/easy-live2d/latest) · [GitHub API](https://api.github.com/repos/guansss/pixi-live2d-display). VERIFIED (metadata).

**This is the single biggest technical finding.** The library everyone links to (`pixi-live2d-display`, 1.5k★) pins **PixiJS v6** and has not been pushed since August 2024. Adopting it drags a two-major-versions-stale renderer into a Vite build that is otherwise on current React 19. The maintained v8 path exists but has a fraction of the community.

**Expression / state control API — yes, app events can drive it:**

```js
const model = await Live2DModel.from('shizuku.model.json')
app.stage.addChild(model)
model.motion('tap_body') // named motion group
model.on('hit', (areas) => {
  /* … */
}) // hit-testing
```

([pixi-live2d-display docs](https://guansss.github.io/pixi-live2d-display/), VERIFIED). Models carry `.exp3.json` expression files and `.motion3.json` motion groups; individual parameters are settable directly on the core model. Mapping `analyzing → thinking`, `red flag → concerned`, `note approved → happy` is a handful of lines.

### 2.2 VRM (3D, `@pixiv/three-vrm`)

| Fact        | Value                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Package     | `@pixiv/three-vrm` **3.5.5**, **MIT**, 2.50 MB unpacked, peer `three >=0.137` ([npm](https://registry.npmjs.org/@pixiv/three-vrm/latest)) |
| Repo health | **2,102★**, 39 open issues, pushed **2026-08-10**, actively maintained ([GitHub API](https://api.github.com/repos/pixiv/three-vrm))       |
| three.js    | v0.185.1, MIT, 23.2 MB unpacked (tree-shakeable; the shipped bundle is far smaller) ([npm](https://registry.npmjs.org/three/latest))      |
| WebGPU      | v3+ supports `WebGPURenderer` via `MToonNodeMaterial` (three r167+) ([README](https://github.com/pixiv/three-vrm))                        |

**Expression control is a one-liner** — `currentVrm.expressionManager.setValue(expressionName, value)` with value 0–1 ([three-vrm expressions example](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/expressions.html), VERIFIED).

And the **preset expression vocabulary is standardised by the format**, which is a genuine advantage over Live2D (where expression names are whatever the rigger chose):

- **Emotion:** `happy`, `angry`, `sad`, `relaxed`, `surprised`
- **Lip-sync:** `aa`, `ih`, `ou`, `ee`, `oh`
- **Blink:** `blink`, `blinkLeft`, `blinkRight`
- **Gaze:** `lookUp`, `lookDown`, `lookLeft`, `lookRight`
- **Legacy:** `neutral`

([VRM 1.0 expressions spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md), VERIFIED)

**VRM's other advantage: machine-readable licensing baked into the file.** Every VRM carries a meta block whose fields are normative ([VRM 1.0 meta spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md), VERIFIED):

| Field                 | Values that matter                                                     | Default             |
| --------------------- | ---------------------------------------------------------------------- | ------------------- |
| `commercialUsage`     | `personalNonProfit` / `personalProfit` / **`corporation`**             | `personalNonProfit` |
| `avatarPermission`    | `onlyAuthor` / `onlySeparatelyLicensedPerson` / `everyone`             | `onlyAuthor`        |
| `modification`        | `prohibited` / `allowModification` / `allowModificationRedistribution` | `prohibited`        |
| `creditNotation`      | `required` / `unnecessary`                                             | `required`          |
| `allowRedistribution` | boolean                                                                | `false`             |
| `licenseUrl`          | required string                                                        | —                   |

You can literally lint a candidate model for `commercialUsage === "corporation"` before shipping it. **Note the defaults are all restrictive** — an unset VRM is personal-non-profit, author-only, no-modification. Absence of a permissive value is a _no_, not a maybe.

### 2.3 The Rest Of The Field

| Option              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Fit                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rive**            | React runtime `@rive-app/react-canvas` 4.31.0, **MIT**, 43 KB unpacked, React 19 peer ✅ ([npm](https://registry.npmjs.org/@rive-app/react-canvas/latest)). Repo 1,149★, pushed 2026-08-07 ([GitHub API](https://api.github.com/repos/rive-app/rive-react)). **State Machines** map app events to animation states natively via `useStateMachineInput`. Editor pricing: Free $0, Cadet $9/seat/mo, Voyager $32/seat/mo ([rive.app/pricing](https://rive.app/pricing)) — the pricing page indicates shipping to products starts at Cadet. | **Best engineering fit by a distance.** 43 KB vs 1.5–3.4 MB. State machines are exactly the "reactive states" primitive. Cost: you must author the character yourself.                 |
| **Lottie**          | Free, MIT runtimes, tiny files. But it plays _animations_, not _state machines_ — reactive branching means orchestrating clips by hand. INFERRED (no fetch; well-established).                                                                                                                                                                                                                                                                                                                                                           | Fine for a 6-state loop. Weak for interactivity.                                                                                                                                       |
| **Ready Player Me** | **NOT VERIFIED** — `readyplayer.me` and `docs.readyplayer.me` both failed DNS resolution from this environment on 13/08/26. Separately, RPM's house style is stylised-realistic human avatars, not anime — an aesthetic mismatch with the brief. INFERRED.                                                                                                                                                                                                                                                                               | Skip.                                                                                                                                                                                  |
| **Kalidokit**       | MIT, **5,693★**, 713 forks, pushed 2025-08-18 ([GitHub API](https://api.github.com/repos/yeemachine/kalidokit)). Converts MediaPipe face/pose/hand tracking into blendshapes.                                                                                                                                                                                                                                                                                                                                                            | **Actively dangerous here.** It needs a webcam. A camera turned on in a consultation room, in a product whose entire pitch is a hard PHI boundary, is a self-inflicted wound. Hard no. |
| **Inochi2D**        | Free, open-source Live2D alternative. BSD-2-Clause, 1,193★, pushed 2025-06-16 ([GitHub API](https://api.github.com/repos/Inochi2D/inochi-creator)).                                                                                                                                                                                                                                                                                                                                                                                      | **No browser runtime found.** Search surfaced no JS/WASM web runtime (INFERRED — absence of evidence). Rules it out for a web SPA regardless of its licence appeal.                    |

### 2.4 Two Non-Obvious Costs Specific To _This_ Codebase

Both are mine (INFERRED), but both are the kind of thing QA would raise:

1. **A proprietary, non-auditable binary in the frontend of a clinical-safety product.** Live2D Cubism Core ships as a compiled blob under a licence that explicitly forbids reverse engineering ("The Customer may not reverse engineer, decompile, disassemble, or otherwise attempt to discover the Source Code" — [proprietary agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), VERIFIED). The CatatMD SPA renders transcripts and note bodies. Any third-party script on that page sits inside the blast radius of the thing the product is built to protect. The VRM/three.js path is fully MIT and does not have this problem.
2. **Main-thread and GPU contention with browser-side ASR.** CatatMD's differentiator set includes browser-side speech recognition (see `docs/superpowers/research/05-similar-products.md`). A continuous `requestAnimationFrame` WebGL loop next to real-time transcription competes for exactly the resources that make the transcription feel live. Rive at 43 KB and Lottie mitigate this; a 3D scene does not.

---

## 3. Model Sourcing — What You Can Actually Get

### 3.1 The Free Live2D Official Samples (26 Models)

Live2D publishes 26 free sample models ([live2d.com/en/learn/sample](https://www.live2d.com/en/learn/sample/), VERIFIED). Their terms are genuinely permissive **and genuinely constraining**, in different ways.

**What's permitted** ([Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html), VERIFIED):

> §2.1.1 — "The Customer is licensed to install, use the Freeware, and use the Output File irrespective of commercial or Non-commercial purposes."

Each model page restates it plainly: "General User or Small-Scale Enterprise (**annual sales less than 10 million yen**) is free to use the materials…in creative activities for both commercial and non-commercial purposes."

**What it costs you — the three catches:**

1. **A mandatory credit line.** The Terms of Use for Sample Data require, verbatim ([model-terms](https://www.live2d.com/en/learn/sample/model-terms/), VERIFIED):

   > "This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion."

   Short form where space is tight: _"This content uses sample data owned and copyrighted by Live2D Inc."_

   **This is the licensing verdict that matters.** A free sample model can be a _feature_ in CatatMD. It cannot be CatatMD's _mascot_ — it remains Live2D's character, carrying Live2D's copyright notice, in your product's chrome.

2. **Per-character behavioural restrictions**, quoted verbatim from the same terms page (VERIFIED):

   | Character                                                                                                                                     | Restriction                                                                                                                                                                 |
   | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Miara, Hiyori Momose (+ video ver.)                                                                                                           | "No changes of any kind to the design of this character are permitted."                                                                                                     |
   | Shizuku                                                                                                                                       | "Use this character directly without changing the name or settings."                                                                                                        |
   | Nito                                                                                                                                          | "Maintain the body type in which the head is the same size as the body when using this character."                                                                          |
   | Mark-kun (+ video ver.)                                                                                                                       | "When using this character, make use of his cartoon character nature. This character may not be redrawn as a handsome man or converted to a dramatized illustration style." |
   | Wankoromochi                                                                                                                                  | "Respect the mochi theme when using this character."                                                                                                                        |
   | Jin Natori _(collaboration)_                                                                                                                  | "Use of this character which ignores his identity as a butler is not permitted."                                                                                            |
   | Haru, Koharu & Haruto, Tororo & Hijiki, Kei, Niziiro Mao, Ren Foster, Epsilon, Izumi, Chitose, Hibiki, Rice Glassfield, Gantzert & Felixander | **Not listed** — no character-specific restriction                                                                                                                          |

3. **Two models are off-limits commercially.** Jin Natori and Tsumiki Harugasa are _Collaboration Characters_: "You may neither use Collaboration Character and the related data for commercial purposes nor alter nor distribute them." Unity-chan and Hatsune Miku carry third-party terms (Unity Technologies Japan; Crypton Future Media) and are excluded from the blanket permission on every model page. (VERIFIED)

### 3.2 Preview Gallery — Live2D Free Samples

> Selected by written description, stated purpose, and licence cleanliness. **I have not seen any of these.** Every image URL below was fetched and confirmed to return real image bytes on 13/08/26; file size noted. Click through for the full render and the download.

---

**① Haru (Receptionist Version)** — _the strongest fit on paper_

![Haru receptionist version — Live2D sample model](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-haru-greeter.jpg)

Live2D's own front-desk character, described on the page as "Haru-san who is in charge of reception at Live2D Inc.", suitable "for greetings and in a wide range of situations" and explicitly intended for use as a "digital signage receptionist, guide". Ships `.cmo3` + full runtime set (`.moc3`, `.motion3.json`, `.model3.json`, `.physics3.json`, `.cdi3.json`) plus layered PSDs. **No character-specific restriction listed.**
_Source: [live2d.com — Haru (receptionist version)](https://www.live2d.com/en/learn/sample/haru-receptionist/) · image verified, 48.1 KB JPEG · VERIFIED_

**Why it leads:** it is the only free candidate whose _canonical role_ is professional front-of-house rather than streamer. A receptionist reads as clinic staff. A VTuber reads as Twitch.

---

**② Wankoromochi** — _the lowest-risk option in the whole document_

![Wankoromochi — Live2D sample model](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-wanko.png)

A dog character (from the "Wankosoba" app), playful style, supports accessories. Physics + motion. Restriction: "Respect the mochi theme when using this character."
_Source: [live2d.com — Wankoromochi](https://www.live2d.com/en/learn/sample/wankoromochi/) · image verified, 51.4 KB PNG (small crop) · VERIFIED_

**Why it matters:** it is **not a person**. Every credibility objection in §5 and §6 is about anthropomorphism and gendered anime character design. A dog sidesteps essentially all of it while keeping the warmth. This is the Microsoft _Mico_ insight applied to your constraint.

---

**③ Tororo & Hijiki** — _two cats, same logic_

![Tororo and Hijiki — Live2D sample models](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-th.png)

"The white cat is Tororo and the black cat is Hijiki." Motions include front-leg movements — scratching an ear, licking a paw. Physics, pose, motion. **No restriction listed.**
_Source: [live2d.com — Tororo & Hijiki](https://www.live2d.com/en/learn/sample/tororo-hijiki/) · image verified (PNG) · VERIFIED_

---

**④ Koharu & Haruto** — _chibi/SD pair, expression-rich_

![Koharu and Haruto — Live2D SD sample models](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-SD.png)

SD (chibi) proportions — "The girl is Koharu and the boy is Haruto." Ships "expression effects including sparkling eyes, drool, and tears, as well as many movements such as playing a tambourine or waving a flag." Cubism 3.0-era. **No restriction listed.**
_Source: [live2d.com — Koharu & Haruto](https://www.live2d.com/en/learn/sample/koharu-haruto/) · image verified, 68.2 KB PNG, 300×108 (banner crop) · VERIFIED_

**Note:** chibi proportions read as "illustration" rather than "person", which materially lowers the uncanny/credibility risk versus a realistically-proportioned character — and the pair gives you a gender-neutral default.

---

**⑤ Niziiro Mao** — _the modern, expression-heavy one_

![Niziiro Mao — Live2D sample model](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-niziiromao.jpg)

SDK 5.0 / Cubism 5.0. Front-facing, built for VTuber use with "a wide movable range for the face". Explicitly ships `.exp3.json` expression data plus dedicated facial-expression motions separate from general motions. **No restriction listed.**
_Source: [live2d.com — Niziiro Mao](https://www.live2d.com/en/learn/sample/niziiro-mao/) · image verified, 35.9 KB JPEG · VERIFIED_

**Caveat:** "built for VTuber use" is precisely the register §6 argues against for the evaluated build.

---

**⑥ Ren Foster** — _newest, most technically capable_

![Ren Foster — Live2D sample model](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-ren.png)

SDK 5.3 / Cubism 5.3, the newest sample. Ships expression motions (`.exp3.json`). Demonstrates alpha blend masking and offscreen drawing. **No restriction listed.**
_Source: [live2d.com — Ren Foster](https://www.live2d.com/en/learn/sample/ren-foster/) · image URL from the sample index (same verified host path) · VERIFIED (page), image URL INFERRED-by-pattern_

---

**⑦ Hiyori Momose** — _the famous one, and I'd avoid it_

![Hiyori Momose — Live2D sample model](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-hiyori.jpg)

Cubism 3.0, by illustrator Kani Biimu. The canonical Live2D demo model — skinning, clipping masks, physics, pose, collision detection. Also the most _recognisable_: it appears in half the Live2D tutorials on the internet.
_Source: [live2d.com — Hiyori Momose](https://www.live2d.com/en/learn/sample/momose-hiyori/) · image URL from verified index · VERIFIED_

**Two strikes:** (a) "No changes of any kind to the design of this character are permitted" — you cannot even put her in scrubs; (b) anyone who has touched Live2D will recognise her instantly, which reads as _demo asset_, not _product_.

---

### 3.3 Free VRM Sources — And An Honest Disappointment

| Source                                                                 | What's there                                                                                                                                                                                                                                       | Licence mechanics                                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Open Source Avatars](https://www.opensourceavatars.com/)** (ToxSam) | ~300+ VRM avatars; footer states "© 2026 ToxSam. **All avatars CC0**" ([about page](https://www.opensourceavatars.com/en/about), VERIFIED). Data published as JSON at [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars). | CC0 = public domain, commercial use unrestricted. Cleanest licence available anywhere.                   | **Licence: perfect. Art direction: wrong.** The first eight entries in the data file are named _Devil, Polydancer, Rose, Robert, Bloody, Rabbit, Eggplant, Bullidan_ ([avatars.json](https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/avatars.json), VERIFIED). This is an art project ("100 Avatars" R1–R3), not a cute-mascot library. Not a fit. |
| **[VRoid Hub](https://hub.vroid.com/en)** (pixiv)                      | Large library of user VRM models, many free.                                                                                                                                                                                                       | Per-model usage conditions set by the author; the VRM meta fields in §2.2 are the machine-readable form. | **NOT VERIFIED** — pixiv properties returned HTTP 403 to every fetch attempt on 13/08/26. Treat any claim about VRoid Hub's blanket terms as unconfirmed; check `commercialUsage === "corporation"` per model.                                                                                                                                                            |
| **[BOOTH](https://booth.pm/en)** (pixiv)                               | Marketplace with "3D Models" → "3D Characters", "3D Clothing", "3D Hair", "VRoid" categories; heavy VRChat/VRM presence ([booth.pm](https://booth.pm/en), VERIFIED).                                                                               | **Sellers set their own terms.** BOOTH imposes no uniform licence.                                       | Viable _if_ you read each product's Japanese terms individually. High diligence cost. Also: BOOTH/pixiv images are served from `booth.pximg.net` with hotlink protection — they will **not** render if embedded in this document, which is why none are.                                                                                                                  |
| **[nizima](https://nizima.com/)** (Live2D's own marketplace)           | "buy, sell and order original illustrations and Live2D models"; 10% commission, no monthly fee; includes a commission service ([nizima docs](https://docs.nizima.com/en/guide/introduction/), VERIFIED).                                           | **Sellers set terms.** No platform-wide commercial grant found.                                          | The right channel for a _paid_ off-the-shelf Live2D model or a commission, but you must read per-listing terms. Terms: [nizima.com/terms/service](https://nizima.com/terms/service).                                                                                                                                                                                      |
| **itch.io**                                                            | Not fetched.                                                                                                                                                                                                                                       | Per-asset.                                                                                               | **NOT VERIFIED.** No claim made.                                                                                                                                                                                                                                                                                                                                          |

### 3.4 Commission Market — What Custom Costs

From [vtubermodels.com — VTuber Model Commissions](https://vtubermodels.com/vtuber-model-commissions/) (VERIFIED; commercial guide site, treat as market-rate indicative rather than authoritative):

| Deliverable                           | Range                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Live2D model — art + rigging**      | **USD 500 – 2,000+** (packaged tiers seen: $600 basic → $800 premium; $600–850 bust-up to full-body) |
| **Art only (pre-rig)**                | USD 80 – 230                                                                                         |
| **Rigging only**                      | USD 100 – 400 (head-only $100 → full-body $400)                                                      |
| **3D / VRM custom model**             | **USD 1,000 – 5,000+**                                                                               |
| **Chibi / PNGTuber, 2–3 expressions** | USD 25 – 45                                                                                          |
| Top-end professional                  | Reported $5,000–10,000+                                                                              |

Cross-check: another commission studio quotes "Live2D commission pricing can range from **$50 to $3,000 or more**, depending on complexity" (ShiraLive2D, via search snippet — INFERRED, not fetched).

**Read for CatatMD:** a bespoke, medical-themed, SFW Live2D character with 4–6 expressions and clean idle/thinking/alert states is a **USD 600–1,200** commission. That is not a large number. It is also money spent on the one thing an evaluator is least likely to reward.

---

## 4. Free Ways To _Create_ A High-Quality Animated Model

_(Added per the owner's mid-stream question: if there's nothing suitable off the shelf, can you make one for free?)_

| Tool                                                                                         | Cost                                                                                  | Output              | Rigged / animated?                                            | Commercial licence                                                                                                                                       | Grade                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[VRoid Studio](https://store.steampowered.com/app/1486350/VRoid_Studio/)** (pixiv)         | **Free** ("Free to Play" on Steam)                                                    | VRM                 | Yes — humanoid rig, blendshapes, physics come with the format | Steam page: users "set your own terms of use for the data of every model, texture, item, etc you create"; third-party preset items carry their own terms | **The default free answer.** Windows/macOS. VERIFIED                                                                                                   |
| **[VIVERSE Avatar Creator](https://avatar.viverse.com/avatar/creator)** (HTC, pixiv partner) | **Free**, browser-based, no install                                                   | VRM                 | Yes — rig, facial expressions, physics carried in the VRM     | Article does not state licence terms — **check before shipping**                                                                                         | Fastest path from zero to a VRM. Three style tracks incl. anime. ([source](https://news.viverse.com/post/anime-character-creator-full-body), VERIFIED) |
| **[VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender)**            | **Free**, MIT, 1,680★, pushed 2026-08-11                                              | VRM import/export   | Full Blender rigging                                          | MIT add-on; your model is yours                                                                                                                          | For refining a VRoid base into something distinctive. VERIFIED (metadata)                                                                              |
| **Live2D Cubism FREE**                                                                       | **Free** (commercial use permitted for General Users / Small-Scale Enterprises <¥10M) | `.cmo3` / `.moc3`   | Yes                                                           | Same ¥10M rule                                                                                                                                           | **Usable but capped** — see limits below. VERIFIED                                                                                                     |
| **[Meshy](https://www.meshy.ai/pricing)**                                                    | **Free** tier: 100 credits/mo                                                         | FBX, GLB, OBJ, USDZ | Auto-rig for humanoid/quadruped + 600+ motion presets         | **Free tier = CC BY 4.0** (credit Meshy); paid = "you own all assets you create"                                                                         | Text/image → 3D. Free tier is _commercially usable with attribution_. VERIFIED                                                                         |
| **[Rive](https://rive.app/pricing)**                                                         | Free editor tier ($0); shipping to products indicated from Cadet **$9/seat/mo**       | `.riv`              | State machines, not just clips                                | MIT runtimes                                                                                                                                             | Best _engineering_ result, but you are the artist. VERIFIED                                                                                            |
| **Neural4D / Kenerate / VIVERSE-adjacent AI generators**                                     | Various "free" claims                                                                 | VRM/GLB             | Claimed rigged                                                | Claims vary                                                                                                                                              | **NOT VERIFIED** — surfaced only in search snippets. Do not trust a "commercial license included" banner without reading the ToS.                      |

**Cubism FREE's actual limits** ([FREE vs PRO](https://www.live2d.com/en/cubism/comparison/), VERIFIED):

|                         | PRO       | FREE            |
| ----------------------- | --------- | --------------- |
| Texture files per model | Unlimited | **1 (2048 px)** |
| ArtMesh count           | Unlimited | **100**         |
| Motion parameters       | Unlimited | **30**          |
| Blend Shape parameters  | Unlimited | **3**           |
| Parts                   | Unlimited | **30**          |
| Warp Deformer divisions | 100 × 100 | **9 × 9**       |

A simple chibi or animal mascot fits inside 100 ArtMeshes and 30 parameters. A detailed half-body human character does not. If you outgrow FREE, PRO is subscription-only — **Indie tier (revenue <¥10M): $13.04/mo or $89.55 first year**; Business tier (≥¥10M): $60.33/mo or $413.89 first year ([store.live2d.com](https://store.live2d.com/en/), VERIFIED). "Cubism 'for indie' and 'for business' do not differ in functionality."

> **The honest verdict on free creation:** every tool above is genuinely free and genuinely capable. None of them supplies _art direction_. VRoid Studio produces a competent, recognisably-VRoid avatar in an hour; that is a different thing from the polished commissioned model in the owner's mental image. The gap between "free tool output" and "beautiful" is a person with taste spending days, or ~USD 600 spent on someone who already has both.

---

## 5. Precedent — Where This Has Been Tried

### 5.1 The Cautionary Tale: Clippy (1996–2007)

Shipped in Office 97, off by default from Office XP, gone in Office 2007 ([Wikipedia — Office Assistant](https://en.wikipedia.org/wiki/Office_Assistant), VERIFIED).

- _Smithsonian_ called it "one of the worst software design blunders in the annals of computing"; _Time_ listed it among the fifty worst inventions.
- Internally the codename was "TFC" — Steven Sinofsky noted the C stood for "clown".
- Alan Cooper's diagnosis is the useful one: it grew from a "tragic misunderstanding" of Nass & Reeves's Stanford research showing people treat computers as social actors. Microsoft concluded a human-like face would help; instead it became "an annoying interloper distracting the user from the primary conversation."
- Core failure modes: "interrupting users and not providing advice that was fully adapted to the situation."

**The transferable lesson is not "no characters."** It is that a character which _interrupts_ and whose advice is _not situationally adapted_ is worse than no character. Both failure modes are live risks in a consultation-room tool.

### 5.2 The Rehabilitation: Microsoft _Mico_ (October 2025)

Microsoft shipped **Mico** on **23 October 2025** — "an assistant character which acts similarly to Microsoft's old assistant character Clippit", giving Copilot "a personality and identity" ([Wikipedia — Microsoft Copilot](https://en.wikipedia.org/wiki/Microsoft_Copilot), VERIFIED). Secondary coverage (INFERRED, search snippets, not fetched end to end) describes it as "an animated, **non-human** avatar designed primarily for Copilot's voice mode" that "changes appearance to signal listening, thinking, or acknowledgement states", "enabled by default in Copilot's voice mode in early rollouts but **can be disabled in settings**", with a tap-to-Clippy easter egg.

**This is the single most relevant precedent in the document**, because Mico is the owner's exact feature request — a reactive character mapping states to expressions — shipped by a vendor with everything to lose, and its design choices are instructive:

| Mico's choice                            | Why                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Non-human** (a blob)                   | No gender, no age, no cultural register, no uncanny valley                                                 |
| **State-signalling, not conversational** | It communicates _system status_ (listening / thinking), the highest-value, lowest-risk job for a character |
| **Voice mode only**                      | Confined to the context where a focal point helps                                                          |
| **Disable-able in settings**             | The user, not the vendor, decides                                                                          |

### 5.3 Anime Mascots In Serious Products — It Happens, With Caveats

**Microsoft Japan's OS-tan line** ([Wikipedia — OS-tan](https://en.wikipedia.org/wiki/OS-tan), VERIFIED):

- **Nanami Madobe** (Windows 7, 2009) — the first officially endorsed one; bundled into Japanese Windows 7 Ultimate DSP editions, "the first 7777 copies", with themes, 19 event sound sets, voiced by Nana Mizuki.
- **Madobe Sisters** Yū & Ai (Windows 8, 2012) — 8,000 limited DSP units with a branded mouse.
- **Claudia Madobe** — Microsoft **Azure**, featured in the official "Cloud Girl" comic strip.
- **Inori Aizawa** — Internet Explorer.
- **Tōko Madobe** (Windows 10, 2015), named by fan poll. **No official OS-tan for Windows 11.**

**Read carefully:** every one of these was (a) **region-locked to Japan**, (b) **marketing/packaging**, not product UI, and (c) **limited-edition**. Microsoft never put Nanami inside Windows for everyone. The precedent supports "anime mascot as an audience-specific brand gesture", not "anime mascot in the clinical workflow".

**Bilibili** ([Wikipedia](https://en.wikipedia.org/wiki/Bilibili), VERIFIED): anime mascots 22 and 33, community-elected in 2010 (tied at 1,824 votes each, so both were kept), coexisting with ~332.6M MAU, NASDAQ (BILI) and HKEX (9626) listings, Sony holding 5.22%. Anime mascots and a serious business are compatible — **when the business is itself anime-adjacent.**

**Yuru-chara / Japanese institutional mascots** ([Wikipedia — Yuru-chara](https://en.wikipedia.org/wiki/Yuru-chara), VERIFIED): kawaii mascots used by local governments and corporations to promote regions; character merchandise reached ~$16B in Japan in 2012; the Gotōchi-kyara catalogue passed 3,000 entries by Oct 2014; the 2015 Grand Prix drew 1,727 entrants and 50.57M votes. **And the backlash is documented too:** Osaka's government warned in 2014 that mascot proliferation was "diluting brand identity", and Sento-kun's 2008 unveiling drew "negative publicity" as "ugly" and "blasphemous".

**Woebot — the closest clinical analogue** ([Fitzpatrick, Darcy & Vierhile, _JMIR Ment Health_ 2017;4(2):e19](https://pmc.ncbi.nlm.nih.gov/articles/PMC5478797/), VERIFIED):

- RCT, n=70 college-age participants, 2 weeks, Woebot (n=34) vs NIMH ebook control (n=36).
- Result: "Those in the Woebot group significantly reduced their symptoms of depression over the study period as measured by the PHQ-9 while those in the information control group did not" (F=6.03, P=.017, d=0.44).
- **The design choice that matters:** the developers "intentionally chose a _purposefully robotic_ name to emphasize its non-human nature" — and participants anthropomorphised it anyway, calling it "a fun little dude".

**Woebot is the proof that a character can carry clinical weight — by *under*claiming humanity, not overclaiming it.**

**Malaysia:** Malaysia's Ministry of Health has used cartoon/animated characters in public health campaigns, including CG superhero characters for COVID-19 awareness (INFERRED — search snippets referencing infosihat.moh.gov.my and Cartoon Brew; not fetched end to end). Cute characters in Malaysian health communication are not alien. **But note the register difference:** those are _public-facing patient education_, not _clinician-facing documentation tooling_. The two audiences tolerate very different things.

---

## 6. The Credibility Evidence — And The Straight Recommendation

### 6.1 Three Findings That Decide This

**① The systematic review that names your exact domain.**

Luo, S. & Lee, C.S. (2026), _Investigating the Impact of Anthropomorphic Designs on Trust Perception in AI Chatbots: A Systematic Review_, HCI International 2026 Posters, CCIS vol. 3052. PRISMA 2020, **32 empirical studies**, CASA framework, cues categorised as perceptual / linguistic / behavioural / cognitive ([Springer](https://link.springer.com/chapter/10.1007/978-3-032-30836-8_17), VERIFIED).

> "anthropomorphic designs including names or tones may not yield positive effects on trust and may even produce negative effects under certain circumstances"

And specifically: anthropomorphism generally enhances trust in generic contexts (customer service), **but backfires in sectors prioritising professional expertise — healthcare, finance, travel, and misinformation correction.**

This is not a vibe. It is a PRISMA review naming healthcare as a backfire domain.

**② Culture is not a footnote.**

Schimmelpfennig, Díaz, Prabhakaran & Davani (Dec 2025, rev. Feb 2026), _Humanlike AI Design Increases Anthropomorphism but Yields Divergent Outcomes on Engagement and Trust Globally_ — two experiments, **N=3,500**, **ten countries** ([arXiv:2512.17898](https://arxiv.org/abs/2512.17898), VERIFIED):

> humanlike design consistently increased anthropomorphism, but "it did not universally increase trust or engagement. Instead, effects were culturally contingent; design choices fostering engagement or trust in one country may reduce them in another."
>
> "risk is not inherent to humanlike design but emerges from its interplay with cultural context"

For a Malaysian GP audience this means: you cannot import the Japanese yuru-chara result, and you cannot import the Bilibili result. Malaysia has a large, genuinely enthusiastic anime audience _and_ a professional-medical culture and a majority-Muslim modesty norm that a typical VTuber design (short skirt, exposed shoulders, idol styling) would collide with immediately. That collision is not hypothetical and it is not something a toggle fixes once a reviewer has seen it.

**③ Visual design is judged in the first second, and "professional" is the yardstick.**

Stanford Web Credibility Guidelines, from three years of research with **over 4,500 people** under B.J. Fogg at the Persuasive Technology Lab ([credibility.stanford.edu](https://credibility.stanford.edu/guidelines/index.html), VERIFIED):

> **Guideline 6:** "Design your site so it looks professional (**or is appropriate for your purpose**)." — "people quickly evaluate a site by visual design alone."

The parenthetical is the one honest opening for a mascot. But "appropriate for your purpose" cuts against you here: the purpose is a clinician approving a medical note.

### 6.2 The Positioning Conflict — The Argument That Actually Settles It

CatatMD's competitive analysis (`docs/superpowers/research/05-similar-products.md`) concludes that its defensible differentiators are: a de-identification gate before the LLM, deterministic red flags the LLM may only add to, ID-constrained citations, and in-region hosting. Every one of those is a claim of the form **"we are the disciplined, safety-first, verifiable one."**

That is a positioning built entirely on _restraint_. It is the same argument Microsoft makes when Dragon Copilot's Information Assist refuses to answer "Are there any diagnoses I have missed?" — the refusal _is_ the credibility.

A VTuber mascot is the single most expensive possible contradiction of that positioning, because it is the first thing a reviewer sees and the last thing they'd expect from a team whose whole thesis is discipline. It costs you the frame before you have said a word about the de-identification vault.

### 6.3 Recommendation

**Keep it out of the evaluated build. Entirely — not behind a toggle.**

The toggle argument fails for a specific reason: an evaluator reading a repo sees the _code_, the _README_, the _dependency list_ and the _commit history_, not just the running default. A `MascotProvider` in the SPA, a 1.5 MB Live2D runtime in `package.json`, and a `feat: add companion mascot` commit are all visible regardless of whether the toggle is off. If the mascot is in the repo, it is in the review.

Ranked, with the reasoning:

| Option                                                          | Verdict                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Skip for the evaluated build** ✅                          | Costs nothing, risks nothing, contradicts nothing. The engineering hours go into the de-id gate and the red-flag rules engine, which are what the positioning is actually made of.                                                                                                                                                                                   |
| **2. Post-evaluation, as a separate branch / v2 experiment** ✅ | The idea is not bad. It is _badly timed_. Build it when the product's credibility rests on shipped behaviour rather than on first impressions.                                                                                                                                                                                                                       |
| **3. If you cannot resist: the _Mico_ shape** ⚠️                | Non-human (Wankoromochi/Tororo & Hijiki, or a bespoke Rive shape), state-signalling only (idle / listening / thinking / done), **off by default**, never interrupts, never speaks, never appears in the same visual frame as a red-flag alert or an approval action. Safety UI stays sober; the mascot lives in a corner of the _idle_ and _processing_ states only. |
| **4. Anime-girl VTuber in the clinical workflow** ❌            | Directly contradicted by a PRISMA review naming healthcare as a backfire domain, culturally unvalidated for the target market, and in tension with the product's entire differentiator set.                                                                                                                                                                          |

**The one line to hold on to:** a red-flag banner and a winking anime character cannot share a screen. The moment they do, a reviewer stops believing the red flag.

---

## 7. If You Do It Anyway — The Shortlist

Ranked, complete, costed.

**Tech choice — pick one:**

1. **Rive** (`@rive-app/react-canvas` 4.31.0, MIT, **43 KB**, React 19 peer, state machines map 1:1 to app states). Editor free; shipping tier from $9/seat/mo. **You author the character** — which is also how it becomes _yours_ rather than Live2D's.
2. **VRM + `@pixiv/three-vrm`** (3.5.5, MIT, actively maintained, standardised preset expressions, machine-readable licence in the file). Heavier, but fully permissive and auditable.
3. **Live2D via `untitled-pixi-live2d-engine`** (Pixi v8, Cubism 2–5, MIT wrapper). Prettiest ceiling; drags in a proprietary non-auditable core and a mandatory Live2D credit line if you use their samples. **Do not** use `pixi-live2d-display` itself — PixiJS v6, unmaintained since Aug 2024.

**Model candidates — in risk order:**

| #   | Candidate                                                                                   | Cost                                                        | Licence                                                                | Why                                                                                                      |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **Wankoromochi** (dog) — [page](https://www.live2d.com/en/learn/sample/wankoromochi/)       | Free                                                        | Free Material Licence; credit line required; "respect the mochi theme" | Non-human. Dodges every anthropomorphism finding in §6.1.                                                |
| 2   | **Tororo & Hijiki** (cats) — [page](https://www.live2d.com/en/learn/sample/tororo-hijiki/)  | Free                                                        | Free Material Licence; credit line required; no character restriction  | Same logic, two options, expressive paw motions.                                                         |
| 3   | **Haru (receptionist)** — [page](https://www.live2d.com/en/learn/sample/haru-receptionist/) | Free                                                        | Free Material Licence; credit line required; no character restriction  | The only free human candidate whose canonical role is professional front-of-house.                       |
| 4   | **Bespoke commission** (non-human or chibi, medical-neutral, 4–6 states)                    | **USD 600–1,200** via [nizima](https://nizima.com/) or VGen | You negotiate — insist on commercial rights and no credit obligation   | The only route where the character is **CatatMD's IP**, with no Live2D copyright notice in your product. |
| 5   | **VRoid Studio / VIVERSE self-made VRM**                                                    | Free                                                        | Yours (verify VIVERSE's terms)                                         | Zero cost, ~1 day, competent-but-generic result.                                                         |

**The licensing line to remember:** every free Live2D sample requires _"This content uses sample data owned and copyrighted by Live2D Inc."_ to appear in your product. That sentence, sitting in a clinical tool's UI, is itself a small credibility tax — and it is the strongest practical argument for either commissioning your own or using Rive/VRM.

---

## What This Changes

**Nothing in the PRD, the TRD, or the roadmap. No plan item, no issue, no dependency.**

This was a curiosity stream and it resolves cleanly against shipping: the credibility evidence points one way (a 2026 PRISMA review names healthcare as a domain where anthropomorphic design _backfires_), and the product's own positioning — restraint, verifiability, safety-first — is the thing a mascot would spend.

**If the owner wants it anyway, the whole decision is three lines:**

|               | Choice                                                                                                                               | Cost       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Tech**      | Rive (`@rive-app/react-canvas`, MIT, 43 KB, state machines) — or `@pixiv/three-vrm` if you want 3D                                   | $0–9/mo    |
| **Character** | Non-human. Wankoromochi (free, dog) or Tororo & Hijiki (free, cats) to prototype; a **USD 600–1,200** bespoke commission if it ships | $0 → ~$900 |
| **Behaviour** | Off by default · idle + processing states only · never on the same screen as a red flag or an approval action                        | —          |

**And one thing to do regardless of the mascot decision:** _Mico_'s pattern — a small non-character element that visibly signals _listening / thinking / done_ — is a real UX win for a tool that runs ASR and an LLM pipeline with visible latency. That is worth stealing without any character attached to it, and it costs a spinner-with-personality, not a Live2D licence.

---

## Sources

**Licensing (all VERIFIED):** [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) · [Live2D Open Software License Agreement](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html) · [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) · [Terms of Use for Live2D Cubism Sample Data](https://www.live2d.com/en/learn/sample/model-terms/) · [Live2D SDK license plans](https://www.live2d.com/en/sdk/license/) · [Cubism FREE vs PRO](https://www.live2d.com/en/cubism/comparison/) · [Live2D store pricing](https://store.live2d.com/en/) · [VRM 1.0 meta spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md) · [VRM 1.0 expressions spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md) · [vrm.dev](https://vrm.dev/en/)

**Runtimes (VERIFIED metadata):** [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) · [docs](https://guansss.github.io/pixi-live2d-display/) · [lipsync fork](https://github.com/RaSan147/pixi-live2d-display) · [untitled-pixi-live2d-engine](https://github.com/Untitled-Story/untitled-pixi-live2d-engine) · [easy-live2d](https://github.com/Panzer-Jack/easy-live2d) · [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) · [Kalidokit](https://github.com/yeemachine/kalidokit) · [rive-react](https://github.com/rive-app/rive-react) · [Rive pricing](https://rive.app/pricing) · [Inochi2D](https://github.com/Inochi2D/inochi-creator)

**Models & creation tools:** [Live2D free samples index](https://www.live2d.com/en/learn/sample/) · [Open Source Avatars](https://www.opensourceavatars.com/) · [open-source-avatars data](https://github.com/ToxSam/open-source-avatars) · [BOOTH](https://booth.pm/en) · [nizima docs](https://docs.nizima.com/en/guide/introduction/) · [VRoid Studio on Steam](https://store.steampowered.com/app/1486350/VRoid_Studio/) · [VIVERSE avatar creator](https://news.viverse.com/post/anime-character-creator-full-body) · [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender) · [Meshy pricing](https://www.meshy.ai/pricing) · [VTuber commission pricing](https://vtubermodels.com/vtuber-model-commissions/)

**Precedent & evidence:** [Office Assistant](https://en.wikipedia.org/wiki/Office_Assistant) · [Microsoft Copilot / Mico](https://en.wikipedia.org/wiki/Microsoft_Copilot) · [OS-tan](https://en.wikipedia.org/wiki/OS-tan) · [Bilibili](https://en.wikipedia.org/wiki/Bilibili) · [Yuru-chara](https://en.wikipedia.org/wiki/Yuru-chara) · [Woebot RCT, JMIR Ment Health 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5478797/) · [Luo & Lee 2026, anthropomorphism & trust systematic review](https://link.springer.com/chapter/10.1007/978-3-032-30836-8_17) · [Schimmelpfennig et al., arXiv:2512.17898](https://arxiv.org/abs/2512.17898) · [Stanford Web Credibility Guidelines](https://credibility.stanford.edu/guidelines/index.html)

**Could not verify:** Ready Player Me (DNS failure on `readyplayer.me` and `docs.readyplayer.me`, 13/08/26) · VRoid Hub and vroid.com blanket terms (HTTP 403) · itch.io asset licensing (not attempted) · Neural4D / Kenerate commercial-licence claims (search snippets only).
