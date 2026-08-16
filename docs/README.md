<a id="top"></a>

<div align="center">

<img src="../frontend/public/favicon-64.png" width="64" alt="CatatMD" />

# CatatMD

### An Assistant That Turns A GP Consultation Into A **Reviewable** Clinical Note

_Documentation gaps surfaced as prompts to ask · Deterministic red-flag detection · Citations that cannot be fabricated_

<br/>

<p>
  <img src="https://img.shields.io/badge/typescript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/express-5-000000?style=flat-square&logo=express&logoColor=white" alt="Express 5" />
  <img src="https://img.shields.io/badge/prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma 6" />
  <img src="https://img.shields.io/badge/zod-4-3E67B1?style=flat-square&logo=zod&logoColor=white" alt="Zod 4" />
  <img src="https://img.shields.io/badge/tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/postgres-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase Postgres" />
  <img src="https://img.shields.io/badge/runtime-Bun%20%C2%B7%20Node%2024-000000?style=flat-square&logo=bun&logoColor=white" alt="Bun and Node 24" />
</p>

[**Live Demo**](https://catatmd.vercel.app) · [**Requirements**](./prd.md) · [**Technical Reference**](./trd.md) · [**Privacy Assessment**](./dpia.md) · [**Architecture**](#architecture-at-a-glance)

_Catat_ — Malay, "to note down". The product documents; the doctor decides.

</div>

> ### ⚕️ The Doctor Decides
>
> This system does not diagnose and does not replace clinical judgement. Every output is reviewed, edited, and explicitly approved by the clinician, who remains fully responsible for all medical decisions. All consultation data in this repository is **simulated**.

**Clinical scope:** adult consultations in Malaysian private GP clinics, for acute cough, sore throat, and other upper respiratory symptoms — the modal Malaysian private-clinic presentation at **13.1% of cases** (National Medical Care Survey 2014).

---

## ⚡ In Three Numbers

<table>
  <tr>
    <td align="center" width="33%"><strong>5 of 5</strong><br/><sub>runs in which the unguarded pipeline invented clinical negatives on a sparse transcript, the measured finding every guardrail here answers to</sub></td>
    <td align="center" width="33%"><strong>0</strong><br/><sub>red flags the model is able to suppress, because the rules engine runs before it and assembly is a union, never a filter</sub></td>
    <td align="center" width="33%"><strong>1</strong><br/><sub>egress point for text, type-enforced, so an un-gated string is a compile error rather than a code-review question</sub></td>
  </tr>
</table>

<div align="right"><a href="#top">&#8593;</a></div>

---

## 📷 Screenshots

<table>
  <tr>
    <td width="33%"><img src="assets/01-consultation-list.png" alt="Consultation list showing Draft, Awaiting Review and Approved statuses" /><p align="center"><sub>Consultation list. Every consultation carries a status: Draft, Awaiting Review, or Approved.</sub></p></td>
    <td width="33%"><img src="assets/02-review-three-panels.png" alt="Three-panel review with transcript, clinical note and red flags" /><p align="center"><sub>Three-panel review: the transcript, the drafted note, and the red flags side by side.</sub></p></td>
    <td width="33%"><img src="assets/03-red-flag-provenance.png" alt="Red flags each labelled Rule or AI Suggested with the phrase heard" /><p align="center"><sub>Red-flag provenance. Each flag is marked <code>Rule</code> or <code>AI Suggested</code> and quotes the phrase it was heard in.</sub></p></td>
  </tr>
  <tr>
    <td width="33%"><img src="assets/04-completeness-checklist-gap.png" alt="Completeness checklist with assertion states and missing-information prompts" /><p align="center"><sub>Completeness checklist. An explicit state per field, beside what the record does not establish.</sub></p></td>
    <td width="33%"><img src="assets/05-catatai-proposal-card.png" alt="CatatAI proposing a plan edit as a card with Apply and Discard" /><p align="center"><sub>CatatAI proposes an edit as a card the doctor applies or discards. It never signs off.</sub></p></td>
    <td width="33%"><img src="assets/06-approval-gate-confirm.png" alt="Approval confirmation stating the note cannot be edited afterwards" /><p align="center"><sub>The approval gate. An explicit act, stating plainly that the note cannot be edited afterwards.</sub></p></td>
  </tr>
</table>

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🧭 The Problem

A Malaysian private GP sees a **median of 32.3 patients a day**, inside a consultation the regulator prices at **10 minutes or less**. The note is written in the room with the patient still present, because the clinic dispenses the medicine and issues the MC before that patient leaves. The realistic budget for writing it is **30 to 60 seconds**.

Five pressures follow, each measured rather than asserted:

| The Pressure                                             | The Evidence                                                                                                                                             | What It Costs The Clinic                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **The note is written in seconds, about 32 times a day** | Schedule 7 consultation banding; Sivasampu et al., PLOS One 2017                                                                                         | Every extra minute per patient is roughly half an hour of clinic time a day |
| **An incomplete note is the realistic baseline**         | 98.0% of records carried documentation problems: history missing or inadequate in 46.5%, examination in 51.2%, diagnosis in 42.5% (Khoo et al., n=1,753) | Completeness, not speed, is where the record actually fails                 |
| **Nothing systematically checks for danger signs**       | The absence of a control, not a measured failure                                                                                                         | Whether a red flag is caught depends on recall, on the 32nd patient         |
| **Documentation just acquired commercial value**         | The consultation fee ceiling moved to RM80 (P.U.(A) 150/2026) while panels hold the effective price near RM34                                            | Charging toward the ceiling has to be justifiable on the record             |
| **The record is externally audited**                     | PMCare panel GP terms, carrying on-site audit rights on 24 hours' notice                                                                                 | A diagnosis inconsistent with the drugs dispensed is a deduction            |

**About 60% of patients arrive through a TPA or corporate panel, and the note those payers read is not SOAP.** The contractually enforced shape is condition, treatment, itemised medication dispensed, MC days, referral. Two of those fields have no home in SOAP at all, because the Malaysian GP dispenses in-house and issues the MC in the room.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🩺 What CatatMD Does About It

| What The Doctor Gets                                                                                                                                                          | Which Pressure It Answers                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **A structured note from the consultation**, SOAP scaffold plus the operational block the payer actually reads: diagnosis, medication dispensed, MC days, referral, follow-up | The 30 to 60 second budget, and the TPA audit        |
| **Missing documentation surfaced as prompts to ask**, each with a rationale                                                                                                   | The 98% incomplete-record baseline                   |
| **Deterministic red-flag detection** the model can never suppress or downgrade                                                                                                | Nothing systematically checking danger signs         |
| **Clinical suggestions carrying real, inspectable citations**                                                                                                                 | Justifying decisions on a record that gets audited   |
| **A review copilot that answers about the record** and proposes edits as cards it cannot apply itself                                                                         | Reviewing 32 notes a day without moving the decision |
| **Review, edit, and explicit approval** before anything is final                                                                                                              | The doctor stays the author, and stays responsible   |

Every field above is **extraction, not generation**: each carries a verbatim span from the transcript, and anything the consultation never raised resolves to `NOT_ASSESSED` rather than being quietly filled in. Acceptance criteria for each capability live in `docs/prd.md` §9.

**Stated honestly, because a doctor will find out in one clinic session:** for a fast three-minute URTI consult this may well be slower than the handwritten line it replaces. The claim is documentation quality and a safety net that does not depend on memory. It is not a time-saving claim, and no time-saved figure is offered anywhere in this repository.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🧠 How We Tackle It

AI note-taking is already commoditised in this market, bundled into clinic systems at prices no scribe can compete with (Positioning, below, names the incumbents). So this is not positioned as another scribe. What is different is that the safety properties are **architectural rather than promised**, and each is checkable by someone who has no reason to trust us.

| The Promise Every Vendor Makes | What Is Actually Enforced Here                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Patient data is protected"    | De-identification runs on the inference path, per request, at a single egress point that refuses input which has not passed through it |
| "Our AI catches red flags"     | A deterministic rules engine runs **before** the model, and the model is never shown its output, so it has nothing to suppress         |
| "Our citations are reliable"   | The model may only cite guideline IDs from a supplied corpus; a free-text reference fails validation before the doctor ever sees it    |
| "The doctor reviews it"        | Approval is a state transition with an audit event, not a checkbox, and it is terminal                                                 |

<div align="right"><a href="#top">&#8593;</a></div>

---

<a id="architecture-at-a-glance"></a>

## 🏗 Architecture At A Glance

The two diagrams below are the system as it actually runs. The first is what the doctor experiences; the second is what it is built from.

![CatatMD doctor journey, from consultation to approved note. The doctor consults in-room with the patient still present, then starts a consultation from one of four inputs: a bundled fixture, pasted text, an uploaded .txt or .json file, or live audio transcribed on the doctor's device by default and returned as draft speaker-labelled lines the doctor reviews. The transcript is saved as a draft consultation, passed through the de-identification gate, and sent as safe text to the language model, which returns a structured note, documentation gaps, cited suggestions and red-flag candidates only. Real names are restored before anything is saved or shown. Separately, and before the model call, a deterministic rules engine checks red flags against the original transcript and never shows its results to the model, while a deterministic checklist derives documentation gaps from the note's assertion states. Findings are assembled as a union and never filtered. The doctor reviews, edits, acknowledges red flags without removing them, and approves; the approved note is locked and final, exportable as PDF. The hosted transcription adapter is drawn dashed outside the trust boundary, reachable only by per-consultation consent.](assets/user-journey.drawio.png)

Three claims the journey diagram is drawn to make checkable:

- **The model never sees a patient identifier.** The de-identification gate sits between the stored transcript and the only egress point, and the request-scoped vault restores real names only on the way back.
- **The model never sees the rules engine's output**, so it cannot suppress a red flag it was never shown.
- **The model cannot subtract.** Assembly is a union in both directions: deterministic red flags and deterministic gaps stand whether or not the model mentions them (`docs/trd.md` §10, §12).

`approved` is terminal and reachable only through an explicit doctor action. The hosted transcription path is drawn dashed and outside the boundary because it is the one route by which audio can leave the device, entered only by a recorded per-consultation act (`docs/trd.md` §20).

![CatatMD technical stack. Inside the trust boundary: React, TypeScript, Vite and Tailwind on Vercel; Node, Express and Bun on Render, carrying the deid PHI gate, the lib/llm client, and the routes, redflags, guidelines and audit modules; PostgreSQL, Prisma and Supabase. Outside it: the Qwen language model, reachable only through lib/llm, and the hosted ASR provider ILMU, reached only by an API relay under per-consultation consent.](assets/tech-stack.drawio.png)

Two claims the stack diagram is drawn to make checkable:

- **`lib/llm/` is the only text egress**, and everything crossing that line has already passed `deid/`.
- **The hosted ASR adapter is the one other path out of the boundary.** Speech-to-text runs on the device by default, so it opens only when a doctor ticks the per-consultation consent box. The diagram draws it dashed because it sits outside the boundary, and the audio reaches it only as a relay through the API (`docs/trd.md` §20.4).

Bun workspaces · TypeScript · Zod (shared contracts) · Express 5 · Prisma 6 · better-auth · React 19 + Vite 7 + Tailwind 4 · Supabase Postgres · Vitest · Biome. Hosting: frontend to Vercel, backend to Render, database to Supabase, all three in one region by design.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🌐 Live

| Component    | URL                                                      | Host     |
| ------------ | -------------------------------------------------------- | -------- |
| **Frontend** | https://catatmd.vercel.app                               | Vercel   |
| **API**      | https://catatmd-api.onrender.com · health: `/api/health` | Render   |
| **Database** | not publicly reachable — API-only access                 | Supabase |

All three are on free tiers by design. Render free instances spin down when idle and Supabase free projects auto-pause after roughly a week, so an external scheduler pings `/api/health` every 10 minutes to keep both awake — one ping covers both, because the health check runs a query (`docs/trd.md` §17).

<div align="right"><a href="#top">&#8593;</a></div>

---

## 📍 Status

**Both tiers are built and running.**

| Layer          | What Is Built                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend**    | De-identification gate, deterministic red-flag engine, Malaysian guideline corpus, structured-extraction pipeline with its evidence-bound assertion check, gaps engine, authentication, synthetic fixtures |
| **Frontend**   | Consultation list, four-input capture screen, review screen carrying gap, red-flag and suggestion cards, the approval control, on-device audio capture with draft speaker labels                           |
| **Hosted ASR** | Live in production behind a per-consultation consent gate (#154, #155, #190)                                                                                                                               |

`docs/trd.md` tags every section `Built`, `Specified`, or `Open`, and never describes unwritten code as if it exists. Where implementation contradicted the specification, the TRD records which won and why rather than quietly conforming — see §3 (the assertion schema had to split in two), §5 and §7.

**No clinician has reviewed any of it**, and all data is synthetic. See [`prd.md` §12](./prd.md#12-known-limitations).

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🎯 Positioning — Why This Is Not "An AI Scribe"

**The scribe function is already commoditised in Malaysia.**

| Incumbent        | Position                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| **MedicalMet**   | AI SOAP notes bundled inside a **RM45/clinic/month** clinic management system |
| **Cliniclah**    | From **RM179**                                                                |
| **Qmed Asia**    | Ships Qmed Scribe, and already holds **ISO 13485 and MDA approval**           |
| **Heidi Health** | Opened a Singapore SEA HQ on 31 July 2026 with a free tier                    |

The marginal price of AI documentation here is effectively RM0, and Western per-clinician scribe pricing is several times the cost of an entire Malaysian CMS.

So this project does not compete on transcription. It competes on **the boundary** — three properties that are architectural rather than promised:

| Claim                                                 | Why It Is Defensible                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **De-identification on the inference path**           | Every rival claim that could be pinned down is a _training-pipeline_ control. This one is per-request, at a single egress point, before each call |
| **Deterministic red flags the model cannot suppress** | No scribe vendor ships this. Patient safety does not depend on model behaviour                                                                    |
| **ID-constrained citations**                          | Hallucinated medical references are structurally impossible, not statistically unlikely                                                           |

**Table stakes are named as table stakes.** Doctor-approves-everything, "does not diagnose", audio-not-retained, and SOAP templates are stated by every vendor in this market. They are kept here only in their **enforced** form: a state transition with an audit event, not a sentence in a marketing page.

**Ground already occupied locally is named rather than claimed.** Browser-side NRIC tokenisation ships today at DocReport, and Malaysian CPG citation lookup is held by Qmed AskCPG, co-developed with MOH. Full analysis in `docs/prd.md` §5.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 📝 The Note Is Not Just SOAP

**SOAP is a review scaffold, not a Malaysian norm.** No Malaysian regulation mandates it: MMC Guideline 002/2006 requires contemporaneous, chronological, signed entries and never mentions SOAP.

What _is_ enforced is the payer contract: condition → treatment → itemised medication dispensed → MC days → referral. Two of those fields have no home in SOAP at all, because the Malaysian GP dispenses in-house and issues the MC in the room.

The note therefore carries an operational block alongside the four SOAP strings (`docs/trd.md` §3):

| Field                  | Records                                                | When The Transcript Is Silent |
| ---------------------- | ------------------------------------------------------ | ----------------------------- |
| `diagnosis`            | The impression **the doctor stated**, verbatim-bound   | `NOT_ASSESSED`                |
| `medicationsDispensed` | Drugs the doctor named as dispensed, dose where stated | `NOT_ASSESSED`                |
| `mcDays`               | Medical-certificate days the doctor stated             | `NOT_ASSESSED`                |
| `referral`             | Referral the doctor stated                             | `NOT_ASSESSED`                |
| `followUp`             | Follow-up interval the doctor stated                   | `NOT_ASSESSED`                |

**Every one of these is extraction, not generation.** Each carries a verbatim transcript span, and a field nobody raised resolves to `NOT_ASSESSED` rather than being defaulted to absent.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🔐 The PHI Boundary

The central architectural invariant: **no text containing patient identifiers leaves the API.**

The precise claim matters, because "we de-identify" is a word every competitor uses. What is enforced here is narrower and checkable: **de-identification applied on the inference path, before every outbound call, at a single egress point that refuses un-gated input**, with a request-scoped token vault and re-hydration on the way back.

```
transcript ──► deid gate ──► LLMClient ──► provider
   (raw)      tokenises      only egress    (outside
              identifiers      point         boundary)
                  │
                  └──► vault (request-scoped, never persisted)
                            └──► rehydrates model output on return
```

- **Tokenisation is stable within a request** — `[PATIENT_1]`, `[NRIC_1]` — so the model sees one consistent handle per person across the whole transcript.
- **The vault is request-scoped.** It is never a singleton, never attached to a database row, never logged, and is discarded when the handler returns.
- **Audit events record detector _labels_, never values** (`["NRIC","NAME"]`), so the audit trail cannot become a second leak vector (`docs/trd.md` §15).

`LLMClient.generate()` accepts only a `Deidentified` branded string, so passing a plain `string` — an accidental leak — is a compile error, not a code-review question. Two further enforcement points were open gaps in earlier drafts and were **closed on 13/08/26**:

- **Minting is now locked, not a convention.** `markDeidentified` is no longer exported. It lives module-private inside `backend/src/deid/`, so branding a raw string anywhere else is a compile error (`docs/trd.md` §5; decision §19 row 1, closed).
- **`DEID_FAIL_CLOSED` now has runtime effect.** `OpenAICompatibleClient.generate()` re-runs the full detector inventory over the outbound payload immediately before the network call and refuses to send if anything fires (`docs/trd.md` §7; decision §19 row 2, closed).

The two sit at different tiers deliberately. The first stops the convenient bypass at compile time; the second catches the determined one — a `value as Deidentified` cast, which no type system can prevent — at runtime. The guard's exception carries **detector labels only, never matched values**, so the failure path cannot itself become a leak.

What remains honest to say: a deliberate cast still compiles. The claim is that it cannot reach a provider undetected, not that it cannot be written.

Detection is pattern-based and best-effort — see [`prd.md` §12](./prd.md#12-known-limitations).

<details>
<summary><strong>Audio Stays On The Device By Default</strong></summary>

Raw audio cannot be de-identified, only transcribed. A hosted service would therefore carry un-redacted patient audio, and voice itself as a biometric identifier, outside the trust boundary before the gate ever saw it.

**Transcription runs on the doctor's device.** Only the resulting transcript text reaches the API, where it enters the same pipeline as text pasted, uploaded, or picked from a fixture.

The claim stops there, because on modest clinic hardware the on-device path has a real cost. The rule is a default with a gate, not an absolute:

> **On-device is the default and the floor. Hosted is only ever entered by an explicit, recorded, per-consultation act. Failure degrades to paste, never to the cloud.**

**That last clause is the load-bearing one.** Silently switching to hosted transcription because a device is slow would be a privacy control that fails **open** under load, degrading exactly when the doctor is least able to notice. It is written down as rejected rather than left to an implementer's judgement.

The hosted adapter is **built and live**. Its consent gate (`docs/trd.md` §20, §20.4):

| Property         | Behaviour                                                                           |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Scope**        | One recording. Never remembered, never carried to the next patient                  |
| **Placement**    | Always on screen, never highlighted                                                 |
| **Failure copy** | The on-device failure message never mentions it                                     |
| **Effect**       | The provider key is set in production, so a ticked box sends that recording to ILMU |

**A recording returns as timestamped, speaker-labelled draft lines the doctor reviews and applies.** Each Doctor/Patient label is a guess from segment timing and what the sentence says, never from the voices. Any line can be flipped before applying: one review list, no auto-populated transcript (`docs/trd.md` §20.2).

**One request does leave the browser on the on-device path**, and it is named here rather than left to be discovered. The speech model's weights are fetched from a public CDN the first time they are needed, then cached.

| Question                    | Answer                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| **What is it?**             | A download of public model weights, not an upload                                      |
| **What is in it?**          | No audio, no transcript, no identifier. The request happens before any of them exist   |
| **What does the CDN see?**  | The clinic's IP address and which model was asked for. Nothing else                    |
| **Does it cross a border?** | Nothing that data-residency rules attach to, because no patient data is in the request |

**Removing even that request is configuration, not a rebuild.** `VITE_ASR_MODEL_HOST` points the download at a mirror, the path layout matches the CDN's so mirroring is a file copy, and the last third-party request disappears. The runtime itself is already served from our own origin.

Who observes what, and why those two assets are treated differently, is set out in full in `docs/trd.md` §20.

</details>

<details>
<summary><strong>The Provider Is A Swappable Adapter</strong></summary>

All three supported providers speak the OpenAI-compatible protocol and are selected by `LLM_PROVIDER`. This is a deliberate architectural commitment: it is what makes "what happens when data residency requirements change" answerable with a configuration change rather than a rewrite.

| Provider                        | Role                                    | Data Residency                                                      |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| **Qwen** (Alibaba Model Studio) | default — demo and proposal path        | in-region endpoint                                                  |
| Gemini                          | **local dev only, synthetic data only** | free-tier terms permit use for product improvement and human review |
| DeepSeek                        | benchmarking only                       | PRC; raises a further PDPA s.129 cross-border question              |

**Residency, stated accurately.** In-region hosting is **not** "data residency solved". Under the amended PDPA (Act A1719) the whitelist regime is gone, and s.129 now requires an affirmative basis for any transfer of Malaysian data out of Malaysia, which hosting anywhere else _is_.

The claim this project makes is narrower and true: **in-region hosting, a documented s.129 basis, and a region-portable adapter.** This prototype also processes no personal data at all, because every consultation is synthetic (`docs/prd.md` §11).

</details>

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🛡 Guardrails Against Fabrication

The safety argument is not "a doctor reviews everything". Doctors do not reliably catch well-formed AI errors, and the failure this system was built against is exactly that shape.

<details>
<summary><strong>The Finding It Was Built Against</strong></summary>

Measured **13/08/26** against the live production endpoint. Full method and output in `docs/trd.md` §21.1.

| Transcript                         | Result                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One line, "cough 3 days, no fever" | A note **denying** chills, night sweats, **haemoptysis**, chest pain, dyspnoea, sick contacts, allergies and medications. Neither speaker raised any of them. **5 of 5 runs** |
| Richer, multi-turn                 | Fabricated nothing. **3 of 3 runs**                                                                                                                                           |

**The model fabricates in proportion to how _sparse_ the transcript is**, which is precisely the input this product exists to serve.

</details>

<details>
<summary><strong>The Four Controls</strong></summary>

Ranked by what makes them hold rather than by how they are worded (`docs/trd.md` §21.3):

| Control                                                                    | Tier              | How It Fails                                                   |
| -------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| Constrained decoding — assertion-state enum, `z.enum(corpusIds)` citations | 1 — structural    | Loudly, as a decoding or validation error                      |
| Red-flag rules engine, de-identification                                   | 2 — deterministic | Loudly and testably; runs regardless of model output           |
| Evidence-bound assertion — every fact needs a verbatim span                | 3 — post-hoc      | Loudly, at the cost of occasional false downgrades             |
| System-prompt instruction                                                  | 4 — prompt        | **Silently.** No error, no signal — this is how §21.1 happened |

![The CatatMD analyse pipeline. A POST to the analyze route passes an ownership check, then splits: the raw transcript goes to the de-identification gate and, separately, to the deterministic red-flag engine, which runs in-process and never egresses. De-identified text feeds three concurrent LLM operations, clinical_facts, note_and_gaps and suggestions_and_red_flags, which reach the provider only through lib/llm, the single egress point, and it re-scans its own outbound payload before sending. Returning output passes the evidence check, deterministic gap derivation, and a union assembly that adds model output to rule output without ever filtering it, then rehydration, persistence, and an audit event carrying labels and ids but never content.](assets/module-detail.png)

Two properties the diagram is drawn to make checkable:

- **Rule-sourced red flags and derived gaps reach assembly without passing through the model at all**, so a model response has nothing to suppress. The union is computed in the route handler, after the model has already returned.
- **Every arrow leaving the boundary passes through one node**, which re-scans its own payload immediately before it sends.

</details>

<details>
<summary><strong>The Four Invariants</strong></summary>

| Invariant                                  | How It Is Enforced                                                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unknown is never recorded as negative**  | Six explicit states: `PRESENT`, `DENIED`, `CLINICIAN_OBSERVED`, `NOT_ASSESSED`, `UNKNOWN`, `NOT_APPLICABLE`. A fact whose evidence does not match the transcript verbatim is forced to `NOT_ASSESSED` in code                          |
| **Diagnosis is recorded, never generated** | Populated **only by transcription**. It must carry a verbatim span in which the doctor states the impression, and resolves to `NOT_ASSESSED` where they state none. The model is never asked what the diagnosis is (`docs/prd.md` §10) |
| **Red flags cannot be suppressed**         | The rules engine is a pure function over the transcript. It runs before the model, and its results are never shown to the model to "reconcile" against. Assembly is a union, never a filter (`docs/trd.md` §10)                        |
| **Citations cannot be invented**           | The request-time schema narrows `guidelineId` to the live corpus ids, so a citation naming anything else fails validation inside the adapter and never reaches the doctor (`docs/trd.md` §11)                                          |

**The asymmetry on assertion states is deliberate.** A false `NOT_ASSESSED` costs the doctor one dismissed prompt. A false `DENIED` lets a later clinician rule out a diagnosis on a finding nobody ever checked.

**The diagnosis invariant is machine-checkable rather than promised.** The system may not produce a diagnosis the doctor did not say, and no generated prose, whether assessment text, gaps, suggestions or UI copy, states or implies one at all.

</details>

<details>
<summary><strong>The Guideline Corpus</strong></summary>

10–15 chunks, anchored on Malaysian sources, each carrying its own licence posture:

| Source                                                             | Covers                                                       | Licence Posture                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| **MOH National Antimicrobial Guideline (NAG) 4th ed., 2024**       | Modified Centor scoring, acute pharyngitis, acute bronchitis | © MOH, all rights reserved — summarise and link only |
| **Abdullah et al. (2024)**, Malaysian sore-throat Delphi consensus | McIsaac scoring and thresholds                               | CC BY-NC 3.0 — quotable with attribution             |
| **Ooi et al. (2022)**, _Malaysian Family Physician_                | Malaysian URTI epidemiology                                  | CC BY 4.0 — quotable with attribution                |

**NICE is excluded.** Its Open Content Licence expressly does not cover use for artificial-intelligence purposes, in the UK or internationally.

**Disagreeing sources stay separate.** NAG puts the antibiotic threshold at Modified Centor ≥3; the 2024 Delphi consensus puts it at McIsaac ≥4. Merging them would manufacture a consensus that does not exist.

**The ID-constrained citation mechanism cannot catch that**, because the model would be citing a real, valid ID. So one source per chunk: the UI attributes per chunk and never says "the guideline says" over merged sources.

</details>

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🚧 Boundaries

**No EMR write-back — because there is no rail to write back to.** This is a market fact, not MVP triage: the Malaysian private-GP clinic-system market is a fragmented long tail with no published API standard, and the national interoperability layer reaches private **hospitals** from January 2027, not GP clinics. PDF export is the honest interim.

Also deliberately absent (`docs/prd.md` §6):

- **Diagnosis, triage decisions and prescribing.** Safety boundaries, not deferred features
- **Red-flag deletion or silent dismissal.** Flags may be acknowledged, never removed
- **Any edit after approval**, and any autonomous action
- **Any confidence or uncertainty score**
- **Any billing, MC-duration or fee-code output.** The highest-value addition for a real Malaysian GP, left unbuilt because generating it invites rubber-stamping

### Regulatory Posture — Conceded, Not Defended

Red flags plus cited clinical suggestions **constitute clinical decision support**, which under Malaysia's MDA applying ASEAN AMDD rules is Class B territory. No documentation-software carve-out was found, and the market corroborates the read:

| Vendor                       | What They Do About It                            |
| ---------------------------- | ------------------------------------------------ |
| **Microsoft Dragon Copilot** | Hard-codes refusal of clinical-decision prompts  |
| **Heidi**                    | Withholds its Evidence feature in the UK and EU  |
| **Tortus**                   | Carries UKCA Class IIa                           |
| **Qmed Asia**                | Already holds ISO 13485 and MDA approval locally |

The bar is real and it is clearable. The argument is not that this product escapes the question, it is that **the architecture is the compliance strategy**:

- A versioned deterministic trigger list is auditable in a way a prompt is not
- ID-constrained citations make hallucinated references structurally impossible
- The doctor-approval state transition is a documented risk control with an audit event
- The transcription-bound `diagnosis` field is the intended-purpose hinge

The Act 737 intended-purpose statement is written out in `docs/prd.md` §11. This is a prototype, is not placed on the market, and is not for clinical use.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 📂 Repo Layout

The stack itself is summarised under [Architecture At A Glance](#architecture-at-a-glance); the region is configuration rather than architecture.

```
shared/          @shared/types — Zod schemas, built first, imported by both sides
backend/
  src/deid/      PHI detection, tokenisation, re-hydration vault  ← trust boundary
  src/lib/llm/   LLMClient port + provider adapter                ← only egress point
  src/redflags/  deterministic escalation-trigger rules
  src/guidelines/ curated citation corpus
  src/copilot/   CatatAI review copilot, proposal-only tool surface
  src/fixtures/  synthetic consultation transcripts
frontend/        React SPA
prisma/          schema + migrations
evals/           measurements that spend real model calls, kept out of the test suite
docs/            product and workflow docs
```

The load-bearing module rule: **no module outside `backend/src/lib/llm/` may import an LLM provider SDK directly** (`docs/trd.md` §2).

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🚀 Getting Started

```bash
bun install
cp .env.example .env          # fill DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET, QWEN_API_KEY
docker compose up -d          # local Postgres, see "Use the local database" below
bun run prisma:generate
bun run db:migrate
bun run dev                   # shared watch + API :3001 + web :5173
```

Verify: `curl localhost:3001/api/health`

```bash
bun run lint                  # biome
bun run typecheck             # all three workspaces
bun run test                  # vitest
```

### Use The Local Database

**There is only one Supabase project, and the deployed API uses it.** Point `.env` at Supabase and every local click on a control that writes is editing live data. That is not hypothetical: it has already written a test row into the guest demo account, and the matching audit rows cannot be removed because the chain is append-only by design.

`docker-compose.yml` runs Postgres 16 locally on port **5434**, matching the image and credentials CI uses, so a suite that passes here is running against the server version CI will use:

```bash
docker compose up -d
```

```ini
DATABASE_URL="postgresql://catatmd:catatmd@127.0.0.1:5434/catatmd"
DIRECT_URL="postgresql://catatmd:catatmd@127.0.0.1:5434/catatmd"
```

Then `bun run db:migrate` as usual. No `pgbouncer=true`, because there is no pooler in front of it, and both URLs are the same for the same reason.

Port 5434 rather than 5432 because 5432 and 5433 are commonly already bound. Override with `POSTGRES_PORT` if 5434 is taken too.

**Point `.env` back at Supabase only when you specifically mean to.** Reading deployed data is usually fine; writing to it is what caused the problem above.

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `PORT` defaults to `3001`, which is commonly taken (Grafana, other dev servers). Set `PORT` and `BETTER_AUTH_URL` together if you move it — better-auth's URL must match the origin the API actually serves on.
- Migrations run from a developer machine against `DIRECT_URL` (`:5432`); the app itself runs on the pooled `DATABASE_URL` (`:6543`).

<div align="right"><a href="#top">&#8593;</a></div>

---

## 📁 Documentation Map

| Document                                  | Owns                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| This file                                 | The reader-facing narrative — what, how, and why                                           |
| [`prd.md`](./prd.md)                      | Requirements, capabilities, acceptance criteria, scope, limitations                        |
| [`trd.md`](./trd.md)                      | Canonical implementation reference — contracts, schemas, security posture                  |
| [`dpia.md`](./dpia.md)                    | Production data-flow, PDPA engineering assessment, retention, rights, and residual risks   |
| [`superpowers/research/`](./superpowers/) | The research phase behind the positioning and clinical claims, graded by evidence strength |
| [`../AGENTS.md`](../AGENTS.md)            | Contributor and agent working conventions, canonical for every tool                        |

<div align="right"><a href="#top">&#8593;</a></div>

---

## 👥 Team

<table align="center">
  <tr>
    <td align="center" width="260">
      <a href="https://github.com/AlaskanTuna"><img src="https://github.com/AlaskanTuna.png" width="100" alt="AlaskanTuna" /></a><br/>
      <a href="https://github.com/AlaskanTuna"><sub><strong>@AlaskanTuna</strong></sub></a><br/>
      <sub>Review UI, HTTP API, deploy and CI, docs</sub>
    </td>
    <td align="center" width="260">
      <a href="https://github.com/Andersonnn7788"><img src="https://github.com/Andersonnn7788.png" width="100" alt="Andersonnn7788" /></a><br/>
      <a href="https://github.com/Andersonnn7788"><sub><strong>@Andersonnn7788</strong></sub></a><br/>
      <sub>LLM pipeline, red-flag engine, de-identification gate</sub>
    </td>
  </tr>
</table>

Split taken from closed issues rather than asserted, by their `area:` labels:

|                     | Closed | Mostly                                                             |
| ------------------- | ------ | ------------------------------------------------------------------ |
| **@AlaskanTuna**    | 21     | `area:ui` ×10 · `area:api` ×5 · `area:infra` ×4                    |
| **@Andersonnn7788** | 44     | `area:llm` ×7 · `area:redflags` ×7 · `area:deid` ×6 · `area:ui` ×9 |

Both worked across the UI and the API; the tiers below them were not shared.

<div align="right"><a href="#top">&#8593;</a></div>

---

## 🤝 AI Disclosure

**Claude Code and Codex were used throughout development and testing**, under the pipeline in [`../AGENTS.md`](../AGENTS.md). No commit reaches `main` without human authorization.

**Every regulatory and clinical position in this repository was provisioned manually by the two of us.** The PDPA reading, the MDA class assessment, the licence posture on each guideline source, and the scope boundaries were decided by humans and are not model output.

<div align="right"><a href="#top">&#8593;</a></div>

---

## ✍️ Contributing

Conventional Commits, enforced by commitlint: `<type>[scope]: <description>`.

`main` is shared by two developers — `git pull --rebase` before pushing.

<div align="right"><a href="#top">&#8593;</a></div>
