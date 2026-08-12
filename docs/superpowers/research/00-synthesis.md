# 00 — Research Synthesis

> Written by the orchestrating agent from streams 01–07. Each numbered file carries its own sources and its own "What this changes" section; this file consolidates, ranks, and flags conflicts. Nothing here edits `docs/prd.md` or `docs/trd.md` — every delta below is a **proposal awaiting Gate 1**.

**Streams:** 01 GP workday · 02 GP systems/language/billing · 03 domain study · 04 market fit · 05 similar products · 06 competition patterns · 07 OSS engineering. (08, companion mascot, is a separate exploratory stream outside this synthesis's Gate 1 scope.)

---

## 1. The Headline Answers

### Do Malaysian private GPs write SOAP notes? — No (01, verified)

MMC Guideline 002/2006 mandates chronological, timestamped, signed, contemporaneous entries — it never mentions SOAP. The payer contract (PMCare panel GP T&C) enforces a different schema: condition → treatment → **medications dispensed** → **MC days** → referral. Two of those fields have no home in SOAP, and Malaysian GPs dispense in-house, so the drug list is a first-class artefact. The leading local clinic system (Klinify) won by _not_ restructuring the note.

**Consensus delta (01 + 02):** keep SOAP as the review scaffold — it is what the LLM pipeline and published scribe literature are built on — but add a Malaysian operational block (`diagnosis`, `medicationsDispensed`, `mcDays`, `referral`, `followUp`) or, zero-schema-churn, an "At a glance" strip derived from the Plan. If only one field: **`mcDays`**. State in the PRD that SOAP is a scaffold choice, not a Malaysian norm.

### Is "no EMR write-back" an acceptable MVP boundary? — Yes, but the justification is wrong (02, corroborated by 01)

There is **no rail to write back to**: the Malaysian private-GP CMS market is a fragmented long tail with no published API standard, and the national interoperability layer reaches private hospitals from Jan 2027, not GP clinics. Reframe the non-goal from "MVP scope" to market fact — it becomes the PRD's most defensible boundary. The honest interim is **per-section copy-out** (S/O/A/P + one-line summary), because CMS note fields are small free-text boxes and doctors paste fragments.

### The day itself (01, verified)

Median ~32 patients/day in private clinics; the regulator prices a simple consultation at ≤10 minutes (Schedule 7, revised by P.U.(A) 150/2026). Documentation happens **in-room, during the consult** — pinned there by in-house dispensing, the MC handover, and MMC's contemporaneous-entry rule. Consequences: the review budget is **30–60 seconds**, approval is in-consult (not a draft inbox), and for a 3-minute URTI consult a review-edit-paste loop plausibly _costs_ time versus a handwritten "URTI, T39, PCM QID, MC 2/7" — so position on documentation quality and the safety net, not time saved.

### Scope validation (01, 03)

URTI is the modal Malaysian private-clinic presentation (13.1% of cases, NMCS 2014; respiratory 26.8–37.2% of primary-care problems). The settled clinical scope is the right one and can now be justified with a number instead of "we ran out of time."

---

## 2. Positioning: The Scribe Is Commoditised; The Boundary Is Not (04 + 05 + 07)

Three streams independently converge on the same repositioning:

- **Commoditised:** Malaysian CMS vendors already bundle AI SOAP notes at RM45–179/clinic/month (MedicalMet, Cliniclah, Qmed Scribe — the last MDA-approved, ISO 13485). Heidi Health opened a Singapore SEA HQ on 31 July 2026 with a free tier. "An AI scribe" loses on price and distribution.
- **Table stakes, not differentiators:** doctor-approves-everything, "does not diagnose," audio-not-retained, SOAP templates — every vendor states them (05). Keep them only in their _enforced_ form (state transition + audit event).
- **Genuinely unoccupied:** deterministic red flags no scribe vendor ships (05); an inference-path de-id gate with a request-scoped vault no vendor publishes — competitor "de-identified" claims are training-pipeline controls (05); the leading OSS scribe has no de-id stage at all (07). But the wording must be precise or it reads as parity: _de-identification on the inference path, before every outbound call, at a single egress point that rejects un-gated input_.
- **Already occupied locally — do not claim as novel:** browser-side Malaysian NRIC tokenisation (DocReport, RM499/mo) and Malaysian CPG citation lookup (Qmed AskCPG, MOH-co-developed). Name them and position against them.
- **Lead verifiable differentiator:** all-Singapore residency — but reframed per stream 03: Singapore hosting **is** a PDPA s.129 cross-border transfer of Malaysian data (the whitelist regime is gone), so the claim is "in-region ASEAN + documented s.129 basis + region-portable adapter," not "data residency solved."
- **Why now (04):** P.U.(A) 150/2026 raised the consultation ceiling RM35 → RM80 (first revision in 30+ years, effective 2 Apr 2026) while TPAs hold effective prices down — documentation that justifies the charge acquired commercial value this year. Stronger than any generic AI opener.
- **Buyer/payer split (04):** under Act 586 the clinic owner must be a registered practitioner — buyer and user are the same doctor-owner; ~60% of visits arrive via TPA/corporate panels pricing consultation near RM34. Any pricing anchors on the RM45–179 CMS, not Western per-clinician scribe rates; the credible commercial path is a component/OEM layer, not clinic subscriptions.

---

## 3. The Safety Architecture: Corroborated, With Two Warnings (03, 05, 06)

**Corroboration of TRD §21.1.** No published study names "fabricated pertinent negatives on sparse transcripts" — the anchor finding is a genuine contribution — but four primary sources converge on the mechanism: negation errors are the second-largest hallucination class (30%, 56/191) in primary-care note generation; models fail to abstain on partial context; ambient notes carry more hallucination than dictated ones (the template-completion fingerprint); and Whisper itself fabricates in proportion to non-vocal duration (see warning 2). Stream 03 carries the citations.

**Warning 1 — the schema is a hypothesis, not a mitigation.** The one published study that imposed a template on LLM note generation measured _increased_ major hallucinations. The per-field six-state schema (§19 row 10) must be **tested against free-form output on the same sparse transcripts**, with `NOT_ASSESSED` as the default and cheapest path — no field implicitly required to be filled. Related refinement: scope the verbatim-evidence rule (§21.4) to **assertion state** (`PRESENT`/`DENIED` need a span) rather than concept vocabulary, to avoid the documented over-literal failure mode.

**Warning 2 — ASR is a second fabrication surface the guardrails cannot see.** A hallucinated Whisper span _passes_ the evidence-binding check (the "evidence" exists in the transcript — the transcript is what's wrong). Worse, Whisper's documented default on code-switched audio without an explicit `language` parameter is to **translate rather than transcribe** — fluent, plausible, wrong text upstream of every control (02, 03). Minimum actions: always pass `language`; add silent-translation and ASR hallucination to the TRD threat model; make pasted text the primary demo path.

**"The doctor reviews everything" is a weak safety argument on its own (06).** An active literature shows humans don't reliably catch AI errors. The strong version names the mechanisms review rests on: deterministic rules the model can't suppress, ID-constrained citations, visible provenance. This upgrade costs a paragraph.

**Regulatory posture must be volunteered, not defended (05, 03).** Red flags + cited suggestions sit closest to CDS; under Malaysia's MDA/AMDD that is Class B territory, and Act 737 §2 names software explicitly, hinging on stated intended purpose — no documentation-software carve-out was found. Vendors that approach CDS carry Class IIa/ISO 13485 (Tortus, Corti); Microsoft's scribe _refuses_ "did I miss a diagnosis?" prompts. Write an explicit Intended Purpose statement in Act 737's vocabulary and a "Regulatory Posture" section that concedes the classification question and argues the architecture is the compliance strategy. Cheap adjacent fix (05): frame CAP-2 as **documentation completeness** ("no duration recorded for the cough"), not decision support ("you did not ask about haemoptysis") — the latter is the exact prompt class the most-regulated vendor refuses.

---

## 4. Engineering Verdicts (07, 02)

- **De-identification: keep the hand-rolled regex — as a decision with evidence.** Presidio is Python-only with no MyKad recognizer and documented failure on non-Western names; every JS library is US-centric regex. Three cheap upgrades within the window: NRIC structural validation (DOB + state-code table from the MIT `mykad` package — MyKad has no checksum, so this is the only structural check), detectors reshaped to `pattern + score + context-words` (Presidio's contract, citable), and a Malaysian given-name gazetteer (the only measure that raises name recall without a model).
- **ASR: `whisper-base` (~136 MB), `@huggingface/transformers` v4 directly (not the stale `xenova/whisper-web`), desktop Chromium only, WASM path first-class, never promise real-time.** Honest range: 60 s of audio ≈ 5 s on an M2, 4–5 _minutes_ on an old i3 — a 15-minute consult spans ~90 s to over an hour by hardware. Chunk, stream partials, keep paste as fallback. Named Malay-accuracy roadmap item: `mesolitica/malaysian-whisper-*` (no ONNX yet — cite, don't convert).
- **Guideline corpus: drop NICE.** Its open-content licence expressly excludes AI use (03). Anchor on **MOH NAG 2024** (all-rights-reserved: summarise + link, no verbatim quotes) plus CC-licensed Malaysian papers. Add `sourceLicence` / `verbatimAllowed` to the chunk schema, and keep NAG and the 2024 Malaysian Delphi consensus as **separate attributed chunks** — they disagree at Centor/McIsaac 3, and merging them would let the model cite a manufactured consensus through a _valid_ ID.
- **Traceability (05):** note-to-transcript evidence links are the top-of-market trust feature (Abridge Linked Evidence) and CatatMD lists nothing — yet §21.4's evidence-bound assertion already produces exactly this data. Either surface it in the review UI or scope it out in one sentence; silence reads as oversight.

---

## 5. Demo & Proposal Playbook (06, 02)

- Happy path hard-gated at **90 seconds to first real output** (pre-seeding and stubbing are judge-sanctioned); target **an approved note in under 30 seconds** as the demo's acceptance beat.
- Add a **~60 s guardrail reel**: (1) the actual outbound payload showing PHI never leaves, (2) a red flag surviving a model suppression attempt, (3) a free-text citation failing schema validation. Showing a guardrail catch beats claiming perfection.
- Record the demo, narrate live, keep the recording as fallback. End on limits + a named next step.
- README/proposal: mirror the evaluation criteria in their order; add a requirement → module → test traceability table; report **real eval numbers from the fixture set** (PDQI-9-derived dimensions + omission/commission counts; red-flag recall at zero false-negative tolerance; PHI-egress assertions); state plainly that **no clinician has reviewed the prototype** and substitute published evidence traced to design decisions + a validation protocol + a falsification list.
- Fixtures: rewrite to Malaysian register (Manglish, MC not "sick note", panel patients, dispensed-in-clinic, NRIC, RM) and design them as _gradeable_ encounters with per-case rubrics — one deliberately hard case, one red-flag case.

---

## 6. Conflicts With Recorded Decisions — Flagged, Not Reopened

1. **PDF/print export (decisions.md 2026-08-13: moved into MVP; PRD CAP-5).** Stream 02 argues it has no consumer in a TPA-portal/e-invoicing clinic and creates an unfiled PHI artefact; it recommends demoting it in favour of structured JSON + per-section copy. **This contradicts a recorded decision.** Not silently reversed — a human call at Gate 1. Cheapest reconciliation: keep browser print (already nearly free), add per-section copy, skip dedicated PDF generation work.
2. **Open self-service sign-up.** The research brief states it was **cut**; `docs/decisions.md` (2026-08-13), the PRD Demo Script, and TRD §14/§19 row 4 still record it as **in scope**. Whichever is current, the docs and the decision log disagree with the brief and must be reconciled at Gate 1. If it is cut, §19 row 4 closes for free.
3. **"Slower than writing the note unaided" (PRD, Will Not Tolerate).** Streams 01+02 show that for the modal 3-minute URTI consult the tool plausibly _is_ slower than the handwritten line it replaces. Not a scope reversal — but the PRD's own tolerance line currently sets a bar the product may not clear, and the positioning fix (quality + safety net, not speed) needs to reach that sentence too.

**Explicitly validated, no change:** clinical scope (now with numbers), the PHI boundary, deterministic-first red flags, ID-constrained citations, single-provider Qwen, browser-side ASR as the privacy architecture (as demo path it is a risk — see §3), and no-EMR-write-back (strengthened, with a better justification).

---

## 7. Open Decisions Register — What This Research Settles

| §19 Row                    | Status after research                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3 (verbatim vs summarised) | **Answerable now:** NICE out entirely (licence excludes AI use); NAG summarise+link only; CC-BY sources quotable. Add `sourceLicence`/`verbatimAllowed` to the chunk schema.                          |
| 7 (out-of-scope signal)    | Not directly addressed by any stream; the regulatory framing in §3 mildly favours an explicit `outOfScope` signal (cleaner intended-purpose story) but this remains open.                             |
| 10 (structured schema)     | **Direction supported, with conditions:** proceed, but treat as a hypothesis — test against free-form on sparse transcripts, `NOT_ASSESSED` default, evidence-span rule scoped to `PRESENT`/`DENIED`. |
| 11 (retention/DPIA)        | Untouched — remains open; correctly parked in "what we would do next."                                                                                                                                |
| 13 (Whisper delivery/size) | **Answerable now:** `whisper-base`, HF CDN fetch + browser cache, desktop Chromium, WASM first-class (07).                                                                                            |

---

## What This Changes

The top deltas across all streams, ranked by (value ÷ effort) inside the current window — each is a Gate 1 proposal, not an applied edit:

1. **PRD CAP-1 / schema:** keep SOAP as scaffold; add the Malaysian operational block (minimum `mcDays`) or the "At a glance" strip; state SOAP-as-scaffold explicitly. (01, 02)
2. **Proposal/README positioning:** lead with the inference-path de-id boundary + deterministic red flags + ID-constrained citations, precisely worded; name Qmed/Cliniclah/MedicalMet/Heidi/DocReport/AskCPG; re-tier "doctor approves" and "no diagnosis" as hygiene; add the P.U.(A) 150/2026 "why now." (04, 05)
3. **Add a Regulatory Posture section** (Act 737 intended-purpose statement, AMDD Class B concession, architecture-as-compliance) and reframe residency as "in-region + s.129 basis." Rename CAP-2's framing to documentation completeness. (05, 03)
4. **Corpus:** drop NICE, anchor NAG 2024 + CC-licensed Malaysian sources, add licence metadata, keep disagreeing guidelines as separate attributed chunks. Settles §19 row 3. (03)
5. **TRD threat model:** add ASR silent-translation and Whisper hallucination as a second fabrication surface; always pass `language`; paste is the primary demo path. (02, 03)
6. **§19 row 10 conditions:** schema-vs-free-form eval on sparse transcripts, `NOT_ASSESSED` default, evidence rule scoped to assertion state; surface evidence spans in the review UI as traceability. (03, 05)
7. **De-id upgrades in-window:** NRIC structural validation, context-word scoring, name gazetteer; record "keep regex over Presidio" as an evidenced decision. (07)
8. **Demo script:** 90-second gate, guardrail reel, record-and-narrate, end on limits; sub-30-second approval beat; Malaysian-register gradeable fixtures. (06, 01, 02)
9. **PRD copy fixes:** quantified review target ("reviewed and approved in under 60 seconds"); split English-only into output (fine) vs input (real limitation); position on quality/safety-net, not time saved; state no-GP-has-reviewed-this plainly. (01, 02, 03, 06)
10. **Gate 1 conflicts to rule on:** PDF export demotion vs the recorded decision; sign-up cut-vs-docs discrepancy; the "slower than unaided" tolerance line. (§6 above)
