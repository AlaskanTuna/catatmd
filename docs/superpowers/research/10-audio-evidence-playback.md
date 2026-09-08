# 10 Audio Evidence And Transcript Playback

> Research behind the question "can a doctor click a transcript sentence and hear the audio that produced it, and is that worth building?" Gathered 08/09/26. Sources are linked inline and graded for strength. Read this before designing anything that retains, plays back, or links consultation audio.

**This file is orientation, not legal advice.** It summarises published guidance so an agent does not rediscover it. It deliberately **does not set a retention period** and must not be cited to justify one: that decision stays open and belongs to the clinic data controller (`docs/dpia.md`, "Open Retention Decision").

---

## 1. The Headline Answers

### Is The Feature Worth Building? Yes

Abridge ships exactly this, calls it **Linked Evidence**, and markets it as its central trust feature: highlight a line in the note, see the transcript passage behind it, play the original audio. It is proven product design at the top of this market, not a speculative idea.

### What Is The Real Argument For It? Silent ASR Fabrication

A mis-transcription that reads fluently cannot be caught by reading the transcript. Only the audio can settle it. This is the whole case, and it is stronger for this product than for a typical US-English scribe (section 3).

### Should The Audio Be Stored? A Bounded Window, Never Indefinitely

Every serious vendor persists for a bounded window and states the recording is **not** part of the medical record. Liability guidance argues for zero. The policy literature lands on "until the clinician has validated the transcript". See sections 4 to 6.

---

## 2. Evidence Grades Used Below

| Grade        | Meaning                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Strong**   | Primary source: an official guideline, a regulator, a peer-reviewed paper, or a vendor's own operational documentation |
| **Moderate** | Reputable secondary source: law firm analysis, insurer guidance, established trade press                               |
| **Weak**     | Single secondary source, vendor marketing, or a figure reported without a traceable citation                           |

---

## 3. Why Verification Matters More Here Than Elsewhere

| Finding                                | Detail                                                                                                                                                                                                                                                                         | Grade         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| **Whisper fabricates whole phrases**   | The "Careless Whisper" study found roughly 1% of segments contained invented content, and 40% of hallucinations were judged potentially harmful. Examples included invented medications. The same hallucinations did not appear in Google, Amazon, AssemblyAI or RevAI models. | Strong        |
| **A fabrication is invisible in text** | Invented sentences read fluently, so nobody flags them. In a clinical note a plausible fabrication is more dangerous than an obvious error.                                                                                                                                    | Strong        |
| **Code-switching is the worst case**   | Singapore's MediVoice deployment reported quality declining outside English, Mandarin and Malay. Our fixtures are code-switched Malay and English ("saya demam since 3 days ago, sakit tekak"), which is exactly where word error rate is highest.                             | Strong        |
| **Red flags read the transcript**      | `backend/src/redflags/` evaluates rules over raw transcript text before the LLM runs. A mis-transcription can therefore change a deterministic safety output, not only prose.                                                                                                  | Strong (repo) |

---

## 4. What The Market Actually Does

| Vendor                    | Audio Retention                                                   | Record Status                                                                         |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Abridge**               | Audio and transcripts auto-deleted after 30 days                  | "Only the final clinician-approved note becomes part of the patient's medical record" |
| **Nuance DAX**            | Audio, transcript and note summary retained 30 days, then deleted | Not stated in sources reviewed                                                        |
| **Nabla**                 | "No audio stored by default", configurable 14 days                | Not stated in sources reviewed                                                        |
| **MediVoice (Singapore)** | Not disclosed in the published paper                              | Workflow is review, edit, transfer text to the record. No playback feature described  |

**Two things to take from this table.** First, nobody keeps audio indefinitely, and nobody in the reviewed set uses a purely ephemeral model, because note review is often not synchronous with capture. Second, the vendors that persist all draw the same line: the recording is a working artefact, and only the approved note is the record.

---

## 5. The Case Against Retention

Medical liability guidance is the strongest voice here, and it is unambiguous.

- **ProAssurance (liability insurer, Moderate):** "there is scant justification for retaining these audio logs once the AI-assisted note has been accurately added to the electronic medical record."
- **Discoverability:** a retained recording "will undoubtedly be discoverable in litigation", and a note-versus-audio inconsistency could "undermine the accuracy and reliability of the entire medical record".
- **It cuts both ways (Moderate):** legal commentary notes audio can also corroborate that a clinician addressed every concern raised. The net position most authors reach is that a permanent audio footprint grows discoverable material without reliably improving the clinician's position.
- **Auditability is the real test (Moderate):** "a retention promise that cannot be audited is not a control." A stated window with no mechanism enforcing it is worse than no claim.

---

## 6. The Case For A Bounded Window

The 2026 Frontiers Digital Health policy paper is the most directly relevant source, and it names precisely the window a verification feature needs.

- "Prompt audio deletion minimizes privacy risk, but immediate deletion also forecloses later verification of transcript accuracy."
- Its recommendation: "a short, access-controlled audio-retention window, for instance **until the clinician has validated the transcript**, or a fixed brief period reserved for quality-assurance sampling, after which the audio is irreversibly deleted."
- It also flags the unresolved part: discoverability "varies by jurisdiction and requires explicit local clarification before implementation."
- Caveat worth knowing: the paper argues for retrospective audit by independent bodies and **does not** discuss clinicians listening back to verify their own notes. The verification use case is ours to justify, not something it endorses directly.

---

## 7. Malaysian Position: MMC Guideline 003/2023

Audio and Visual Recordings. Consultation audio is **not** in the clause 16 list of recordings exempt from separate consent (that list is x-rays, endoscopy images, pathology slides, ECG and similar). Grade: Strong, primary source.

| Clause      | What It Says                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **6**       | Valid consent is required prior to the "capturing, copying, **storing** and transmission" of recordings. Consent gates storage, not just recording |
| **10.a.iv** | Consent is for "a specific single purpose and not an overarching general purpose", and the consent form must state that purpose                    |
| **10.b.ii** | A recording may not be used outside the scope of the original consent. This forecloses repurposing captured audio for model training or analytics  |
| **10.b.iv** | Recording must stop immediately on the patient's request                                                                                           |
| **10.b.v**  | The recording must be stored in a secure environment                                                                                               |
| **11**      | Written consent is good practice; where impracticable, consent must be documented in the medical record                                            |
| **12**      | After recording, the patient may view it and withdraw consent for future use                                                                       |
| **13**      | "The practitioner shall accede to a patient's request for a copy of the recording"                                                                 |
| **18**      | Separate consent required, with an explanation of why the recording assists care, what form it takes, and an assurance of secure storage           |
| **19**      | Recordings made for clinical purposes "constitute part of a patient's medical record" and are treated as such                                      |

**The unresolved tension.** Clause 19 pulls a stored recording into the medical record, while vendors position it as a transient working artefact outside the record. Whether a draft-verification recording counts as "made for clinical purposes" is genuinely ambiguous, and it is exactly the local clarification the Frontiers paper says is needed. **Storing nothing avoids the question; storing anything raises it.**

---

## 8. Voice Is Itself An Identifier

- Biometric identifiers, **including voice prints**, are one of the 18 HIPAA Safe Harbor categories. Raw audio is therefore protected data independent of what is said in it. Grade: Moderate.
- Consequence for this architecture: audio can never pass the `backend/src/deid/` gate the way text does, because there is nothing to tokenise. `.claude/rules/security.md` already states this position: "Audio cannot be de-identified, so both are governed by bounds, audit, and per-consultation consent rather than by a gate."
- Practical rule: **audio must never reach an LLM provider**, and any audio handling is governed by consent and bounds, not by de-identification.

---

## 9. What This Means For This Repo

Constraints an agent must check before designing anything in this area. All current as of 08/09/26.

| Constraint                                                           | Source                                                                  | Effect                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No clinical content in `localStorage`, `sessionStorage` or IndexedDB | `.claude/rules/security.md` (Frontend)                                  | Persistent client-side audio is banned. In-memory state that dies on reload is the sanctioned pattern                                 |
| Any new audio egress needs explicit human sign-off                   | `.claude/rules/security.md` (Changes That Need Explicit Human Sign-Off) | Uploading audio to our own API is an egress. Playing a local blob in the browser is not                                               |
| No retention job, no TTL, no backup expiry                           | `.claude/rules/security.md` (Data And Persistence)                      | A stored-audio feature would have to build the repo's first purge mechanism, or it creates unbounded retention                        |
| New PHI-bearing columns must join the erasure tombstone              | `.claude/rules/security.md`, `backend/src/audit/erasure.ts`             | Stored audio needs a fourth erasure target. Data added inside `Consultation.transcript` does not, since that column is already erased |
| `media-src 'self' blob:` already in the CSP                          | `vercel.json`                                                           | Local blob playback needs no header change and no sign-off on that axis                                                               |

**Plumbing that already exists and should be reused rather than rebuilt:**

- `frontend/src/audio/transcribe.worker.ts` already sets `return_timestamps: true`, so segment times exist on the local Whisper path.
- `frontend/src/audio/draft-turns.ts` already persists `offsetSeconds` per segment, and deliberately refuses to fabricate one for a split line. **Preserve that rule:** a wrong offset is worse than none, because it makes a doctor doubt a correct transcription or trust an incorrect one.
- `frontend/src/audio/live/live-tokens.ts` carries real `startMs` and `endMs` per token on the ambient path, but the timing is discarded before persistence in `CapturePanel.tsx`.
- `attribute()` in `backend/src/routes/consultations.ts` already resolves a quoted span to a turn by unique substring match, and is the existing precedent for evidence linking.
- `ChecklistPanel.tsx` already renders a linked row as a button and an unlinked row as an inert div. Reuse that idiom rather than inventing a second one.
- `frontend/src/audio/live/use-segment-recorder.ts` implements per-utterance blob slicing with start and duration metadata. It is currently dead code, imported only by its own test.

**Known technical limit.** Word-level timestamps in `transformers.js` are unreliable under chunking (open upstream issues). Segment-level timestamps are the dependable granularity, and they match a sentence-level interaction anyway.

---

## 10. When Review Actually Happens

This decides whether an ephemeral, session-scoped design is sufficient in practice. The evidence is mixed and mostly secondary.

- Same-day chart closure rose by about 9.3% with ambient scribing (attributed to JAMA Network via trade press, **Weak**, not traced to the primary paper).
- After-hours charting fell by roughly 30 to 50% in reported studies, so it fell substantially but did **not** reach zero (**Moderate**).
- Some implementations _increased_ after-hours EHR use, because delayed note availability made clinicians return later (**Moderate**).
- Research protocols track "notes signed within the first 24h", implying signing is routinely not immediate (**Moderate**).

**Conclusion:** a meaningful share of note review happens after the capture session has ended. An in-memory-only design is demo-complete but workflow-incomplete, and that limitation should be stated rather than glossed.

---

## 11. Sources

Ambient scribe practice and policy:

- [Using ambient AI in clinical consultations: reframing policy around clinical audit and patient safety](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2026.1918841/full), Frontiers in Digital Health, 2026
- [The MediVoice implementation journey: ambient AI for clinical documentation](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2026.1764465/full), Frontiers in Digital Health, 2026 (Singapore, in-region hosting)
- [Always On: The Risk and Reward of Ambient Listening AI in Healthcare](https://proassurance.com/knowledge-center/always-on-the-risk-and-reward-of-ambient-listening-ai-in-healthcare), ProAssurance
- [Ambient AI Scribes: Efficiency Gains vs Emerging Privacy and Cybersecurity Risks](https://www.americanbar.org/groups/health_law/news/2026/ambient-ai-scribes-privacy-cybersecurity/), American Bar Association, 2026
- [Your AI Scribe May Be Taking Notes (and Plaintiffs Are Too)](https://www.alstonprivacy.com/your-ai-scribe-may-be-taking-notes-and-plaintiffs-are-too/), Alston and Bird

Product precedent:

- [Verify a Note With Linked Evidence](https://support.abridge.com/hc/en-us/articles/30235128433811-Verify-a-Note-With-Linked-Evidence), Abridge support documentation
- [Ambient Documentation (Abridge): Privacy and Security](https://healthhub.cpcmg.net/docs/ambient-documentation-charting-abridge-privacy-security), a deploying health system's operational documentation
- [Ambient AI Scribe Comparison Guide 2026: DAX, Abridge, Nabla, DeepScribe](https://www.medequipdirectory.com/guides/ambient-ai-scribe-comparison-guide-2026-dax-abridge-nabla-deepscribe/)

ASR accuracy:

- [OpenAI's transcription tool Whisper makes up words patients have never said](https://www.healthcare-brew.com/stories/2024/11/18/openai-transcription-tool-whisper-hallucinations), Healthcare Brew
- [AI transcription tools hallucinate, too](https://www.science.org/content/article/ai-transcription-tools-hallucinate-too), Science
- [whisper-base_timestamped broken with chunk_length_s=30](https://github.com/huggingface/transformers.js/issues/1358), transformers.js issue tracker

Regulatory:

- [Audio and Visual Recordings, Guideline 003/2023](https://mmc.gov.my/wp-content/uploads/2025/09/Audio-and-Visual-Recordings.pdf), Malaysian Medical Council
- [HIPAA and Biometrics: What Counts as PHI](https://www.accountablehq.com/post/hipaa-and-biometrics-what-counts-as-phi-and-how-to-stay-compliant), Accountable HQ
- [Singapore: MOH and HSA Launch Refreshed AI in Healthcare Guidelines (AIHGle 2.0)](https://www.bakermckenzie.com/en/insight/publications/2026/03/singapore-moh-and-hsa-launch-refreshed-ai-in-healthcare-guidelines), Baker McKenzie, March 2026

---

## 12. What This Changes

- **A transcript-playback feature is justified**, and the justification to lead with is silent ASR fabrication on code-switched speech, not general convenience.
- **Timing data is the durable asset, the audio blob is not.** Persisting per-turn start and end times is needed by every version of this feature, is cheap to add now, and is expensive to retrofit. Do that first regardless of the retention decision.
- **Retention is the expensive half, not playback.** Storing audio pulls in object storage, a purge mechanism, MMC clause 18 consent capture, a fourth erasure target, audit events and a sign-off. Playback from memory pulls in none of those.
- **Never fabricate a timestamp.** Where alignment is ambiguous, emit no timing. This matches the existing rule in `draft-turns.ts` and is a safety property, not a style choice.
- **Open question for the data controller:** whether a draft-verification recording falls inside MMC clause 19. Do not resolve this in code or docs; surface it.
