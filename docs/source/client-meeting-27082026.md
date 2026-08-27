# Client Meeting — Disruptive Doctors × Kabel × DXP Teams — Transcript

> **Source** — local recording `2026-08-27 11-00-31.mp4` (OBS capture, 53m 41s).
> **Method** — audio extracted with ffmpeg → OpenAI Whisper `medium` on GPU via `~/CS/whisper-transcriber`, `language=en`.
> **Editing** — timestamps preserved; filler, dead air and screen-share fumbling trimmed; ASR-mangled proper nouns corrected (see key below).
> Transcribed 2026-08-27. Raw output: `~/CS/whisper-transcriber/transcripts/client-meeting-27082026.txt` (530 segments).

> ⚠️ **Confidential.** Carries client names, commercial terms and an external deadline. Committed to this repository on the explicit decision of the owner, with the repository set **private**. It must not be made public, quoted into a public issue or PR, or copied into `README.md`, `prd.md` or `trd.md`.

---

## ⚠️ Missing audio — Adam's microphone

**OBS captured desktop audio only.** Every other participant is on the recording; Adam is not. His turns appear as silence.

**No line in this document reconstructs Adam's speech.** Where a turn is missing it is marked **`[ADAM — NOT CAPTURED · Ns]`**. Where the _content_ is recoverable from what the next speaker says, it appears as a separate **`[INFERRED · confidence]`** line. An inference is not a quote and must never later be cited as one.

---

## Proper-noun correction key

Whisper mangled nearly every name. Corrections applied throughout this document; the raw file is uncorrected.

| Heard as                                                         | Actually                           |
| ---------------------------------------------------------------- | ---------------------------------- |
| "Chatat MD" / "Chatat AI"                                        | **CatatMD** / **CatatAI**          |
| "Dr Diddick" / "Dr Bibin" / "Dr Beavik" / "Dr Wevet" / "Dr Bili" | **Dr Vivek**                       |
| "cable"                                                          | **Kabel**                          |
| "BXP" / "ESP platform"                                           | **DXP**                            |
| "REG" / "rag"                                                    | **RAG**                            |
| "Ding Ji" / "Jingjie"                                            | **Jingjie**                        |
| "ZG" / "CJ"                                                      | (CatatMD team member — unverified) |
| "Ilmu"                                                           | **ILMU** (YTL Labs)                |
| "Weedat" / "Sun rep reflects"                                    | unresolved                         |

---

## Attendees

| Person                   | Role                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| **Dr Vivek Subramaniam** | Co-Founder & Chief Strategy Officer, Disruptive Doctors — the client |
| **TK**                   | Kabel — agency lead, chaired the call                                |
| **Jingjie**              | CatatMD — presented slides and played the demo                       |
| **Adam**                 | CatatMD — **not captured on the recording**                          |
| **Wekan, Yitian**        | Second student team, separate project (demo not shown)               |

> Vivek left at **26:31** to take a call and returned at **33:41**. He was absent for the most commercially significant exchange of the meeting — see [32:15](#3215--what-this-engagement-actually-is).

---

## Contents

| Time                                                             | Segment                                            |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| [00:00](#0000--introductions--the-brief)                         | Introductions & the brief                          |
| [02:22](#0222--vivek-sets-the-running-order)                     | Vivek sets the running order                       |
| [07:44](#0744--catatmd-walkthrough)                              | CatatMD walkthrough (slides)                       |
| [13:00](#1300--catatmd-demo)                                     | CatatMD demo                                       |
| [15:35](#1535--vivek-responds-and-shares-his-own-build)          | Vivek responds and shares his own build            |
| [16:30](#1630--ai-ambient-scribe--the-core-ask)                  | **"AI Ambient Scribe" — the core ask** ⭐          |
| [17:14](#1714--the-language-problem)                             | **The language problem** ⭐                        |
| [19:03](#1903--ambient-toggle--patient-consent)                  | Ambient toggle & patient consent                   |
| [20:13](#2013--his-demo-flow)                                    | His demo flow                                      |
| [21:16](#2116--cpg-rag-and-why-not-a-foundational-llm)           | **CPG, RAG, and why not a foundational LLM** ⭐    |
| [23:32](#2332--diagnosis-next-questions-scoring)                 | **Diagnosis, next questions, scoring** ⚠️          |
| [24:47](#2447--patient-card-auto-population)                     | Patient card auto-population                       |
| [25:22](#2522--the-five-minute-constraint)                       | The five-minute constraint                         |
| [26:31](#2631--vivek-leaves--tks-read)                           | _Vivek leaves_ — TK's read of the gap              |
| [32:15](#3215--what-this-engagement-actually-is)                 | **What this engagement actually is** 🚨            |
| [33:41](#3341--vivek-returns--three-panes-at-once)               | _Vivek returns_ — three panes at once              |
| [36:57](#3657--the-medical-record-template)                      | The medical record template                        |
| [38:02](#3802--switchable-guideline-sets)                        | Switchable guideline sets                          |
| [39:26](#3926--download-and-paste-into-any-cms)                  | Download and paste into any CMS                    |
| [41:36](#4136--tks-summary-of-requirements)                      | TK's summary of requirements                       |
| [43:35](#4335--qa--integration-with-the-disruptive-doctors-site) | Q&A — integration with the Disruptive Doctors site |
| [45:24](#4524--what-he-needs-to-see-next)                        | **What he needs to see next** ⭐                   |
| [48:32](#4832--vivek-leaves--team-merge-terms-homework)          | _Vivek leaves_ — team merge, terms, homework       |
| [51:49](#5149--the-deadline)                                     | **The deadline** 🚨                                |

---

## 00:00 — Introductions & the brief

**[00:00:10] TK:** Dr Vivek, maybe just a round of introductions first. We've got four DXP students here. Guys, if you want to turn on your cameras for a bit so we can see everybody.

**[00:00:30] Dr Vivek:** I'm going to kick my camera off for the moment.

**[00:01:15] TK:** So we've got Dr Vivek online. He's trying to collaborate with us to develop a clinical assistant. The brief which I gave you guys — the speech-to-text assistant — I just wanted to make sure that you have the right brief. I know you guys did some work already in terms of your modelling. I think we want to hear from Dr Vivek, his point of view, so that after this you can go back and try to spruce it up a bit, work on it a little bit more, and then give Dr Vivek a chance to use your demo.

**[00:01:59] TK:** This is before we go into the full-blown DXP. Once we go into the full-blown DXP, if we can, then Dr Vivek and his team will further advise you on the development part.

---

## 02:22 — Vivek sets the running order

**[00:02:23] Dr Vivek:** I think there was two projects that you sent over, TK. Maybe we can actually start with — I think I saw the CatatMD one. I don't know who was the one in charge of that. Maybe they can go first and explain to me what was their thought process like, and what they thought from the brief itself, what they understood and what they wanted to deliver.

**[00:02:54] Dr Vivek:** The other one, I couldn't even enter the website, so maybe we can just demo it, because I never got the chance to actually look at it.

> **[00:03:18 – 00:07:39]** Audio and screen-share trouble. Repeated _"we can't hear you"_, _"your mic is quite far away"_, _"the voice is not very sharp"_. Roughly four minutes lost. Vivek confirms the CatatMD team is **"ZG and Jingjie"**.

---

## 07:44 — CatatMD walkthrough

**[00:07:44] Jingjie:** Just roughly go through the slide first, then I will do the demo.

**[00:07:53] Jingjie:** As ZG has said, it turns a consultation transcript into a structured clinical note. It tells you roughly what the consultation is after each session. And as a doctor, you need to review, edit and approve in the end. Doctors don't have much time to write each note during each session. So it turns a consultation into a structured clinical note and highlights information that may still be needed — that was potentially left out by the doctor. And in the end, the doctor corrects, edits and approves the note after review.

> **[00:09:13 – 00:12:29]** _"I will go through this later and technical."_ Then ~3 minutes of file-hunting and screen-share setup.

**[00:11:01] TK:** So Dr Vivek, you've tried out the demo partially, right? What's your feedback on that one? Too simple, or you need more? If it's more, what are you looking for? This is where you can help add value to the discussion.

**[00:11:22] Dr Vivek:** I understand. So I'll play the demo first.

**[00:12:39] Dr Vivek:** I think you have sent it to me over the email, so I went through the demo already. I just wanted to see how you guys go through the demo itself.

---

## 13:00 — CatatMD demo

> Pre-recorded narration, played to the call. Captured verbatim; matches `docs/demo/pitch-script.md`.

**[00:13:00]** This is the consultation list. Each record is named by what was found in it, and it sits at stages like draft, awaiting review or approval. Now let me create a new consultation. I can paste a transcript, upload one, or load a bundled case. In this case I'll be demonstrating voice recording — and here's the choice that matters: **ILMU, a Malaysian speech model by YTL Labs**.

**[00:13:32]** While that runs, it's worth noting that our WebGPU native option is tuned for English and Manglish, but it isn't as accurate as the ILMU model on Malay-heavy speech. It transcribes correctly without being mangled into gibberish.

**[00:13:48]** The transcription even split the text into doctor and patient labels. Those labels don't come from the voices — they're guesses from our AI based on what each line says. You can check whether they're correct or not.

**[00:14:00]** **Before any of this goes to a model, the transcript is de-identified.** Names and identity numbers become tokens, and are only put back when the answer returns.

**[00:14:09]** Now the review. On the left is the transcript. In the middle is the note in four standard sections — each marked AI-generated, and editable. On the right are the danger signs; they show the deterministic Malay words that trigger them. The third one says _AI Suggested_, which is inferred from the transcript. Then the missing information — what the consultation never established. For example, if nobody asks about coughing blood, the note won't claim the patient denied it.

**[00:14:51]** I can also ask our co-pilot, CatatAI, to give a summary of this consultation. And I can even ask it to change something, like add a safety-net line to the plan. It hands me a card asking whether to apply it or discard it. **You make all the decisions.**

**[00:15:16]** Lastly, once everything looks fine, I click _Approve note_ to sign off. Once approved, the note is finalised.

---

## 15:35 — Vivek responds and shares his own build

**[00:15:35] Dr Vivek:** So Jingjie, I think it's a good effort what you guys have tried.

> 🚩 **This is his only evaluative sentence about our demo in the entire meeting.** It is immediately followed by:

**[00:15:46] Dr Vivek:** Actually, can you stop sharing? Let me share my screen.

**[00:16:05] Jingjie:** Currently, because we may not know the actual flow in your day-to-day operations —

**[00:16:13] Dr Vivek:** Yeah, don't worry. Let me share my screen. Can you see this? So this is our model that we created. **This is my demo, right?**

---

## 16:30 — "AI Ambient Scribe" — the core ask

**[00:16:30] Dr Vivek:** So ideally what we are looking at is — I don't know if you guys have heard about **AI Ambient Scribe**. Are you familiar with the term?

**[00:16:55] (team):** Not quite.

**[00:16:56] Dr Vivek:** Okay, so basically it's a note. It's just a fancy name for speech-to-text note taking. But when you say _scribe_, it needs to be based on what's for doctors. So ideally this is **not just a simple note-taking**.

---

## 17:14 — The language problem

> ⭐ **His single strongest and most-repeated concern.**

**[00:17:26] Dr Vivek:** I think the biggest issue that you will see is not proper translation, and not getting the right language in — because in Malaysia we've got multiple languages. We've got **English, Malay, Tamil, Chinese** — Chinese itself, we've got **Mandarin, Cantonese**. We've got so many accents as well.

**[00:17:57] Dr Vivek:** So you guys need to decide **how you're going to solve that problem for me**. Because speech-to-text isn't a big deal — we can go and create it. The biggest tough point is going to be the work you're going to do to make sure you are able to actually capture all these different types of dialects. Not just Malay. It needs to be in Chinese. It needs to capture Tamil as well. **And it needs to capture in really bad, dramatic English.**

**[00:18:41] Dr Vivek:** You have to imagine this is going to be used in the clinic. This is done at a very high level, but it's not done for the level of clinic usage. And this is going to be a waste of time for me. **No one is going to use it, because they can't use it in the clinic.**

---

## 19:03 — Ambient toggle & patient consent

**[00:19:03] Dr Vivek:** The idea is this needs to happen as an ambient scribe. And the meaning of ambient scribe is **it's listening to you outside** — it's listening to the whole conversation.

**[00:19:27] Dr Vivek:** If you see this demo, this is also a very simple demo. The ambient part, we didn't — this is the first part of the demo. If you see, **the ambient part can be switched on or switched off**. That's one of the options we want, because some people might say _"oh, I don't want anything listening to our conversation, I don't approve."_

**[00:19:48] Dr Vivek:** So there needs to be some part of it — is approval taken or not from the patient. That should be included in your site as well, because of **the PDPA part**. Approval — not approval, **consent**. So consent on listening to the conversation.

> ✅ **Already built.** CatatMD's per-consultation consent gate (`trd.md` §20, §20.4) is exactly this, and is scoped to one recording — never remembered, never carried to the next patient. He does not know it exists.

---

## 20:13 — His demo flow

**[00:20:13] Dr Vivek:** Once you start listening — let's say, because the ambient part doesn't work yet, let's say I type: _"chest pain for five days."_ Then it will start working on that part.

**[00:20:43] Dr Vivek:** _"Tell me about the patient"_ — then say: **56 year old Chinese gentleman, chest pain and short of breath.**

---

## 21:16 — CPG, RAG, and why not a foundational LLM

> ⭐ **The strongest alignment in the meeting.** His reasoning is our fabrication argument, reached independently from clinical practice.

**[00:21:16] Dr Vivek:** When the thing is doing the analysis — listening and also analysing — **it needs to go through the guideline as well.** In Malaysia there's a thing called **CPG**. So these are the things you guys need to know: how do you want to put the CPG as a RAG? **Do you guys use RAG as part of the AI?**

**[ADAM — NOT CAPTURED · 22 s]**

> `[INFERRED · low]` A reply was given. Vivek does not acknowledge it and continues explaining what CPG is from first principles — so we cannot tell whether the ID-constrained-corpus answer landed. **Worth restating in writing before 2 Sept.**

**[00:22:00] Dr Vivek:** The CPG — clinical practice guideline — is basically all the information you can download as PDF, or you can actually crawl all the CPGs in Malaysia. We can put it as the guideline, because you need something that this works on.

**[00:22:31] Dr Vivek:** **You cannot use it based on a foundational LLM**, because a foundational LLM — basically anyone can fill up anything there. Some of the medical knowledge in an LLM is also from probably Reddit, or probably from Wikipedia.

**[00:23:15] Dr Vivek:** Every disease will have their own clinical practice guidelines. Asthma will have one, cancer will have one, appendicitis will have one — and this guideline is so specific.

---

## 23:32 — Diagnosis, next questions, scoring

> ⚠️ **Contains the one requirement that conflicts with our own `AGENTS.md`.** See [The conflict](#the-conflict-that-needs-a-human-decision).

**[00:23:32] Dr Vivek:** So this is one way that, after listening to the patient, **it can give you a possibly a diagnosis and also a clinical plan.** That will be useful for the doctors as well. See, it's not just note taking.

**[00:23:49] Dr Vivek:** It actually helps you listen to your conversation, **suggest a particular further question that can be asked**. If they are missing out some questions — what other questions would you like to ask? So that needs to come out. And it needs to be from the point of: _if I've already asked this question and they have given this answer_, then —

**[00:24:21] Dr Vivek:** They also have — what is that medical thing — it has its own **calculator** as well. We have guideline-based calculators. This scoring, that scoring. So they can even ask, _"oh, can you fill up this score for me."_ It actually rates the patient — how well is the patient — and it's very guideline-based.

---

## 24:47 — Patient card auto-population

**[00:24:47] Dr Vivek:** If you see here on the side, the **patient profile** part — these are all auto-population things. It will pick up the things that I write, or it listens. **It creates like a patient card.** And from the patient card, then it develops into notes — then like how you guys did it, in terms of summary and all that. Then there is a summary. Then it even gives you, in terms of, suggestion and treatment plan.

---

## 25:22 — The five-minute constraint

**[00:25:22] Dr Vivek:** But you have to understand — all this needs to be **very simple and fast**, because I don't know how many of you all have gone to a GP clinic. **Doctors see the patients in five minutes or less.** This is not something for very long conversation. So we need to make it very simple.

**[00:25:48] Dr Vivek:** It listens to the conversation, gives the doctor the suggestion. Then the doctor can ask the question if the AI suggests it to him. Then maybe it can even suggest _you can do this scoring system if you want_. If the scoring system comes out, then he just fills up the answers for the score. Then he gets the whole **final diagnosis or final treatment plan**. You guys can follow me so far?

**[00:26:31] Dr Vivek:** Give me around two minutes, I just need to answer a call.

---

## 26:31 — _Vivek leaves_ — TK's read

**[00:26:51] TK:** Okay, so it's a bit more complex than the original. In the briefing document, did you remember about the guidelines? It was in the briefing document, right? Focus on the upper respiratory system.

**[00:27:31] TK:** What Dr Vivek mentioned was **the reference point** — which documents to be referenced from when the AI does the analysis. These documents, like a library of all the clinical diagnoses which are quite common. Upper respiratory tract is quite common, so there should be clinical guidelines on that that your AI can refer to.

**[00:28:04] TK:** **I think this is what is probably missing from the demo.** Because what he is demoing is something more complicated than we initially thought.

> 🚩 **Presentation failure, not a build gap.** CatatMD already ships a curated Malaysian guideline corpus with ID-constrained citations. The demo showed the _output_ of it without ever naming it, so both the client and our own agency lead came away believing we don't have one.

**[00:28:35] TK:** There are many types of CPGs — Malaysian ones, Europe, US. You can pull it from the Malaysian one. Then you've got a good database in terms of a library where your AI can figure out what the diagnosis is and **recommend treatment options. So your demo didn't have treatment options, right?**

**[00:30:12] TK:** Maybe we start towards the end of the demo. It wasn't clearly stated that _here's the treatment options_. But I think also **the time taken to select the appropriate notes needs to be quicker**. Because like Dr Vivek said, you only have five minutes to diagnose and see a patient. So the AI needs to work pretty fast in terms of getting it all together and providing accurate information.

**[00:31:13] TK:** So if we can convince Dr Vivek, **all of you will be in one team.**

---

## 32:15 — What this engagement actually is

> 🚨 **The most important exchange in the meeting.** Corrects the working assumption about what is being asked of us.

**[00:32:15] (student):** I have something to clarify with Dr Vivek. Is that our mission is we need to design a website or a tool that can incorporate into his demo, or something? What he wants actually — is it a website, or is it a tool?

**[00:32:54] TK:** It's a tool. It's a tool that can incorporate in his demo website. **Yeah, he's developing his own version.**

**[00:33:07] TK:** So what we're trying to do is to see whether externally, from you guys, **we can do something better — an enhanced version of his version**. Now, if it's a lot better than his, then he will probably recommend that he uses yours instead, and further develop it. **So we're pitching to make it better than his own internal version.**

> **Read this plainly:** we are not filling gaps in his product. We are competing with an internal build that already has a team and CTOs behind it. The bar is not _"useful addition"_ — it is _"better than the thing he already owns"_, judged by him.

---

## 33:41 — _Vivek returns_ — three panes at once

**[00:33:48] Dr Vivek:** Sorry, for me it's a crazy week, because the event is next week as well. By rights I didn't want to actually do the call because I'm quite busy. But TK — because of the work that you guys did already, I made sure that I spent a bit of time here to make sure that you guys understand what we are looking for.

**[00:34:18] Dr Vivek:** So is there any question from what I was explaining earlier? You understand what I'm looking for? And you understand the things that you were not able to actually provide with your solution earlier?

**[ADAM — NOT CAPTURED · 27 s, then 25 s]**

> `[INFERRED · medium]` Adam acknowledged gaps in the current build. Exact content unknown.

**[00:35:37] Dr Vivek:** Yeah, I think you get some point of it.

**[00:35:41] Dr Vivek:** The idea is, we are using it in the clinic. **There is one part listening to your conversation. At the same time, concurrently, there's one part giving you a suggestion what to ask next. And one part is actually auto-populating all your patient's information. Do you see that three things working at the same time?**

**[00:36:11] Dr Vivek:** Correct — **in real time.** Even this one I'm showing you doesn't have that yet. But you need one part that is just listening to your conversation, transcribing the whole thing. Then one part is just telling what are the next questions the doctor should ask — _let's say you can ask this scoring system, so these are the things you need to ask the patient_. Then one part of it is telling this **differential diagnosis**. And the last part is actually taking all the information into a note.

---

## 36:57 — The medical record template

**[00:36:57] Dr Vivek:** You can go and check what is the **template for medical records**. The template starts with **presenting complaint** — we call it PC — then **history of presenting complaint**, then **past medical history**, **social history**, **family history**. These are all the templates. So we can auto-populate based on that particular category itself. You guys need to see how it actually populates this part.

**[00:37:42] Dr Vivek:** And also the usage of CPG, to make sure whatever they're saying is actually **verified**. That means your diagnosis or your plan — everything is verified by the clinical practice guidelines in Malaysia.

---

## 38:02 — Switchable guideline sets

**[00:38:02] Dr Vivek:** And you are able to change, right — because **we are not just a Malaysian company, we are global**. You need to be able to change the CPG to something else. So later, in your demo, you can show **how you can choose the guidelines** as well. You can either choose one guideline or multiple guidelines. **You need to advise me how you guys can do that.**

**[00:38:30] Dr Vivek:** That means you can choose CPG. You can choose **NICE** guidelines — NICE is the UK guideline, but it's used in most other parts of the world as well. Then you have **Singapore** guidelines. So we can use a few famous guidelines to put there. Then everything else we can add on later. Because in Malaysia we still sometimes use NICE guidelines, we use our own CPG, then Singapore uses their own guidelines as well.

**[00:39:10] Dr Vivek:** **In medical, everything is based on guide.** It's not like medical means you're thinking everything on your own. **Everything has a flow chart. It's very straightforward.**

---

## 39:26 — Download and paste into any CMS

**[00:39:26] Dr Vivek:** Another thing is — how do we download this summary? Because right now we are **not connected to CMS or EMR**. They might use this independently. So they need to be able to actually download whatever the summary is and paste it inside their notes. **That needs to be an easy process**, because at the moment we're not going to be able to integrate with every CMS or EMR.

**[00:40:10] Dr Vivek:** In Malaysia, CMS alone — clinical management system — I think we have like **100 different people on it**. So it will be quite difficult for us to work with everyone. But if we can integrate later on with the famous ones, we can do that. The main idea is: even if we are not integrated, we can just **download and paste it in the CMS**.

**[00:43:15] Dr Vivek:** If it's super independent, it's still not able to use it. **We need to keep it like how ChatGPT — you know ChatGPT, there's a copy button.** And after that you're copying it to the email and whatnot. So that's all we need to see at the start, when we are not integrating with anyone.

> ✅ **Our README's "no EMR write-back" boundary is his own read of the market.** Do not apologise for it. Do make copy-to-clipboard excellent — it is the cheapest high-value item on his entire list.

---

## 41:36 — TK's summary of requirements

**[00:41:36] TK:** I just wanted to summarise for everybody, because we're kind of running out of time.

1. **Ambient scribe** — something that could be in the background, **turning on and off**. An important parameter.
2. **Integrating CPGs, using RAG** to have a reference point for all the clinical diagnoses.
3. **Propose questions** that might be suggested by AI for the doctor to ask.
4. **Clinical workflow** — GPs have only about five minutes to diagnose, because they have so many patients. So the notes need to be taken, transcribed and suggested **online, in real time**.
5. **Download** — all these notes need to be downloadable so they can stick it into the patient file, either physically or in their own CMS system.
6. **CPGs referenceable from local or Europe or anywhere else** — have that option available.

**[00:43:01] Dr Vivek:** Yeah, you did. And also **the download part** as well — how easy we're going to download the whole thing.

---

## 43:35 — Q&A — integration with the Disruptive Doctors site

**[ADAM — NOT CAPTURED · 24 s, then 19 s]**

> `[INFERRED · high]` A question about hosting / integration with the Disruptive Doctors website, carrying a cost figure. Vivek's reply addresses exactly this, and he asks the cost back.

**[00:44:18] Dr Vivek:** What cost is that again?

**[ADAM — NOT CAPTURED · 23 s]**

**[00:44:41] Dr Vivek:** We already have a website — so Disruptive Doctors, there is a website, and we have our own app and all these things as well. But we need to see what you mean by that, and how you want to plan — put it inside our website, or how does it integrate with our website as well. So this thing comes as a browser — because we are selling it to the GPs. Then it means it comes as a web-browser kind of thing, but it's **connected to our website**. So that means users, Disruptive Doctors' domain, and all these things.

**[00:45:18] Dr Vivek:** I think that one is something you can probably put as a query, then **I'll get my CTOs to look at it** as well.

---

## 45:24 — What he needs to see next

> ⭐ **The acceptance criteria for 2 September.**

**[00:45:24] Dr Vivek:** The early point is, right now what we are trying to look at is **how can you guys create something that we want**. That's the first thing. And **how well you guys can create it** — that's the second question. Can you guys actually do the part where the language and all that is going to be? **Because doing a speech-to-text is not a big issue. The issue is whether it's functional or not, especially in Malaysia with multiple languages and slangs. Is it functional?**

**[00:46:07] Dr Vivek:** So these are the things that I need to see in a demo. **I'm going to test out this language and all these things. And I can speak in multiple languages. So I'm going to test it out and see — and I probably will test it out with other patients as well.**

**[00:46:23] Dr Vivek:** I need a demo that we can test out. Then I can tell — okay, this works, this is cool, let's go develop this thing. **I need a proper working prototype. Not just like a prototype that does not work.** Do you guys understand?

**[00:46:53] Dr Vivek:** If you guys can do that, then I'm going to test it out and see this works. And **I'm going to do my market validation**. And let's say I got a lot of doctors already excited about it — then we go and develop it. Because I'm not going to develop something and then ask them whether this works.

**[00:47:14] Dr Vivek:** Maybe the next one we can actually **meet in person**. If you guys are based locally, we can meet in person and discuss further, and I can explain better. Because I understand **you are not from a healthcare background**, so you might not know a lot of things — but we can always discuss and create a working prototype together. But what I need is, when I choose _okay, this is what we're going to do_, I need to make sure that **this is something I really want and you guys can deliver**.

**[00:48:15] TK:** Thank you, Dr Vivek, for your time. Let me talk to the teams again and I'll come back to you on some timelines.

---

## 48:32 — _Vivek leaves_ — team merge, terms, homework

**[00:48:32] TK:** Okay guys, how was it? **These are real doctors.** So this is a very interesting case — not your typical DXP. It's a bit more intense, I would say. So you think you guys are up to the challenge?

**[00:49:10] TK:** So the three of you — three groups here. **You guys provided the best presentations and pitch so far.** So we're going to group all of you together to work on one model. You can decide which platform you want to start off with first, and then you guys work on one model.

**[00:49:36] TK:** Now, **we haven't got the deal yet.** We're going to pitch for the deal. So if in the end the pitch doesn't work, then we don't get the deal. So all of us here together is one agency.

**[00:50:05] TK:** Go back, think about it. We'll send you the notes later so you can make sure you cover everything. **Really draft your workflows. Let's have a discussion before all of you start developing it.**

**[00:50:57] TK:** So **Kabel will front it, but when it comes to product, you guys are the product guys.** The fees are the same, the payments are the same, there's no change. But what you get is — if they say yes to our prototype, our MVP, then you can put that on your CV.

### 📋 Homework TK set

| #   | Task                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Merge into one team**, agree a platform before development starts                                                                                                                                             |
| 2   | **Draft workflows and hold a group discussion before writing code**                                                                                                                                             |
| 3   | **Interview a real GP** — _"Go find your medical friends and say, hey, I want to interview the GP. If you don't have any doctor friends, call your parents."_ Market research, required before the next meeting |
| 4   | WhatsApp group — Kabel to set up for coordination                                                                                                                                                               |

**[00:52:26] TK:** You've been to the clinic before, right? **Less than 3 minutes, you're out of the clinic.** For cough and cold, correct? **So your system has got to work in 3 minutes. Everything is ready in 3 minutes.**

---

## 51:49 — The deadline

**[00:51:49] TK:** I think he's busy until first week of September, so we're going to get everything done by **2nd September**, when we give him the demo.

> 🚨 **Six days from this meeting.**

---

# Analysis

Written after the meeting. Not said on the call.

## Requirements register

| #   | Requirement                                                                                  | Status in CatatMD                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Multilingual + dialect capture** — Malay, Tamil, Mandarin, Cantonese, heavy-accent English | ❌ **Largest gap.** ILMU covers Malay/English only. His #1 concern                                                                                      |
| 2   | Ambient mode with on/off toggle                                                              | ❌ Not built. Ours is record → analyse, not listen-while-consulting                                                                                     |
| 3   | Patient consent, PDPA-framed                                                                 | ✅ **Already shipped** (`trd.md` §20, §20.4). He does not know                                                                                          |
| 4   | CPG grounding, switchable guideline sets                                                     | ⚠️ **Half shipped.** ID-constrained Malaysian corpus exists and is _stronger_ than RAG on safety; jurisdiction switching (NICE, Singapore) is not built |
| 5   | Three panes concurrent, real time                                                            | ❌ Not built                                                                                                                                            |
| 6   | Context-aware next-question suggestions                                                      | ⚠️ **Half shipped** as the deterministic gaps engine (29-key assertion set); not live, not phrased as questions to ask                                  |
| 7   | Guideline-based clinical calculators / scoring                                               | ❌ Not built                                                                                                                                            |
| 8   | **Differential diagnosis + treatment plan**                                                  | 🚫 **Forbidden by our own `AGENTS.md`** — see below                                                                                                     |
| 9   | PC / HPC / PMH / SH / FH template                                                            | ❌ Not built. We ship SOAP + the Malaysian operational block                                                                                            |
| 10  | Copy/download to paste into any CMS                                                          | ❌ Not built (PDF export only). **Cheapest high-value item**                                                                                            |
| 11  | 3–5 minute total workflow                                                                    | ⚠️ **Unproven.** ~9–10 s per `note_and_gaps` call measured on a one-line transcript. Nobody raised this risk on the call                                |

## What we have that he never asked for

**De-identification on the inference path.** His demo puts patient name, age, gender and diagnosis in a sidebar feeding a chat box, with no visible boundary. He raised PDPA himself — in the consent context. **The same statute governs the data leaving his server**, and that is the argument that distinguishes us from an internal build he already owns.

Also unasked-for and unmatched: deterministic red flags the model cannot suppress, and citations that fail schema validation rather than merely being unlikely to hallucinate.

## The conflict that needs a human decision

**Requirement 8 is banned by our own project rules.** `AGENTS.md`: _"Do not present any output as a diagnosis."_ And `README.md` already argues that red flags plus cited suggestions are Class B CDS territory under MDA/ASEAN AMDD. **Differential diagnosis and treatment plans move us deeper into regulated-device territory, not out of it.** Every competitor named in our own README handles this by refusing — Dragon Copilot hard-codes refusal of clinical-decision prompts; Heidi withholds Evidence in the UK and EU.

Vivek is a practising doctor and may consider this his call. It is not something to resolve silently in code.

| Option                       | Trade                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build it as asked**        | Fastest path to winning the pitch. Abandons the positioning the project is built on; inherits the regulatory exposure                                                                                                                                                                                                                                                                                                        |
| **Refuse, hold the line**    | Defensible. Risks reading as students lecturing a clinician about medicine                                                                                                                                                                                                                                                                                                                                                   |
| **Reframe** ⭐ _recommended_ | Give him what he is actually asking for — the clinical thinking surfaced — without the system asserting a diagnosis: guideline-cited differentials as **considerations with sources**, scoring tools he fills in himself, next-question prompts. The doctor states the diagnosis; we extract it, as we already do. This is our existing architecture with a better UI, and it is the story that survives an MDA conversation |

**Highest-stakes open question from the meeting. Adam's and the team's to settle.**

## Adam's missing turns — worth filling from memory

| Time            | Gap            | Context                                                                         | Recoverability                                                             |
| --------------- | -------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **21:38→22:00** | 22 s           | Straight after _"do you guys use RAG?"_. He never acknowledges the answer       | ❌ Unrecoverable, and consequential — **restate in writing before 2 Sept** |
| **34:40→35:37** | 27 s + 25 s    | Answering _"what were you not able to provide?"_ → _"you get some point of it"_ | ⚠️ `[INFERRED · medium]`                                                   |
| **43:35→44:41** | 24 + 19 + 23 s | The integration/hosting question, with a cost figure                            | ⚠️ `[INFERRED · high]` — deferred by Vivek to his CTOs                     |

## Deltas vs. the written brief

| Item           | Original brief                     | This meeting                                                            |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Scope          | Speech-to-text clinical assistant  | **Ambient scribe** — always-listening, three concurrent real-time panes |
| Clinical scope | Upper respiratory, adult GP        | **Any presentation**, guideline-driven, with scoring calculators        |
| Output         | Structured note + gaps + red flags | Note **+ differential diagnosis + treatment plan**                      |
| Guidelines     | Referenced in brief (per TK)       | **Explicitly RAG over CPG**, and switchable to NICE / Singapore         |
| Languages      | Not specified                      | **Malay, Tamil, Mandarin, Cantonese, heavy-accent English**             |
| Note format    | SOAP                               | **PC / HPC / PMH / SH / FH**                                            |
| Export         | Not specified                      | **ChatGPT-style copy button** for CMS paste                             |
| Relationship   | Assumed: fill gaps in his demo     | **Compete with his internal build** — deal not yet won                  |
| Deadline       | —                                  | **2 September**                                                         |
