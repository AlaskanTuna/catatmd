# CatatMD

An assistant that turns a GP consultation transcript into a **reviewable** structured clinical note — with documentation gaps surfaced as prompts to ask, deterministic red-flag detection, and clinical suggestions carrying citations that cannot be fabricated.

_Catat_ — Malay, "to note down". The product documents; the doctor decides.

> **The doctor decides.** This system does not diagnose and does not replace clinical judgement. Every output is reviewed, edited, and explicitly approved by the clinician, who remains fully responsible for all medical decisions. All consultation data in this repository is **simulated**.

**Clinical scope:** adult consultations in Malaysian private GP clinics, for acute cough, sore throat, and other upper respiratory symptoms — the modal Malaysian private-clinic presentation at **13.1% of cases** (National Medical Care Survey 2014).

---

## Live

| Component    | URL                                                      | Host                |
| ------------ | -------------------------------------------------------- | ------------------- |
| **Frontend** | https://catatmd.vercel.app                               | Vercel              |
| **API**      | https://catatmd-api.onrender.com · health: `/api/health` | Render, Singapore   |
| **Database** | not publicly reachable — API-only access                 | Supabase, Singapore |

All three are on free tiers by design. Render free instances spin down when idle and Supabase free projects auto-pause after roughly a week, so an external scheduler pings `/api/health` every 10 minutes to keep both awake — one ping covers both, because the health check runs a query (`docs/trd.md` §17).

---

## Status

**The backend is built; the review UI is not.** As of 13/08/26 the de-identification gate, the deterministic red-flag engine, the Malaysian guideline corpus, the structured-extraction pipeline with its evidence-bound assertion check, the gaps engine, authentication and the synthetic fixtures are all implemented and tested. The React review UI remains a Vite scaffold, and the hosted-ASR adapter is specified rather than built.

`docs/trd.md` tags every section `Built`, `Specified`, or `Open`, and never describes unwritten code as if it exists. Where implementation contradicted the specification, the TRD records which won and why rather than quietly conforming — see §3 (the assertion schema had to split in two), §5 and §7.

**No clinician has reviewed any of it**, and all data is synthetic. See Known Limitations.

---

## Positioning — Why This Is Not "An AI Scribe"

**The scribe function is already commoditised in Malaysia.** AI SOAP notes ship bundled inside a **RM45/clinic/month** clinic management system (MedicalMet) and from **RM179** (Cliniclah); Qmed Asia ships Qmed Scribe and already holds **ISO 13485 and MDA approval**; Heidi Health opened a Singapore SEA HQ on 31 July 2026 with a free tier. The marginal price of AI documentation here is effectively RM0, and Western per-clinician scribe pricing is several times the cost of an entire Malaysian CMS.

So this project does not compete on transcription. It competes on **the boundary** — three properties that are architectural rather than promised:

| Claim                                                 | Why It Is Defensible                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **De-identification on the inference path**           | Every rival claim that could be pinned down is a _training-pipeline_ control. This one is per-request, at a single egress point, before each call |
| **Deterministic red flags the model cannot suppress** | No scribe vendor ships this. Patient safety does not depend on model behaviour                                                                    |
| **ID-constrained citations**                          | Hallucinated medical references are structurally impossible, not statistically unlikely                                                           |

Table stakes are named as table stakes: doctor-approves-everything, "does not diagnose", audio-not-retained, and SOAP templates are stated by every vendor in this market. They are kept here only in their **enforced** form — a state transition with an audit event, not a sentence in a marketing page. Ground already occupied locally is named rather than claimed: browser-side NRIC tokenisation ships today at DocReport, and Malaysian CPG citation lookup is held by Qmed AskCPG, co-developed with MOH. Full analysis in `docs/prd.md` §5.

---

## What It Does

| Capability                            | Approach                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Structured clinical note**          | SOAP scaffold **plus** a Malaysian operational block, schema-validated — every field extraction, not generation |
| **Missing documentation**             | What the record does not establish, surfaced as prompts to ask, each with a rationale                           |
| **Red flags & escalation triggers**   | **Deterministic rules engine first**; the model may only add candidates, never suppress a rule hit              |
| **Clinical suggestions with sources** | The model cites **guideline IDs** from a curated corpus; free-text references fail schema validation            |
| **Review & approve**                  | `approved` is reachable only through an explicit doctor action, and is terminal                                 |

Acceptance criteria for each live in `docs/prd.md` §9.

![CatatMD doctor journey, from consultation to approved note. The doctor consults in-room with the patient still present, then starts a consultation from one of four inputs: a bundled fixture, pasted text, an uploaded .txt or .json file, or live audio transcribed on the doctor's device by default. The transcript is saved as a draft consultation, passed through the de-identification gate, and sent as safe text to the language model, which returns a structured note, documentation gaps, cited suggestions and red-flag candidates only. Real names are restored before anything is saved or shown. Separately, and before the model call, a deterministic rules engine checks red flags against the original transcript and never shows its results to the model, while a deterministic checklist derives documentation gaps from the note's assertion states. Findings are assembled as a union and never filtered. The doctor reviews, edits, acknowledges red flags without removing them, and approves; the approved note is locked and final, copyable and exportable as PDF. The hosted transcription adapter is drawn dashed outside the trust boundary: it is reachable only by per-consultation consent, and is specified rather than built.](assets/user-journey.drawio.png)

Three claims the diagram is drawn to make checkable:

- **The model never sees a patient identifier.** The de-identification gate sits between the stored transcript and the only egress point, and the request-scoped vault restores real names only on the way back.
- **The model never sees the rules engine's output**, so it cannot suppress a red flag it was never shown.
- **The model cannot subtract.** Assembly is a union in both directions: deterministic red flags and deterministic gaps stand whether or not the model mentions them (`docs/trd.md` §10, §12).

`approved` is terminal and reachable only through an explicit doctor action. The hosted transcription path is drawn dashed and outside the boundary because it is the one route by which audio can leave the device, entered only by a recorded per-consultation act (`docs/trd.md` §20).

### The Note Is Not Just SOAP

**SOAP is a review scaffold, not a Malaysian norm.** No Malaysian regulation mandates it — MMC Guideline 002/2006 requires contemporaneous, chronological, signed entries and never mentions SOAP. What _is_ enforced is the payer contract: condition → treatment → itemised medication dispensed → MC days → referral. Two of those fields have no home in SOAP at all, because the Malaysian GP dispenses in-house and issues the MC in the room.

The note therefore carries an operational block alongside the four SOAP strings (`docs/trd.md` §3):

| Field                  | Records                                                | When The Transcript Is Silent |
| ---------------------- | ------------------------------------------------------ | ----------------------------- |
| `diagnosis`            | The impression **the doctor stated**, verbatim-bound   | `NOT_ASSESSED`                |
| `medicationsDispensed` | Drugs the doctor named as dispensed, dose where stated | `NOT_ASSESSED`                |
| `mcDays`               | Medical-certificate days the doctor stated             | `NOT_ASSESSED`                |
| `referral`             | Referral the doctor stated                             | `NOT_ASSESSED`                |
| `followUp`             | Follow-up interval the doctor stated                   | `NOT_ASSESSED`                |

**Every one of these is extraction, not generation.** Each carries a verbatim transcript span, and a field nobody raised resolves to `NOT_ASSESSED` rather than being defaulted to absent.

---

## The PHI Boundary

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

Detection is pattern-based and best-effort — see Known Limitations.

### Audio Stays On The Device By Default

Raw audio cannot be de-identified, only transcribed — so a hosted transcription service would carry un-redacted patient audio, and voice itself as a biometric identifier, outside the trust boundary before the gate ever saw it. **Transcription therefore runs on the doctor's device**, and only the resulting transcript text reaches the API, where it enters the same pipeline as text pasted, uploaded, or picked from a fixture.

The claim stops there rather than going one word further, because on modest clinic hardware the on-device path has a real cost. The rule is a default with a gate, not an absolute:

> **On-device is the default and the floor. Hosted is only ever entered by an explicit, recorded, per-consultation act. Failure degrades to paste, never to the cloud.**

That last clause is the load-bearing one. Silently switching to hosted transcription because a device is slow would be a privacy control that fails **open** under load — degrading exactly when the doctor is least able to notice — so it is written down as rejected rather than left to an implementer's judgement. The hosted adapter is specified and audited but **not built**. See `docs/trd.md` §20.

### The Provider Is A Swappable Adapter

All three supported providers speak the OpenAI-compatible protocol and are selected by `LLM_PROVIDER`. This is a deliberate architectural commitment: it is what makes "what happens when data residency requirements change" answerable with a configuration change rather than a rewrite.

| Provider                        | Role                                    | Data Residency                                                      |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| **Qwen** (Alibaba Model Studio) | default — demo and proposal path        | Singapore endpoint                                                  |
| Gemini                          | **local dev only, synthetic data only** | free-tier terms permit use for product improvement and human review |
| DeepSeek                        | benchmarking only                       | PRC; raises a further PDPA s.129 cross-border question              |

**Residency, stated accurately.** Hosting in Singapore is **not** "data residency solved" — under the amended PDPA (Act A1719) the whitelist regime is gone, and s.129 now requires an affirmative basis for any cross-border transfer, which Singapore hosting of Malaysian data _is_. The claim this project makes is narrower and true: **in-region ASEAN hosting, a documented s.129 basis, and a region-portable adapter.** This prototype also processes no personal data at all — every consultation is synthetic. `docs/prd.md` §11.

---

## Guardrails Against Fabrication

The safety argument is not "a doctor reviews everything". Doctors do not reliably catch well-formed AI errors, and the failure this system was built against is exactly that shape.

**The finding it was built against, measured on 13/08/26** against the live Singapore endpoint: given a one-line transcript ("cough 3 days, no fever"), the default implementation produced a note denying chills, night sweats, **haemoptysis**, chest pain, dyspnoea, sick contacts, allergies and medications — none of which either speaker had raised — in **5 of 5 runs**. On a richer transcript it fabricated nothing in 3 of 3 runs. The model fabricates in proportion to how _sparse_ the transcript is, which is precisely the input this product exists to serve. Full method and output in `docs/trd.md` §21.1.

Four controls follow from it, ranked by what makes them hold rather than by how they are worded (`docs/trd.md` §21.3):

| Control                                                                    | Tier              | How It Fails                                                   |
| -------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| Constrained decoding — assertion-state enum, `z.enum(corpusIds)` citations | 1 — structural    | Loudly, as a decoding or validation error                      |
| Red-flag rules engine, de-identification                                   | 2 — deterministic | Loudly and testably; runs regardless of model output           |
| Evidence-bound assertion — every fact needs a verbatim span                | 3 — post-hoc      | Loudly, at the cost of occasional false downgrades             |
| System-prompt instruction                                                  | 4 — prompt        | **Silently.** No error, no signal — this is how §21.1 happened |

**Unknown is never recorded as negative.** Every clinical fact resolves to one of six explicit states — `PRESENT`, `DENIED`, `CLINICIAN_OBSERVED`, `NOT_ASSESSED`, `UNKNOWN`, `NOT_APPLICABLE` — and a fact whose evidence does not match the transcript verbatim is forced to `NOT_ASSESSED` in code. The asymmetry is deliberate: a false `NOT_ASSESSED` costs the doctor one dismissed prompt, while a false `DENIED` lets a later clinician rule out a diagnosis on a finding nobody ever checked.

**Diagnosis is recorded, never generated.** The `diagnosis` field exists because the payer-enforced record requires one, and it is populated **only by transcription**: it must carry a verbatim span in which the doctor states the impression, and resolves to `NOT_ASSESSED` where they state none. The model is never asked what the diagnosis is. The invariant is machine-checkable rather than a promise — **the system may not produce a diagnosis the doctor did not say** — and no generated prose (assessment text, gaps, suggestions, UI copy) states or implies a diagnosis at all. `docs/prd.md` §10.

**Red flags cannot be suppressed.** The rules engine is a pure function over the transcript; it runs before the model, and the model is never shown its results to "reconcile" against. Assembly is a union, never a filter (`docs/trd.md` §10).

**Citations cannot be invented.** The request-time schema narrows `guidelineId` to the live corpus ids, so a citation naming anything else fails validation inside the adapter and the suggestion never reaches the doctor (`docs/trd.md` §11).

### The Guideline Corpus

10–15 chunks, anchored on Malaysian sources, each carrying its own licence posture:

| Source                                                             | Covers                                                       | Licence Posture                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| **MOH National Antimicrobial Guideline (NAG) 4th ed., 2024**       | Modified Centor scoring, acute pharyngitis, acute bronchitis | © MOH, all rights reserved — summarise and link only |
| **Abdullah et al. (2024)**, Malaysian sore-throat Delphi consensus | McIsaac scoring and thresholds                               | CC BY-NC 3.0 — quotable with attribution             |
| **Ooi et al. (2022)**, _Malaysian Family Physician_                | Malaysian URTI epidemiology                                  | CC BY 4.0 — quotable with attribution                |

**NICE is excluded.** Its Open Content Licence expressly does not cover use for artificial-intelligence purposes, in the UK or internationally.

**Disagreeing sources stay separate.** NAG puts the antibiotic threshold at Modified Centor ≥3; the 2024 Delphi consensus puts it at McIsaac ≥4. Merging them would manufacture a consensus that does not exist — and the ID-constrained citation mechanism **cannot catch that**, because the model would be citing a real, valid ID. One source per chunk; the UI attributes per chunk and never says "the guideline says" over merged sources.

---

## Boundaries

**No EMR write-back — because there is no rail to write back to.** This is a market fact, not MVP triage: the Malaysian private-GP clinic-system market is a fragmented long tail with no published API standard, and the national interoperability layer reaches private **hospitals** from January 2027, not GP clinics. Copy-out is the honest interim.

Also deliberately absent: diagnosis, triage decisions and prescribing (safety boundaries, not deferred features); red-flag deletion or silent dismissal (flags may be acknowledged, never removed); any edit after approval; any autonomous action; any confidence or uncertainty score; and any billing, MC-duration or fee-code output — the highest-value addition for a real Malaysian GP, and left unbuilt because generating it invites rubber-stamping. `docs/prd.md` §6.

### Regulatory Posture — Conceded, Not Defended

Red flags plus cited clinical suggestions **constitute clinical decision support**, which under Malaysia's MDA applying ASEAN AMDD rules is Class B territory. No documentation-software carve-out was found, and the market corroborates the read: Microsoft's Dragon Copilot hard-codes refusal of clinical-decision prompts, Heidi withholds its Evidence feature in the UK and EU, Tortus carries UKCA Class IIa, and Qmed Asia already holds ISO 13485 and MDA approval locally. The bar is real and it is clearable.

The argument is not that this product escapes the question — it is that **the architecture is the compliance strategy**: a versioned deterministic trigger list is auditable in a way a prompt is not, ID-constrained citations make hallucinated references structurally impossible, the doctor-approval state transition is a documented risk control with an audit event, and the transcription-bound `diagnosis` field is the intended-purpose hinge. The Act 737 intended-purpose statement is written out in `docs/prd.md` §11. This is a prototype, is not placed on the market, and is not for clinical use.

---

## Known Limitations

Stated plainly, because an evaluator learns more from these than from the feature list.

**Clinical and evidential**

- **No clinician has reviewed this prototype, and no Malaysian GP was interviewed.** The red-flag triggers, the corpus, and every clinical statement here are drawn from published, cited sources — none of it is clinically signed off.
- **There is no published measurement of Malaysian GP documentation burden.** Every AI-scribe ROI figure in circulation is US/AU/UK. None is borrowed here.
- **This may be slower than writing the note unaided.** For the modal 3-minute URTI consult, a review-edit-paste loop plausibly costs more time than the handwritten line it replaces. The product is positioned on documentation quality and the safety net — never on time saved.
- **The structured schema is a hypothesis, not a proven mitigation.** The one published study that imposed a template on LLM note generation measured _increased_ major hallucinations. The six-state assertion model must be tested against free-form output on the same sparse transcripts, not assumed (`docs/trd.md` §19 row 16).
- Narrow clinical scope, a small corpus (10–15 chunks), and synthetic data only — no real-world validation of note quality, gap relevance, or suggestion accuracy.

**Technical**

- **Speech recognition is a second fabrication surface the guardrails cannot see.** A hallucinated ASR span **passes** the evidence-binding check, because the evidence genuinely is in the transcript — the transcript is what is wrong. Every control in this system sits downstream of the transcript. Published measurement puts fabricated phrases at roughly 1% of transcriptions, with about 40% of those judged capable of harm.
- **Declaring the wrong language produces fluent nonsense, not an error.** Measured on Malaysian audio (`docs/trd.md` §20.1): told the speech was Malay when it was Manglish, the model emitted a grammatical repetition loop — 238 words for 50 seconds of audio. Confident, well-formed, entirely fabricated. The language parameter is therefore fixed at English and never taken from a locale setting or a patient's recorded language. (An earlier claim here, that the model silently _translates_ code-switched audio, did not reproduce under measurement and has been withdrawn.)
- **The smallest practical model is not usable in this market.** Measured (`docs/trd.md` §20.1): it rendered "auntie" as "until" and dropped "pasar malam" entirely — a meaning change in well-formed English that no downstream control can flag. The larger model recovers it, at ~240 MB of first-use download and roughly double the compute. That measurement rests on a single 50-second non-clinical clip with no ground-truth transcript: enough to settle a model choice, not a benchmark, and never presented as one.
- **Audio is withheld on low-end hardware rather than merely discouraged.** The model plus runtime plus browser, on a 4 GB machine already running the clinic's own system, is a plausible out-of-memory kill — a dead tab mid-consultation, from which a half-transcribed consultation is not recoverable. A zero-network capability check decides whether to offer audio at all, and the real verdict is measured on the first transcribed chunk.
- **Consent quality is the weak point in the hosted-audio design, and it is unresolved.** The doctor on weak hardware is exactly the one offered the hosted path, at the moment of most friction — which is how meaningful consent degrades into clicking past an obstacle. Handled by keeping the hosted option findable but never funnelled; the wording and affordance are open (`docs/trd.md` §19 row 18).
- **Input language is the real limitation**, not output. Malaysian clinical records run in English regardless of what is spoken in the room, but consultations code-switch between Malay, Manglish and dialect, and no quantified code-switching rate for Malaysian GP consultations exists in the literature.
- **De-identification recall is best-effort.** Detectors are pattern-based and may miss an identifier, particularly an unmarked name — and an ML NER would miss it too, disproportionately for Malay names. This is why raw transcripts are still treated as sensitive at rest.
- **No retention, deletion, or access-request path**, and no DPIA. Both are prerequisites before any real patient data, not features.
- **No note-to-transcript traceability in the UI.** Evidence spans exist in the data but are not yet surfaced for the doctor to click through. Scoped out for this iteration, not overlooked (`docs/trd.md` §19 row 17).
- **LLM output is non-deterministic**, and alert-fatigue risk is unmeasured.

Fuller treatment in `docs/prd.md` §12; every unresolved engineering question is enumerated in `docs/trd.md` §19.

---

## Stack

Bun workspaces · TypeScript · Zod (shared contracts) · Express 5 · Prisma 6 · better-auth · React 19 + Vite 7 + Tailwind 4 · Supabase Postgres · Vitest · Biome

Hosting: frontend → Vercel · backend → Render (Singapore) · database → Supabase (Singapore). All three in-region by design.

![CatatMD technical stack. Inside the trust boundary: React, TypeScript, Vite and Tailwind on Vercel; Node, Express and Bun on Render Singapore, carrying the deid PHI gate, the lib/llm client, and the routes, redflags, guidelines and audit modules; PostgreSQL, Prisma and Supabase in Singapore. Outside it: the Qwen language model, reachable only through lib/llm, and the specified-but-unbuilt hosted ASR adapter.](assets/tech-stack.drawio.png)

Two claims the diagram is drawn to make checkable. `lib/llm/` is the **only** text egress, and everything crossing that line has already passed `deid/`. Speech-to-text runs on the device, so the hosted ASR adapter is the one other path out of the boundary, which is why it is drawn dashed and labelled specified, not built.

```
shared/          @shared/types — Zod schemas, built first, imported by both sides
backend/
  src/deid/      PHI detection, tokenisation, re-hydration vault  ← trust boundary
  src/lib/llm/   LLMClient port + provider adapter                ← only egress point
  src/redflags/  deterministic escalation-trigger rules
  src/guidelines/ curated citation corpus
  src/fixtures/  synthetic consultation transcripts
frontend/        React SPA
prisma/          schema + migrations
docs/            product and workflow docs
```

The load-bearing module rule: **no module outside `backend/src/lib/llm/` may import an LLM provider SDK directly** (`docs/trd.md` §2).

---

## Getting Started

```bash
bun install
cp .env.example .env          # fill DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET, QWEN_API_KEY
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

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `PORT` defaults to `3001`, which is commonly taken (Grafana, other dev servers). Set `PORT` and `BETTER_AUTH_URL` together if you move it — better-auth's URL must match the origin the API actually serves on.
- Migrations run from a developer machine against `DIRECT_URL` (`:5432`); the app itself runs on the pooled `DATABASE_URL` (`:6543`).

---

## Documentation Map

| Document                                  | Owns                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| This file                                 | The reader-facing narrative — what, how, and why                                           |
| [`prd.md`](./prd.md)                      | Requirements, capabilities, acceptance criteria, scope, limitations                        |
| [`trd.md`](./trd.md)                      | Canonical implementation reference — contracts, schemas, security posture                  |
| [`superpowers/research/`](./superpowers/) | The research phase behind the positioning and clinical claims, graded by evidence strength |

---

## Contributing

Conventional Commits, enforced by commitlint: `<type>[scope]: <description>`.

`main` is shared by two developers — `git pull --rebase` before pushing.
