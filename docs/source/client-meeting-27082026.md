<a id="top"></a>

# Client Meeting — Disruptive Doctors × Kabel — 27 August 2026

> **Primary Source** — local OBS recording `2026-08-27 11-00-31.mp4`, 53m 41s. Audio extracted with ffmpeg → Whisper `medium` on GPU via `~/CS/whisper-transcriber`. Raw output: `~/CS/whisper-transcriber/transcripts/client-meeting-27082026.txt`, 530 segments.
> **Second Source** — Google Meet speaker-attributed transcript + Gemini notes, circulated by Kabel after the call ([Google Doc](https://docs.google.com/document/d/193LZni9pWucN_Ekj8czBe9hte3b6Q-zKVHVIbqufr6Q/edit)).
> **Editing** — filler, dead air and screen-share fumbling trimmed; ASR-mangled names corrected.

> ⚠️ **Confidential.** Client names, commercial terms and an external deadline. Committed on the owner's decision with the repository **private**. Never make public, quote into a public issue or PR, or copy into `README.md`, `prd.md` or `trd.md`.

> ⏱️ Timestamps are **OBS-relative**. The Google transcript runs 2m 15s ahead — `OBS = Google − 2:15`, verified against three anchors.

---

## Provenance — The Missing Audio Is Resolved

OBS captured desktop audio only, so **ZJ's microphone was absent** from the primary recording. His turns were originally marked as gaps rather than reconstructed. **Kabel's Google transcript closed every one.**

ZJ's turns below are quoted from that transcript, marked `[via Google transcript]`. Both earlier inferences were checked against it:

| Earlier Inference                                        | Verdict                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 43:25 — a hosting question carrying a cost figure (high) | ✅ **Correct** — an infrastructure-cost question                                                                         |
| 34:40 — ZJ conceded gaps in the build (medium)           | ❌ **Wrong** — he was _correcting_ Vivek's team, not conceding. See [29:18](#2918--zj-corrects-the-treatment-plan-claim) |

Nothing in this document is now a reconstruction of anyone's speech.

---

## Name Correction Key

Whisper mangled nearly every proper noun. Corrected throughout; the raw file is uncorrected.

| Heard As                                                         | Actually                       |
| ---------------------------------------------------------------- | ------------------------------ |
| "Chatat MD" · "Japa MD" · "chart MV"                             | **CatatMD**                    |
| "Dr Diddick" · "Dr Bibin" · "Dr Beavik" · "Dr Wevet" · "Dr Bili" | **Dr Vivek**                   |
| "cable"                                                          | **Kabel**                      |
| "CJ" · "ZG" · "GJ"                                               | **ZJ** — Hee Zi Jie            |
| "Dingji" · "Jingjie" · "James" · "Ginger"                        | **Jing Jie** — Anderson        |
| "Weedat"                                                         | **Widad**                      |
| "Yitian" · "Wekan"                                               | **Lim Yii Tien** · **Wee Ken** |
| "BXP" · "ESP platform"                                           | **DXP**                        |
| "RG or D" · "REG"                                                | **RAG / vector DB**            |

---

## Attendees

| Person                       | Role                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| **Dr Vivek Subramaniam**     | Co-Founder & Chief Strategy Officer, Disruptive Doctors — **the client** |
| **TK Choo**                  | Kabel — agency lead, chaired the call                                    |
| **Widad Shahirah Hairuddin** | Kabel — coordination; owns the WhatsApp group action                     |
| **Esther Low · Camelia Loh** | Kabel — present, did not speak                                           |
| **Hee Zi Jie (ZJ)**          | **CatatMD — this repo.** Recovered from the Google transcript            |
| **Ling Jing Jie (Anderson)** | **CatatMD — this repo.** Presented slides, played the demo               |
| **Lim Yii Tien · Wee Ken**   | Second student team — being merged into ours                             |

Contact details are in the Kabel calendar invite. Deliberately not reproduced — personal email addresses do not belong in a repository, private or not.

Vivek left at **26:31** to take a call, returning at **33:41**. He was absent for the most commercially significant exchange of the meeting — [32:15](#3215--what-this-engagement-actually-is).

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## Contents

| Time                                                    | Segment                                         |
| ------------------------------------------------------- | ----------------------------------------------- |
| [00:00](#0000--introductions--the-brief)                | Introductions & The Brief                       |
| [05:00](#0500--catatmd-walkthrough)                     | CatatMD Walkthrough                             |
| [13:00](#1300--catatmd-demo)                            | CatatMD Demo                                    |
| [15:35](#1535--vivek-responds-shares-his-own-build)     | Vivek Responds, Shares His Own Build            |
| [16:30](#1630--ai-ambient-scribe--the-core-ask)         | **"AI Ambient Scribe" — The Core Ask** ⭐       |
| [17:14](#1714--the-language-problem)                    | **The Language Problem** ⭐                     |
| [19:03](#1903--ambient-toggle--patient-consent)         | Ambient Toggle & Patient Consent                |
| [21:16](#2116--cpg-rag-and-why-not-a-foundational-llm)  | **CPG, RAG, And Why Not A Foundational LLM** ⭐ |
| [23:32](#2332--diagnosis-next-questions-scoring)        | Diagnosis, Next Questions, Scoring ⚠️           |
| [25:22](#2522--the-five-minute-constraint)              | The Five-Minute Constraint                      |
| [26:31](#2631--vivek-leaves--tks-read)                  | _Vivek Leaves_ — TK's Read                      |
| [29:18](#2918--zj-corrects-the-treatment-plan-claim)    | **ZJ Corrects The Treatment-Plan Claim**        |
| [32:15](#3215--what-this-engagement-actually-is)        | **What This Engagement Actually Is** 🚨         |
| [33:41](#3341--vivek-returns--three-panes-at-once)      | _Vivek Returns_ — Three Panes At Once           |
| [36:57](#3657--the-medical-record-template)             | The Medical Record Template                     |
| [38:02](#3802--switchable-guideline-sets)               | Switchable Guideline Sets                       |
| [39:26](#3926--download-and-paste-into-any-cms)         | Download And Paste Into Any CMS                 |
| [43:25](#4325--zjs-infrastructure-cost-question)        | ZJ's Infrastructure-Cost Question               |
| [45:24](#4524--what-he-needs-to-see-next)               | **What He Needs To See Next** ⭐                |
| [48:32](#4832--vivek-leaves--team-merge-terms-homework) | _Vivek Leaves_ — Team Merge, Terms, Homework    |

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## 00:00 — Introductions & The Brief

**[00:01:15] TK Choo:** We've got Dr Vivek online. He's trying to collaborate with us to develop a clinical assistant. The brief which I gave you guys — the speech-to-text assistant — I just wanted to make sure you have the right brief. I know you guys did some work already. We want to hear from Dr Vivek, his point of view, so that after this you can go back and spruce it up a bit, and then give Dr Vivek a chance to use your demo.

**[00:02:23] Dr Vivek:** There was two projects that you sent over, TK. Maybe we start with the CatatMD one. Maybe they can go first and explain what was their thought process, and what they thought from the brief itself. The other one, I couldn't even enter the website.

> **[00:03:18 – 00:05:00]** Audio trouble. ZJ, via Google transcript: _"I think my computer's microphone is a little bit problematic — Jing, are you coming with the live demo if possible?"_ This is where the OBS capture lost him.

---

## 05:00 — CatatMD Walkthrough

**[00:05:00] ZJ** _[via Google transcript]_**:** Sorry I wasn't able to share my screen due to some system permission. Basically we designed this app — it's a clinical AI note-taking app. **The first thing that comes into our mind is privacy.** So our AI pipeline, the part where it transcribes the audio from the consultation — **we have a de-identification gate which strips the PII from the transcript before feeding into the AI pipeline.**

**[00:06:53] ZJ** _[via Google transcript]_**:** This is one of the key selling points. The part where it comes out with the clinical note is another. It shows a high-level overview of the subjective, objective, assessment, plan — and **it even highlights the red flags, the missing information that's not mentioned in the consultation.** So this is not just an AI summariser based on a chat script.

**[00:07:53] Jing Jie:** It turns a consultation transcript into a structured clinical note, and highlights information that may still be needed — potentially left out by the doctor. In the end **the doctor corrects, edits and approves** the note after review.

**[00:08:37] ZJ** _[via Google transcript]_**:** When you create a consultation it accepts three kinds of input. You can record voice in real time — we have two models that transcribe. One runs locally on your WebGPU. The other is a third-party ASR from **YTL Labs**. You can also upload a transcript file, or paste text directly.

**[00:11:01] TK Choo:** So Dr Vivek, you've tried the demo partially. What's your feedback? Too simple, or do you need more?

**[00:12:39] Dr Vivek:** I went through the demo already. I just wanted to see how you guys go through the demo itself.

---

## 13:00 — CatatMD Demo

> Pre-recorded narration played to the call. Matches `docs/demo/pitch-script.md`.

**[00:13:00]** This is the consultation list — draft, awaiting review, or approval. Let me create a new consultation. I can paste a transcript, upload one, or load a bundled case. Here I'll demonstrate voice recording, and here's the choice that matters: **ILMU, a Malaysian speech model by YTL Labs.**

**[00:13:32]** Our WebGPU native option is tuned for English and Manglish, but isn't as accurate as ILMU on Malay-heavy speech. It transcribes correctly without being mangled into gibberish.

**[00:13:48]** The transcription split the text into doctor and patient labels. Those labels don't come from the voices — they're inferred from what each line says, and you can correct them.

**[00:14:00]** **Before any of this goes to a model, the transcript is de-identified.** Names and identity numbers become tokens, and are only put back when the answer returns.

**[00:14:09]** On the left is the transcript. In the middle, the note in four sections, each marked AI-generated and editable. On the right, the danger signs, showing the deterministic Malay words that trigger them; the third says _AI Suggested_. Then the missing information — what the consultation never established. **If nobody asks about coughing blood, the note won't claim the patient denied it.**

**[00:14:51]** CatatAI can summarise the consultation, or change something — _add a safety-net line to the plan_. It hands me a card to apply or discard. **You make all the decisions.** Once everything looks fine, _Approve note_ finalises it.

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## 15:35 — Vivek Responds, Shares His Own Build

**[00:15:35] Dr Vivek:** So Jing Jie, I think it's a good effort what you guys have tried. Actually, can you stop sharing? Let me share my screen.

> 🚩 That sentence is **his only evaluative remark about our demo in the entire meeting.**

**[00:16:13] Dr Vivek:** This is our model that we created. **This is my demo, right?**

---

## 16:30 — "AI Ambient Scribe" — The Core Ask

**[00:16:30] Dr Vivek:** I don't know if you guys have heard about **AI Ambient Scribe**. Are you familiar with the term?

**[00:16:55] (team):** Not quite.

**[00:16:56] Dr Vivek:** Basically it's a fancy name for speech-to-text note taking. But when you say _scribe_, it needs to be based on what's for doctors. So ideally this is **not just simple note-taking**.

---

## 17:14 — The Language Problem

> ⭐ His single strongest and most-repeated concern.

**[00:17:26] Dr Vivek:** The biggest issue is not proper translation, and not getting the right language in — because in Malaysia we've got multiple languages. **English, Malay, Tamil, Chinese** — Chinese itself, **Mandarin, Cantonese**. So many accents as well.

**[00:17:57] Dr Vivek:** You guys need to decide **how you're going to solve that problem for me.** Speech-to-text isn't a big deal — we can go and create it. The biggest tough point is capturing all these dialects. Not just Malay. Chinese. Tamil. **And really bad, dramatic English.**

**[00:18:41] Dr Vivek:** This is going to be used in the clinic. This is done at a very high level, but not for the level of clinic usage. **This is going to be a waste of time for me. No one is going to use it, because they can't use it in the clinic.**

---

## 19:03 — Ambient Toggle & Patient Consent

**[00:19:03] Dr Vivek:** It needs to happen as an ambient scribe — **it's listening to the whole conversation.**

**[00:19:27] Dr Vivek:** The ambient part **can be switched on or switched off.** That's one of the options we want, because some people might say _"I don't want anything listening to our conversation, I don't approve."_

**[00:19:48] Dr Vivek:** There needs to be some part of it — is approval taken from the patient. That should be included in your site, because of **the PDPA part.** Approval — not approval, **consent.** Consent on listening to the conversation.

---

## 21:16 — CPG, RAG, And Why Not A Foundational LLM

> ⭐ The strongest alignment in the meeting — and the worst-handled exchange.

**[00:21:16] Dr Vivek:** When it's doing the analysis, **it needs to go through the guideline as well.** In Malaysia there's a thing called **CPG**. How do you want to put the CPG as a RAG? **Do you guys use RAG as part of the AI?**

**[00:21:44] ZJ** _[via Google transcript]_**:** For this use case we haven't used RAG or [vector] DB, but if we have a medical purpose of the source itself, I think yeah, it can be [done].

> 🚩 **This is the costliest sentence of the meeting.** The honest answer was _"we deliberately did not use RAG — we use a curated, ID-constrained corpus, which is strictly stronger on the axis you care about, because a hallucinated citation fails schema validation instead of merely being unlikely."_ What Vivek heard was **"no."** He then explained CPG from first principles for four minutes, and TK concluded a guideline library was _"missing from the demo"_ — see [26:31](#2631--vivek-leaves--tks-read). **Correcting this in writing is the single highest-leverage action before 2 September.**

**[00:22:31] Dr Vivek:** **You cannot use it based on a foundational LLM**, because a foundational LLM — anyone can fill up anything there. Some of the medical knowledge in an LLM is from probably Reddit, or Wikipedia.

**[00:23:15] Dr Vivek:** Every disease has their own clinical practice guidelines. Asthma has one, cancer has one, appendicitis has one — and this guideline is so specific.

---

## 23:32 — Diagnosis, Next Questions, Scoring

> ⚠️ Contains the one requirement that conflicts with our own `AGENTS.md`. See [The Conflict](#the-conflict-that-needs-a-human-decision).

**[00:23:32] Dr Vivek:** After listening to the patient, **it can give you possibly a diagnosis and also a clinical plan.** See, it's not just note taking.

**[00:23:49] Dr Vivek:** It helps you listen and **suggest a particular further question that can be asked.** If they are missing some questions — what other questions would you like to ask? And it needs to be from the point of: _if I've already asked this and they gave this answer_, then —

**[00:24:21] Dr Vivek:** They also have **calculators.** Guideline-based calculators. This scoring, that scoring. They can even ask _"can you fill up this score for me."_ It rates the patient, and it's very guideline-based.

**[00:24:47] Dr Vivek:** The **patient profile** part — these are all auto-population. It picks up what I write, or it listens. **It creates like a patient card.** From the patient card it develops into notes, then a summary, then suggestion and treatment plan.

---

## 25:22 — The Five-Minute Constraint

**[00:25:22] Dr Vivek:** All this needs to be **very simple and fast. Doctors see the patients in five minutes or less.** This is not something for very long conversation.

**[00:25:48] Dr Vivek:** It listens, gives the doctor the suggestion. The doctor can ask the question if the AI suggests it. Then maybe it suggests _you can do this scoring system_. He fills up the answers for the score. Then he gets the **final diagnosis or final treatment plan.**

**[00:26:31] Dr Vivek:** Give me around two minutes, I just need to answer a call.

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## 26:31 — _Vivek Leaves_ — TK's Read

**[00:27:31] TK Choo:** What Dr Vivek mentioned was **the reference point** — which documents to be referenced from when the AI does the analysis. A library of all the clinical diagnoses which are quite common. Upper respiratory tract is quite common, so there should be clinical guidelines your AI can refer to.

**[00:28:04] TK Choo:** **I think this is what is probably missing from the demo.** What he is demoing is something more complicated than we initially thought.

> 🚩 **Presentation failure, not a build gap.** CatatMD already ships a curated Malaysian guideline corpus with ID-constrained citations. The demo showed its _output_ without ever naming it, and ZJ's answer at 21:44 confirmed the wrong impression. Both the client and our own agency lead left believing we have no guideline layer.

**[00:28:35] TK Choo:** Pull it from the Malaysian one. Then you've got a good library where your AI can figure out the diagnosis and **recommend treatment options. So your demo didn't have treatment options, right?**

---

## 29:18 — ZJ Corrects The Treatment-Plan Claim

**[00:29:18] ZJ** _[via Google transcript]_**:** Allow me to interrupt a bit. **Our demo actually does suggest the treatment plan for the consultation.** I don't know if you noticed it when Jing Jie showed this feature.

> ✅ **Correcting the earlier record.** An earlier draft of this document inferred that ZJ had _conceded_ gaps here. He did the opposite — he pushed back, correctly, and the correction went into Gemini's own notes: _"Hee Zi Jie clarified that their demo already included treatment plan suggestions."_ The inference was wrong and is retracted.

**[00:30:21] TK Choo:** It wasn't clearly stated that _here's the treatment options_. **The time taken to select the appropriate notes needs to be quicker.** You only have five minutes. So the AI needs to work pretty fast.

---

## 32:15 — What This Engagement Actually Is

> 🚨 The most important exchange in the meeting.

**[00:32:15] Lim Yii Tien:** Is our mission that we need to design a website or a tool that can incorporate into his demo? What he wants — is it a website, or is it a tool?

**[00:32:54] TK Choo:** It's a tool that can incorporate in his demo website. **He's developing his own version.**

**[00:33:07] TK Choo:** So what we're trying to do is see whether externally, from you guys, **we can do an enhanced version of his version.** If it's a lot better than his, he will probably recommend that he uses yours instead. **So we're pitching to make it better than his own internal version.**

> **Read plainly:** we are not filling gaps in his product. We are competing with an internal build that already has a team and CTOs behind it. The bar is not _"useful addition"_ — it is _"better than what he already owns"_, judged by him.

---

## 33:41 — _Vivek Returns_ — Three Panes At Once

**[00:33:48] Dr Vivek:** It's a crazy week — the event is next week. By rights I didn't want to do the call, but because of the work you guys did already, I made sure I spent a bit of time to make sure you understand what we are looking for.

**[00:35:41] Dr Vivek:** **One part listening to your conversation. At the same time, concurrently, one part giving you a suggestion what to ask next. And one part auto-populating all your patient's information. Do you see that three things working at the same time?**

**[00:36:11] Dr Vivek:** Correct — **in real time.** Even this one I'm showing you doesn't have that yet.

**[00:36:13] ZJ** _[via Google transcript]_**:** I'm pretty sure you are looking for an automatic patient profile card. When you turn on the microphone to start intaking the conversation, it automatically fills up a patient profile card which summarises everything — the patient's information, the symptoms, everything — ready at the end of the consultation. **Real time.**

---

## 36:57 — The Medical Record Template

**[00:36:57] Dr Vivek:** Go and check the **template for medical records.** It starts with **presenting complaint** — PC — then **history of presenting complaint**, **past medical history**, **social history**, **family history.** We can auto-populate based on that category.

**[00:37:42] Dr Vivek:** And the usage of CPG, to make sure whatever they're saying is **verified.** Your diagnosis or your plan — everything verified by the clinical practice guidelines in Malaysia.

---

## 38:02 — Switchable Guideline Sets

**[00:38:02] Dr Vivek:** You need to be able to change the CPG to something else, because **we are not just a Malaysian company, we are global.** In your demo, show **how you can choose the guidelines.** One guideline or multiple. **You need to advise me how you guys can do that.**

**[00:38:30] Dr Vivek:** You can choose CPG. You can choose **NICE** — the UK guideline, used in most other parts of the world. Then **Singapore** guidelines. A few famous guidelines to put there; everything else we add later.

**[00:39:10] Dr Vivek:** **In medical, everything is based on guide.** It's not like medical means you're thinking everything on your own. **Everything has a flow chart. It's very straightforward.**

---

## 39:26 — Download And Paste Into Any CMS

**[00:39:26] Dr Vivek:** How do we download this summary? Right now we are **not connected to CMS or EMR.** They need to be able to download whatever the summary is and paste it inside their notes.

**[00:40:10] Dr Vivek:** In Malaysia, CMS alone — clinical management system — **I think we have like 100 different people on it.** It will be difficult to work with everyone. The main idea is: even if we are not integrated, we can just **download and paste it in the CMS.**

**[00:43:15] Dr Vivek:** **We need to keep it like ChatGPT — you know ChatGPT, there's a copy button.** That's all we need to see at the start, when we are not integrating with anyone.

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## 43:25 — ZJ's Infrastructure-Cost Question

**[00:43:25] ZJ** _[via Google transcript]_**:** I have a question regarding the website. **If we were to push this website to production, who would cover the cost of infrastructure?** When we deploy there is the front end and also back end — sometimes it will involve some fees, so that we are not limited to free tiers.

**[00:44:18] Dr Vivek:** What cost is that again?

**[00:44:41] Dr Vivek:** We already have a website — Disruptive Doctors, there is a website, and we have our own app. But we need to see what you mean, and how you want to put it inside our website, or how it integrates. This thing comes as a browser — because **we are selling it to the GPs** — connected to our website. So users, Disruptive Doctors' domain, and all these things.

**[00:45:18] Dr Vivek:** That one is something you can put as a query, then **I'll get my CTOs to look at it.**

> **Unresolved.** He did not answer who pays. Treat hosting cost as an open commercial question, not a settled one.

---

## 45:24 — What He Needs To See Next

> ⭐ The acceptance criteria for 2 September.

**[00:45:24] Dr Vivek:** What we are trying to look at is **how can you guys create something that we want** — that's first. And **how well you guys can create it** — that's second. **Doing speech-to-text is not a big issue. The issue is whether it's functional or not, especially in Malaysia with multiple languages and slangs. Is it functional?**

**[00:46:07] Dr Vivek:** **I'm going to test out this language and all these things. I can speak in multiple languages. I'm going to test it out, and I probably will test it out with other patients as well.**

**[00:46:23] Dr Vivek:** **I need a proper working prototype. Not just a prototype that does not work.**

**[00:46:53] Dr Vivek:** Then **I'm going to do my market validation.** If I got a lot of doctors excited about it, then we go and develop it. I'm not going to develop something and then ask them whether this works.

**[00:47:14] Dr Vivek:** Maybe next time we can **meet in person.** I understand **you are not from a healthcare background**, so you might not know a lot of things — but we can discuss and create a working prototype together. What I need is: when I choose _this is what we're going to do_, **this is something I really want and you guys can deliver.**

---

## 48:32 — _Vivek Leaves_ — Team Merge, Terms, Homework

**[00:48:32] TK Choo:** **These are real doctors.** Not your typical DXP. It's a bit more intense.

**[00:49:10] TK Choo:** **You guys provided the best presentations and pitch so far.** So we're going to group all of you together to work on one model.

**[00:49:36] TK Choo:** Now, **we haven't got the deal yet.** We're going to pitch for the deal. If in the end the pitch doesn't work, then we don't get the deal. So all of us here together is one agency.

**[00:50:57] TK Choo:** **Kabel will front it, but when it comes to product, you guys are the product guys.** The fees are the same, the payments are the same, there's no change. But if they say yes to our prototype, our MVP, you can put that on your CV.

**[00:52:26] TK Choo:** **Less than 3 minutes, you're out of the clinic.** For cough and cold, correct? **So your system has got to work in 3 minutes.**

**[00:51:49] TK Choo:** He's busy until first week of September, so we're going to get everything done by **2nd September**, when we give him the demo.

### Actions Assigned

| Owner     | Action                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| **Group** | Select the shared development platform                                       |
| **Group** | Redraft workflows for real-time ambient scribing and patient-card generation |
| **Group** | **Interview practising GPs** — market research, before the next meeting      |
| **Group** | **Build a working prototype by 2 September**                                 |
| **Widad** | Create the WhatsApp coordination group                                       |

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

# Analysis

Written after the meeting. Not said on the call.

## Requirements Register

| #   | Requirement                                                                           | CatatMD Status                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Multilingual + dialects** — Malay, Tamil, Mandarin, Cantonese, heavy-accent English | ❌ **Largest gap.** ILMU covers Malay/English only. His #1 concern, and what he will personally test                                                |
| 2   | Ambient mode with on/off toggle                                                       | ❌ Not built. Ours is record → analyse, not listen-while-consulting                                                                                 |
| 3   | Patient consent, PDPA-framed                                                          | ✅ **Already shipped** (`trd.md` §20, §20.4), scoped to one recording. He does not know                                                             |
| 4   | CPG grounding                                                                         | ✅ **Already shipped** and stronger than RAG on safety — but **communicated as absent**. See [21:16](#2116--cpg-rag-and-why-not-a-foundational-llm) |
| 5   | Switchable guideline jurisdictions                                                    | ❌ Not built. Corpus is Malaysian, single-set — **and licensing blocks the obvious approach**, below                                                |
| 6   | Three panes concurrent, real time                                                     | ❌ Not built                                                                                                                                        |
| 7   | Context-aware next-question suggestions                                               | ⚠️ **Half shipped** as the deterministic gaps engine; not live, not phrased as questions to ask                                                     |
| 8   | Guideline-based calculators / scoring                                                 | ❌ Not built                                                                                                                                        |
| 9   | **Differential diagnosis + treatment plan**                                           | 🚫 **Forbidden by our own `AGENTS.md`** — see below                                                                                                 |
| 10  | PC / HPC / PMH / SH / FH template                                                     | ❌ Not built. We ship SOAP + the Malaysian operational block                                                                                        |
| 11  | Copy/download for CMS paste                                                           | ❌ Not built (PDF export only). **Cheapest high-value item on the list**                                                                            |
| 12  | 3–5 minute total workflow                                                             | ⚠️ **Unproven.** ~9–10 s per `note_and_gaps` call on a one-line transcript. Nobody raised this risk                                                 |

## The CPG References Kabel Circulated

Three links were shared in the group chat as the reference set for requirement 4/5.

| Source                                                                               | What It Is                                                                                                              | Reuse Position                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [AMM CPG portal](https://www.acadmed.org.my/index.cfm?&menuid=67)                    | Academy of Medicine Malaysia — CPGs plus Quick Reference, Training Manual and Patient Information Leaflet per guideline | Not stated on the portal. **Must be confirmed before ingestion** |
| [NICE guidance](https://www.nice.org.uk/guidance)                                    | UK national guidance                                                                                                    | 🚫 **Blocking — see below**                                      |
| [MOH Singapore HPP](https://hpp.moh.gov.sg/guidelines/clinical-practice-guidelines/) | Directory page: ACE Clinical Guidelines, dental CPGs, HPB CPGs, withdrawn medical CPGs                                  | © Government of Singapore; terms not stated on the page          |

### Finding 1 — NICE Cannot Simply Be Ingested

The **NICE UK Open Content Licence** does not permit what requirement 5 assumes:

| Term                                                                                                            | Consequence For Us                                                     |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Applies **to a UK setting only**                                                                                | A Malaysian product sold to Malaysian GPs is out of scope entirely     |
| No exploitation "by combining it with other information, or by including it in your own product or application" | RAG over NICE content inside a commercial product is the excluded case |
| No amending or adapting the wording or structure of recommendations or substantial algorithms                   | Chunking and paraphrasing for retrieval is exactly this                |
| Attribution + disclaimer mandatory; no implication of endorsement                                               | Manageable, but must be built in                                       |

A separate **NICE UK Syndication Licence** exists for productised reuse — still UK-scoped. **Vivek said _"we are not just a Malaysian company, we are global"_ while naming NICE as the example. Telling him this is a demonstration of exactly the expertise he says he is shopping for.**

### Finding 2 — There Is No Malaysian CPG For Our Clinical Scope

The AMM CPG library covers breast, cervical and colorectal cancer, stroke, heart failure, STEMI, hypertension, diabetes, dyslipidaemia, hepatitis C, haemophilia, dengue and similar. **It contains no upper respiratory tract infection, cough or sore throat guideline.**

This is why our corpus (`guideline-corpus-v2`) is built on **MOH National Antimicrobial Guideline 2024**, Abdullah et al. 2024, and Ooi et al. 2022 instead. That was a correct call, not a shortcut, and it is a strong answer to _"why didn't you use CPG?"_ — **the CPG for this presentation does not exist.**

### Finding 3 — The Ask Is Really Two Asks

Requirement 4 (ground answers in guidelines) is **shipped**. Requirement 5 (let the doctor switch jurisdictions) is **a licensing and sourcing problem before it is an engineering one.** Treating them as one item is what makes the work look larger than it is.

## What We Have That He Never Asked For

**De-identification on the inference path.** His demo places patient name, age, gender and diagnosis in a sidebar feeding a chat box, with no visible boundary. He raised PDPA himself — in the consent context. The same statute governs the data leaving his server.

Also unasked-for and unmatched: deterministic red flags the model cannot suppress, and citations that fail schema validation rather than being merely unlikely to hallucinate.

## The Conflict That Needs A Human Decision

Requirement 9 is banned by our own rules. `AGENTS.md`: _"Do not present any output as a diagnosis."_ `README.md` already argues red flags plus cited suggestions are Class B CDS territory under MDA/ASEAN AMDD. **Differential diagnosis and treatment plans move us deeper into regulated-device territory, not out of it.** Dragon Copilot hard-codes refusal of clinical-decision prompts; Heidi withholds Evidence in the UK and EU.

Vivek is a practising doctor and may consider this his call. It is not something to resolve silently in code.

| Option                       | Trade                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Build it as asked**        | Fastest path to winning the pitch. Abandons the positioning the project is built on; inherits the regulatory exposure                                                                                                                                                                      |
| **Refuse, hold the line**    | Defensible. Risks reading as students lecturing a clinician about medicine                                                                                                                                                                                                                 |
| **Reframe** ⭐ _recommended_ | Guideline-cited differentials as **considerations with sources**, scoring tools he fills in himself, next-question prompts. The doctor states the diagnosis; we extract it, as we already do. Our existing architecture with a better UI — and the story that survives an MDA conversation |

## Deltas Versus The Written Brief

| Item           | Original Brief                     | This Meeting                                                            |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Scope          | Speech-to-text clinical assistant  | **Ambient scribe** — always-listening, three concurrent real-time panes |
| Clinical scope | Upper respiratory, adult GP        | **Any presentation**, guideline-driven, with scoring calculators        |
| Output         | Structured note + gaps + red flags | Note **+ differential diagnosis + treatment plan**                      |
| Guidelines     | Referenced generally               | **RAG over CPG**, switchable to NICE / Singapore                        |
| Languages      | Not specified                      | **Malay, Tamil, Mandarin, Cantonese, heavy-accent English**             |
| Note format    | SOAP                               | **PC / HPC / PMH / SH / FH**                                            |
| Export         | Not specified                      | **ChatGPT-style copy button** for CMS paste                             |
| Relationship   | Assumed: fill gaps in his demo     | **Compete with his internal build** — deal not yet won                  |
| Hosting cost   | Not raised                         | **Raised by ZJ, unanswered** — deferred to Vivek's CTOs                 |
| Deadline       | —                                  | **2 September**                                                         |

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>
