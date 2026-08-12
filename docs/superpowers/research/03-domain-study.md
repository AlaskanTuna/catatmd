# 03 — Domain Study

> Research stream: clinical documentation burden, ambient-scribe literature, AI-scribe failure modes, guideline corpus sourcing, and Malaysian regulatory bearing. Written for CatatMD (adult GP: acute cough / sore throat / URTI).
>
> **No clinician has reviewed this document, this repository, or any of its clinical content.** Every clinical statement below is a report of what a cited source says, not an endorsement of it. Nothing here is medical or legal advice.

---

## How To Read This

| Tag          | Meaning                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED** | I fetched the primary source (paper PDF, journal page, guideline page) and read the claim in it.                                        |
| **SNIPPET**  | Claim came from a search-result summary of a source I could not open directly. Cite with care; re-verify before it enters product copy. |
| **INFERRED** | My reasoning from the verified material. Not a finding from any source.                                                                 |

**A methodology warning that matters.** During this research one automated page-summariser returned a confident, fabricated claim: that arXiv:2604.14829 "explicitly addresses template completion behaviour... including fabricated pertinent negatives." I then read the actual PDF — it says no such thing, and in fact argues in roughly the opposite direction. The fabricated claim was exactly what I was looking for, phrased exactly as I had phrased the query. That is the same failure class as the anchor finding, occurring inside the research process itself. Every corroboration below was checked against primary text or is explicitly tagged SNIPPET.

---

## 1. Documentation Burden Evidence

### 1.1 International (Strong)

- **~2 hours of EHR work per 1 hour of direct patient care** for primary care physicians. Arndt et al., _Annals of Family Medicine_ 2017 — the canonical figure, triple-attested across three independent sources I read. **VERIFIED** (attested in [Annals abstract listing](https://www.annfammed.org/content/15/5/419.short), and quoted as the framing figure by both [Shankar et al. 2026](https://www.medrxiv.org/content/10.64898/2026.03.17.26348627v1.full.pdf) and [arXiv:2604.14829](https://arxiv.org/pdf/2604.14829)).
- Trend is worsening, not improving: _More Tethered to the EHR: EHR Workload Trends Among Academic Primary Care Physicians, 2019–2023_, [Annals of Family Medicine 22(1):12](https://www.annfammed.org/content/22/1/12). **SNIPPET** (title//thrust only).
- VA primary care clinicians spend **one-third to one-half of each patient visit** interfacing with the EHR, and **75% of between-visit time** in the EHR (>2 hours per half-day session). [PMC12325830](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12325830/). **SNIPPET**.
- Documentation burden displaces other clinical work: each additional documentation hour cut the proportion of patients with an outside record viewed by **7.1%**. [Health Affairs 2024](https://doi.org/10.1377/hlthaff.2024.00398). **SNIPPET**.

### 1.2 Malaysian / SEA (Weak — This Is Itself The Finding)

**I found no published measurement of documentation time or documentation burden for Malaysian private GPs.** Not a gap in my search depth so much as a gap in the literature: Malaysian primary-care research in this area measures _waiting time_ and _consultation length_, not charting time.

What does exist, and is usable:

| Finding                                                                                                                                                                                                                                   | Source                                                                                                                                                          | Tag          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Respiratory conditions were **26.8%–37.2% of all problems** seen in Malaysian primary care (2014 national data)                                                                                                                           | quoted in [Ooi et al. 2022, _Malaysian Family Physician_](https://pmc.ncbi.nlm.nih.gov/articles/PMC9809438/)                                                    | **VERIFIED** |
| In a dedicated Malaysian URTI clinic (n=564): cough **68.4%**, fever 31.6%, runny nose 24.6%, sore throat **24.1%**; diagnoses acute nasopharyngitis 52.5%, acute pharyngitis 18.6%, acute tonsillitis 5.3%; antibiotics in only **6.0%** | [Ooi et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9809438/) (CC BY 4.0)                                                                                | **VERIFIED** |
| Mean consultation time 18.2 min in a Malaysian public primary healthcare clinic; 10.54 min (SD 8.78) in a university health clinic                                                                                                        | [e-MFP consultation time study](https://e-mfp.org/wp-content/uploads/an-assessment-of-patient-waiting-and-consultation-time-in-a-primary-healthcare-clinic.pdf) | **SNIPPET**  |

**INFERRED — use the Malaysian data for scope justification, not for burden justification.** The Ooi data does not support a claim about Malaysian documentation time. It _does_ strongly support the clinical scope decision: cough and sore throat are the two dominant presentations in exactly the setting the product targets. That is a better and more defensible use of it.

---

## 2. Ambient-Scribe Clinical Literature

### 2.1 Effectiveness

- **Note quality is now roughly at parity with physician notes, with a characteristic profile.** Palm et al., _Frontiers in Artificial Intelligence_, 22 Oct 2025: 97 de-identified outpatient encounters, 194 notes (97 LLM ambient + 97 physician "gold"), modified PDQI-9, two blinded board-certified clinicians per specialty. Overall 4.25/5 gold vs **4.20/5 ambient (p=0.04)**. Gold better on accuracy (p=0.05), succinctness (p<0.001), internal consistency (p=0.004). **Ambient better on thoroughness (p<0.001) and organisation (p=0.03).** Evaluators preferred ambient 47% vs gold 39%. [PMC12586549](https://pmc.ncbi.nlm.nih.gov/articles/PMC12586549/). **VERIFIED**.
- Reported time effects (as summarised in the Singapore preprint's literature review, with its own citations): ~20–30% documentation time savings; a QI study of 46 clinicians found **20.4%** less time in notes per appointment and **30.0%** less after-hours work; an RCT of **238 physicians across 14 specialties** confirmed reduced writing time and burnout across two ambient platforms. [Shankar et al. 2026](https://www.medrxiv.org/content/10.64898/2026.03.17.26348627v1.full.pdf). **VERIFIED as reported-in-source** (I read this in the preprint; I did not open the underlying primary studies).

### 2.2 The Only SEA Evidence I Found — And It Is Directly Relevant

**Shankar, Goh & Xu (2026), "Clinician Experiences with Ambient AI Scribe Technology in Singapore: A Qualitative Study."** medRxiv preprint, posted 19 Mar 2026, CC BY 4.0, **not peer reviewed**. Alexandra Hospital / NUHS; 28 clinicians (18 physicians, 6 APPs, 4 allied health) across 11 specialties; enterprise-wide deployment live ~6 months. [Full text](https://www.medrxiv.org/content/10.64898/2026.03.17.26348627v1.full.pdf). **VERIFIED** (read pages 1–13).

Findings that bear on CatatMD:

- **Multilingual failure is named as a major barrier with equity implications** — the study's stated novel contribution. Verbatim from participants: _"Many of my older patients speak primarily in Mandarin or Hokkien. When the conversation switches from English, the accuracy drops significantly, and mixed-language passages are sometimes garbled entirely."_ And: _"For my Malay-speaking patients, I sometimes have to rewrite the note almost from scratch. The tool was clearly not designed for our multilingual reality."_
- **The editing-burden paradox** — _"I spend less time writing, but I spend more time reading and correcting. Some days I am not sure the net time savings are as large as they initially seemed."_
- **Hallucination was the single most concerning accuracy issue.** Example given: a fabricated current medication (atorvastatin) the patient had never taken. Also speaker misattribution (a family member's symptom attributed to the patient).
- **PDPA uncertainty surfaced unprompted** — _"I am not entirely sure all our patients would consider AI recording of their consultation to be within their expectations."_ Data residency, cloud processing and third-party vendor involvement were raised by multiple participants.
- Clinicians asked for a **structured process for reporting errors and hallucinations, with regular audits of note accuracy.**

### 2.3 Documented Failure Mode Taxonomy

Topaz, Peltonen & Zhang, "Beyond human ears: navigating the uncharted risks of AI scribes in clinical practice," _npj Digital Medicine_, Comment, 24 Sep 2025. [Article](https://www.nature.com/articles/s41746-025-01895-6). **VERIFIED**. Five named risks:

1. **Hallucination/fabrication** — _"generate entirely fictitious content, such as documenting examinations that never occurred or creating nonexistent diagnoses."_
2. **Critical omission** — symptoms, concerns or findings discussed but absent from the note.
3. **Misinterpretation** — context-dependent statements misconstrued into wrong treatments/medications/plans.
4. **Speaker attribution errors.**
5. **Disparate performance across speaker groups** (higher ASR error rates for African American speakers).

Their recommendation is squarely a design constraint: clinicians need to be trained to **audit** AI content — recognise common error patterns and verify generated claims. A product that does not make claims individually verifiable pushes that cost onto the doctor.

---

## 3. Fabricated Negatives — Corroboration Of The Anchor Finding

**Verdict up front:** I found **no published study that measures "fabricated pertinent negatives on sparse transcripts" as a named phenomenon.** What I found is stronger than nothing and weaker than a direct replication: the anchor finding is a sharper, more specific instance of **four separately documented phenomena**, each with primary-source numbers. That means the measured finding is a genuine contribution rather than a restatement of known work — and the safety architecture has independent literature support for its _mechanism_, not just its conclusion.

### 3.1 Negation Is A Distinct, Second-Largest, Clinically Severe Hallucination Class — In Primary Care Notes

**Asgari, Montaña-Brown, Dubois, Khalil, Balloch, Au Yeung & Pimenta, "A framework to assess clinical safety and hallucination rates of LLMs for medical text summarisation," _npj Digital Medicine_, 13 May 2025.** [Article](https://www.nature.com/articles/s41746-025-01670-7) · [medRxiv preprint](https://www.medrxiv.org/content/10.1101/2024.09.12.24313556v2) · [PubMed 40360677](https://pubmed.ncbi.nlm.nih.gov/40360677/). This is the highest-value corroboration in this document.

Four-category taxonomy, quoted definitions (**VERIFIED**):

| Category     | Definition                                                                   | Share of hallucinations |
| ------------ | ---------------------------------------------------------------------------- | ----------------------- |
| Fabrication  | "information that was not evidenced in the text"                             | 82 (43%)                |
| **Negation** | **"the model output negates a clinically relevant fact"**                    | **56 (30%)**            |
| Contextual   | "the model mixes topics otherwise not related to the given context"          | 33 (17%)                |
| Causality    | "a model speculates the cause of a given condition without explicit support" | 20 (10%)                |

- Corpus: **PriMock primary-care consultation transcripts** (25 per experiment × 18 experiments = 450 transcript–note pairs) plus ACI-Bench. 12,999 clinician-annotated sentences from 49,590 transcript sentences.
- Sentence-level **hallucination rate 1.47%** (191/12,999); **omission rate 3.45%** (1,712/49,590); **44% of hallucinations classified major** (i.e. capable of affecting diagnosis or management).
- The negation class was flagged as the most concerning: it _"mostly appeared in the planning section and contradicted what was said during the consultation"_ — the section containing direct instructions to colleagues and patients. **SNIPPET** for that sentence (search-result quotation of the paper body; the category definitions and counts are **VERIFIED** from the journal page).

**Honest distinction.** Their "negation" = the model _flips_ an assertion that was made. Ours = the model _invents_ an assertion state for a topic that was never raised ("denies haemoptysis" where haemoptysis never came up). These are siblings — both are assertion-polarity errors that survive fluency checks — but they are not the same measurement. Do not write "the literature has replicated our finding." Write "the literature establishes assertion-polarity error as a distinct, high-severity class in primary-care note generation; our finding is a specific unmeasured variant of it."

### 3.2 Imposing A Template Increased Major Hallucinations

Same paper: _"A novel template-driven method was introduced for generating customized outputs; however, comparison with baseline results revealed an increase in major hallucinations and minor omissions."_ **SNIPPET** (search-result quotation of the paper body; I could not open the medRxiv full text — 403).

**This is the most actionable single sentence in the whole research stream, and it cuts against us.** CatatMD's planned per-field clinical schema _is_ a template. The one study that measured what happens when you impose a template on LLM note generation found it made major hallucinations worse. The six-state assertion model is a plausible mitigation — an escape hatch the template in that study did not have — but that is a hypothesis, not a result. It must be tested, not assumed.

### 3.3 Ambient Notes Are More Thorough, Less Succinct, And More Hallucinatory — The Template-Completion Signature

Palm et al. 2025 (Section 2.1): **31% of LLM ambient notes contained hallucinations vs 20% of physician notes (p=0.01)**, while ambient notes scored _higher_ on thoroughness and _lower_ on succinctness and accuracy. **VERIFIED**.

**INFERRED:** "more thorough + less succinct + more hallucinatory" is precisely the fingerprint of a model filling out more of a note than the encounter supported. It is consistent with the anchor finding's mechanism without measuring it.

### 3.4 Negation Is A Known Systematic LLM Weakness (General Domain)

Varshney, Raj, Mishra, Chatterjee, Sarkar, Saeidi & Baral, "Investigating and Addressing Hallucinations of LLMs in Tasks Involving Negation," [arXiv:2406.05494](https://arxiv.org/html/2406.05494v1), Jun 2024. **VERIFIED**. On fact generation, hallucination was **59–72% with negation vs 26–42% without** (LLaMA-2-chat, Vicuna-v1.5, Orca-2, all 13B). **General knowledge domain, not clinical, and small open models** — this is context, not clinical evidence. But it says negation handling is a structural weakness rather than a quirk of one model.

### 3.5 The Mechanism: Models Do Not Abstain When Context Is Insufficient

Joren et al., "Sufficient Context: A New Lens on Retrieval Augmented Generation Systems," ICLR 2025 (Google / UC San Diego). [arXiv:2411.06037](https://arxiv.org/abs/2411.06037) · [Google Research blog](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/). **SNIPPET** (search-level; the headline number is quoted consistently across the blog and paper listings).

Headline: **Gemma answered incorrectly on 10.2% of questions with _no_ context, rising to 66.1% with _insufficient_ context.** Larger models "often output incorrect answers instead of abstaining when the context is not [sufficient]."

**INFERRED, and this is the sentence to put in the README:** partial context is more dangerous than no context. A one-line transcript is the worst possible input — enough to activate the model's clinical template, not enough to constrain it. That is not a quirk of qwen-flash; it is a documented property of the failure mode, and it is exactly the input distribution CatatMD targets.

### 3.6 The Same Law Fires One Layer Down, In Whisper

Koenecke, Choi, Mei, Schellmann & Sloane, "Careless Whisper: Speech-to-Text Hallucination Harms," **FAccT '24**. [arXiv:2402.08021](https://arxiv.org/pdf/2402.08021) · [ACM DL](https://dl.acm.org/doi/abs/10.1145/3630106.3658996) · [FAccT PDF](https://facctconference.org/static/papers24/facct24-111.pdf). **VERIFIED** (metadata + headline findings).

- **~1% of audio transcriptions contained entire hallucinated phrases or sentences with no basis in the audio.**
- Hallucination correlated with **longer non-vocal durations** — speakers with aphasia, and audio yielding hallucinations, had more silence.
- Roughly **40% of hallucinations were judged capable of harmful consequence**; Whisper invented plausible-sounding medications ("hyperactivated antibiotics"). **SNIPPET** for those two.
- Context: Whisper reportedly in use by ~30,000 clinicians / 40 health systems; OpenAI warns against high-risk domains. [Healthcare Brew](https://www.healthcare-brew.com/stories/2024/11/18/openai-transcription-tool-whisper-hallucinations) · [Science/AAAS](https://www.science.org/content/article/ai-transcription-tools-hallucinate-too). **SNIPPET**.

**This matters because CatatMD uses browser-side Whisper.** Silence → fabrication at the ASR layer; sparse text → fabrication at the LLM layer. The product has **two** fabrication surfaces obeying the same law, and the deid gate and evidence-span rule only protect the second one. A hallucinated Whisper span is a _verbatim transcript span_ as far as the evidence-binding check is concerned — it will pass.

### 3.7 The Counterpoint, Stated Fairly

**Augnito Research, "Beyond Literal Summarization: Redefining Hallucination for Medical SOAP Note Evaluation," [arXiv:2604.14829](https://arxiv.org/pdf/2604.14829), 16 Apr 2026.** Vendor preprint; 100 anonymised physician–patient transcripts; LLM-as-judge; one named clinician acknowledged for manual verification. **VERIFIED** (read pages 1–6).

Their argument, in their terms: **"over literal evaluation bias"** — treating any content not directly traceable to the transcript as a hallucination systematically misclassifies valid clinical work (synonym mapping, terminology normalisation, abstraction of exam findings, diagnostic inference, guideline-consistent planning). Measured effect: **mean hallucination rate 35% under a strict-grounding judge, dropping to 9% under an inference-aware judge**, with the remainder reflecting genuine safety concerns.

Their claim-classification tiers are directly useful to us — note especially Tiers 4 and 5, both of which are assertion-state errors:

| Tier | Type                      | Their example                                                                   | Verdict          |
| ---- | ------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| 1    | Direct statement          | Patient says "I have a headache" → SOAP: headache                               | Supported        |
| 2a   | Paraphrase                | "pain after every meal" → "post-prandial pain"                                  | Supported        |
| 2b   | Trade/generic equivalence | Glucophage → Metformin                                                          | Supported        |
| 3    | Inference                 | burning epigastric pain + antacid use → "Likely PUD"                            | Supported        |
| 4    | **Speculated overreach**  | Patient states **"no family history"** → SOAP: **"family history of diabetes"** | **Hallucinated** |
| 5    | **Contradiction**         | Patient **"denies alcohol"** → SOAP: **alcohol related cause**                  | **Hallucinated** |

Their stated risk if you collapse Tier 3 into Tier 4: _"fine tuning or prompting strategies may suppress medically necessary reasoning, producing documentation that is technically 'faithful' to the transcript but clinically incomplete and potentially dangerous."_

**INFERRED — take this seriously rather than dismissing it as vendor-motivated.** CatatMD's evidence-bound assertion rule ("every fact carries a verbatim transcript span; non-matching evidence forces NOT_ASSESSED") is exactly the strict-grounding regime they criticise. Applied bluntly it will force NOT_ASSESSED on legitimate paraphrase ("throat irritation" → "pharyngeal sensitivity") and produce a note the doctor rewrites anyway — the editing-burden paradox from §2.2. The resolution is to **scope the span requirement to assertion state, not to concept vocabulary**: PRESENT and DENIED must each carry a span; the _label_ of the concept may be a normalised term. That is a design decision the current formulation does not make explicit.

---

## 4. Citable Guideline Sources And Redistribution Posture

### 4.1 What Exists And Is Current

| Source                                                                                                                                                                                        | Covers                                                                                                                                                                                                  | Currency                                                                                                                             | Publicly linkable                                                                                                                                                                                                                                                                                        | Redistribution posture                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **MOH Malaysia, National Antimicrobial Guideline (NAG) 4th ed., §A10 Otorhinolaryngology — Tonsillitis/Pharyngitis**                                                                          | Modified Centor scoring; <3 → symptomatic only; ≥3 → Pen V 500 mg q6h or 1 g q12h / Benzathine Pen 1.2 MU IM stat / amoxicillin 500 mg q8h alt / erythromycin ES 800 mg q12h if pen-allergic; 5–10 days | © 2024, e-ISBN 978-967-2854-47-0                                                                                                     | [A10 page](https://sites.google.com/moh.gov.my/nag/contents/section-a-adult/a10-otorhinolaryngology-infections) · [NAG home](https://sites.google.com/moh.gov.my/nag) · [Pharmacy Services listing](https://pharmacy.moh.gov.my/en/documents/national-antimicrobial-guideline-nag-2024-4th-edition.html) | **© 2024 MOH Malaysia, all rights reserved. Summarise + link. Do not reproduce verbatim.** |
| **NAG §C Clinical Pathways in Primary Care** — C1 Acute Bronchitis & Pneumonia, C3 Acute Pharyngitis, C4 Acute Rhinosinusitis                                                                 | Primary-care pathways; the URTI content lives here, not in §A11                                                                                                                                         | **Actively maintained** — attached PDFs dated `Acute pharyngitis 09.12.2025.pdf` and `Acute bronchitis and pneumonia 13.02.2026.pdf` | [Section C index](https://sites.google.com/moh.gov.my/nag/contents/section-c-clinical-pathways-in-primary-care)                                                                                                                                                                                          | Same as above                                                                              |
| **Abdullah et al. (2024), "Treatment of Acute Sore Throat in Malaysia: A Consensus of Multidisciplinary Recommendations Using Modified Delphi Methodology," _Infection and Drug Resistance_** | McIsaac (modified Centor) scoring; ≥4 → likely bacterial, antibiotics; <2 → viral, none; symptomatic therapy is the mainstay (NSAIDs, paracetamol, topical NSAID lozenges, salt gargles)                | 2024                                                                                                                                 | [PMC11438446](https://pmc.ncbi.nlm.nih.gov/articles/PMC11438446/) · [Dove Press](https://www.dovepress.com/treatment-of-acute-sore-throat-in-malaysia-a-consensus-of-multidiscipl-peer-reviewed-fulltext-article-IDR)                                                                                    | **CC BY-NC 3.0 — verbatim quoting permitted with attribution, non-commercial.**            |
| **Ooi et al. (2022), _Malaysian Family Physician_**                                                                                                                                           | Malaysian URTI clinic epidemiology (see §1.2)                                                                                                                                                           | 2022                                                                                                                                 | [PMC9809438](https://pmc.ncbi.nlm.nih.gov/articles/PMC9809438/)                                                                                                                                                                                                                                          | **CC BY 4.0 — verbatim permitted with attribution.**                                       |
| **NICE NG84 — Sore throat (acute): antimicrobial prescribing** (Jan 2018)                                                                                                                     | FeverPAIN and Centor criteria and score-band streptococcus likelihoods                                                                                                                                  | 2018                                                                                                                                 | [NG84 recommendations](https://www.nice.org.uk/guidance/ng84/chapter/recommendations)                                                                                                                                                                                                                    | **DO NOT INGEST — see §4.3.**                                                              |
| **NICE NG120 — Cough (acute): antimicrobial prescribing** (2019)                                                                                                                              | Do not routinely offer antibiotics for uncomplicated acute cough / acute bronchitis; usually self-limiting, resolving in 3–4 weeks                                                                      | 2019                                                                                                                                 | [NG120](https://www.nice.org.uk/guidance/ng120) · [recommendations](https://www.nice.org.uk/guidance/ng120/chapter/recommendations)                                                                                                                                                                      | **DO NOT INGEST — see §4.3.**                                                              |

NICE score bands (**SNIPPET** — NICE returns 403 to automated fetch, so these came from search summaries and must be re-read by a human against the NICE page before use): FeverPAIN 0–1 → 13–18% strep likelihood, 2–3 → 34–40%, 4–5 → 62–65%. Centor 0–2 → 3–17%, 3–4 → 32–56%.

### 4.2 The Two Malaysian Sources Disagree — And The Corpus Must Show That

- **NAG 2024 (§A10):** Modified Centor **<3** → no antibiotic; **≥3** → antibiotic.
- **Abdullah et al. 2024 consensus:** McIsaac **≥4** → antibiotic; **<2** → no antibiotic.

Both are Malaysian, both are current, and they give different answers at a score of 3. **VERIFIED** that both sources say this as extracted; **NOT VERIFIED** against the underlying PDFs by a human, and **not reviewed by any clinician**.

**INFERRED:** a corpus that merges these into one "Centor threshold" chunk manufactures a consensus that does not exist, and the ID-constrained citation mechanism would then let the model cite a fabricated agreement with a real ID — a worse failure than a free-text citation, because it is structurally invisible. Chunks must be **one source per chunk**, carrying source, year and threshold, and the UI must attribute per-chunk rather than saying "the guideline says."

### 4.3 NICE Is Licence-Blocked For This Use

From the [NICE UK Open Content Licence](https://www.nice.org.uk/reusing-our-content/nice-uk-open-content-licence) (**VERIFIED** via search corroboration; the page itself 403s to automated fetch):

- _"Requests to use NICE content for artificial intelligence (AI) purposes in the United Kingdom and internationally are not covered by the terms of this licence."_ AI use requires either the syndication API application or written permission from `reuseofcontent@nice.org.uk`.
- The licence _"applies to requests to use NICE content in a UK setting only."_ International reuse beyond personal research/study is subject to a fee and a licensing agreement.
- Even within the licence, you _"are not permitted to amend or adapt the wording or structure of any published individual NICE guidance recommendations."_ Chunking a recommendation for retrieval is arguably exactly that.

**Posture:** do not put NICE recommendation text into the corpus. Cite NICE as external context in the README/TRD if useful, but anchor the corpus on Malaysian sources. This is not only the safe answer — it is the better product answer for a Malaysian GP tool.

### 4.4 The Scoring Tools Themselves

Centor, McIsaac (modified Centor) and FeverPAIN are clinical algorithms; their criteria are facts and are restated in the Malaysian sources above. **INFERRED posture:** express score criteria in our own words, citing NAG 2024 and Abdullah et al. 2024 as the authorities. That gives a locally-anchored corpus with a clean licensing story and no NICE dependency.

**Not verified in this session:** whether a MaHTAS/MOH _Clinical Practice Guideline_ (as distinct from the NAG) exists for URTI, cough or sore throat. `mymahtas.moh.gov.my` refused connection. Current working assumption: **NAG is the operative Malaysian source**, not a CPG. A human should confirm at [the MaHTAS CPG list](https://mymahtas.moh.gov.my/index.php/docman-list/publications/cpg-list) or [Academy of Medicine Malaysia](https://www.acadmed.org.my/index.cfm?%5C=&menuid=67).

---

## 5. Malaysian Regulatory Bearing

> Design posture only. Nothing below is a legal conclusion, and neither the device-scope question nor the cross-border question can be settled by an engineer reading guidance documents.

### 5.1 Medical Device Act 2012 (Act 737)

The statutory definition, quoted verbatim from **MDA/GD/0006, "Definition of Medical Device," First Edition, March 2014** ([PDF](https://www.mda.gov.my/index.php/documents/guidance-documents/1845-6-def-of-md-2/file), **VERIFIED** — read directly):

> Medical device means any instrument, apparatus, implement, machine, appliance, implant, _in vitro_ reagent or calibrator, **software**, material or other similar or related article **intended by the manufacturer** to be used, alone or in combination, for human beings for the purpose of —
> (i) diagnosis, prevention, monitoring, treatment or alleviation of disease; (ii) diagnosis, monitoring, treatment, alleviation of or compensation for an injury; (iii) investigation, replacement or modification, or support of the anatomy or of a physiological process; (iv) support or sustaining life; (v) control of conception; (vi) disinfection of medical device; or (vii) providing information for medical or diagnostic purpose by means of _in vitro_ examination of specimens…

Three things follow directly from the text:

1. **Software is explicitly named** in the article list. There is no software carve-out at the definition level.
2. **The hinge is "intended by the manufacturer."** MDA/GD/0006 §2 says the guidance covers _"products which may be considered to be a medical device,"_ and the classification determination turns on **stated intended purpose and mode of action** (**SNIPPET** for the "intended purpose and mode of action" phrasing, from MDA/GL/06 _Guideline of Product Classification_, 4th version June 2025 — [portal link](https://portal.mda.gov.my/index.php/documents/ukk/3696-gd-of-product-classification-4th-ver-2025/file), 403 to automated fetch).
3. Malaysia's classification is risk-based and ASEAN-harmonised (MDA/GD/0062, 3rd ed., June 2025). Third-party commentary places clinical decision support software at **Class B minimum, potentially Class C** where it influences real-time care in urgent or high-risk contexts — [Andaman Medical](https://andamanmed.com/malaysia-mda-releases-third-edition-of-asean-harmonised-medical-device-classification-guidance-mda-gd-0062/), [TrustedTraceMed](https://trustedtracemed.com/resources/malaysia-mda-medical-device-registration.html). **SNIPPET, and both are regulatory-consultancy blogs, not MDA.** Do not cite these as authority.

**INFERRED — the honest read of CatatMD's position.** The product is not one thing regulatorily. Transcript → SOAP note with mandatory clinician approval is a documentation aid and the weakest device candidate. Deterministic red-flag escalation prompts and guideline-cited management suggestions sit much closer to purpose (i) _"diagnosis, prevention, monitoring"_ — they are the reason the product is valuable and also the reason its scope status is genuinely undetermined. **I did not find an MDA guidance document that carves out documentation or record-keeping software**, and I could not open MDA's software-specific guidance (portal 403s). Anyone claiming "clearly out of scope" is guessing.

Design posture, all cheap and all defensible:

- Write an explicit **Intended Purpose** statement using Act 737 §2's own vocabulary, stating what the product is _not_ intended for. Put it in the README and PRD, not buried in the TRD.
- Keep every clinical output framed as a **prompt to the clinician**, never a conclusion. The existing invariants already do this (LLM may only _add_ red-flag candidates; approval is a required state transition; nothing is presented as a diagnosis). Say so in regulatory terms, not just architectural ones.
- No triage, diagnosis, or "detects X" language anywhere in UI copy, README, or demo narration.
- State plainly in the README that device classification is a determination for MDA and a regulatory advisor, and that the prototype is not for clinical use.

### 5.2 PDPA 2010 As Amended (Act A1719) — Cross-Border

**VERIFIED** via [Mayer Brown, Jul 2025](https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines), corroborated by [Rödl](https://www.roedl.com/en/insights/malaysia-part3-personal-data-protection-amendment-act-2024/), [Azmi & Associates](https://www.azmilaw.com/insights/cross-border-personal-data-transfer-under-the-personal-data-protection-act-2010-as-explained-by-the-cross-border-personal-data-transfer-guideline/), and the Commissioner's own [public consultation paper](https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/JPDP-FSB-241001-Cross-Border-PCP-ENG-TC.pdf):

- The **whitelist regime is gone.** Section 129 now requires meeting a condition under s.129(2) or (3): substantially similar law / adequate level of protection; explicit consent with written notice of recipient class and purpose; necessity for contract performance; vital interests; legal proceedings; or reasonable-precautions due diligence evidenced by BCRs, contractual clauses or certifications.
- **Cross Border Personal Data Transfer Guidelines issued 29 April 2025.**
- New obligations effective **June 2025**: mandatory DPO appointment (s.12), mandatory breach notification to the Commissioner (s.12B), direct security obligations on data _processors_ (s.9), data portability (s.43A).
- Sensitive personal data expanded to include biometric data. Maximum fine raised to **RM1,000,000** and imprisonment to three years for Data Protection Principles breaches.

**INFERRED — this is where the current architecture story needs correcting.** "Singapore hosting = data residency by design" reads as a strength but is, under the amended PDPA, precisely a **cross-border transfer of Malaysian personal data** requiring a s.129 basis. Two separate flows:

| Flow                                             | Crosses border? | Note                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API → LLM (Qwen, Alibaba Model Studio Singapore) | Yes             | Content is pseudonymised by the deid gate first. That materially improves the analysis but does not automatically remove it from scope — the data is re-identifiable via the vault, and the vault is what makes it re-identifiable. |
| API + Postgres (Render SG, Supabase SG)          | Yes             | This is the identifiable store. It is the harder of the two.                                                                                                                                                                        |

Design posture:

- Reframe the claim from "Singapore hosting = residency" to **"in-region ASEAN hosting, a documented s.129 basis, and a region-portable architecture"** — the swappable LLM adapter is the answer to "what happens when residency requirements change," and it is a better answer than a fixed region ever was.
- Since all consultation data in this repo is synthetic, the prototype does not process personal data at all. **Say that explicitly** — it converts an unresolved compliance question into a stated scope boundary, which is the correct posture for a prototype.
- Note in the TRD that a production deployment would trigger DPO appointment and breach notification duties, and that health data handled by private clinics sits under PDPA (private sector) rather than the public-sector exemption.

**Open question for the human:** does the brief expect data _in Malaysia_, or _in region_? Singapore answers the second, not the first. If the first, that is a known, stated limitation, not something to paper over.

---

## What This Changes

Ranked by cost-to-act. Items 1–5 are cheap and should be acted on; 6–8 are framing changes in docs; 9 is a stated non-change.

1. **Drop NICE from the corpus.** The NICE UK Open Content Licence expressly does not cover AI use, UK or international, and non-UK reuse needs a paid agreement. Anchor the 10–15 chunk corpus on **NAG 2024 (§A10 + §C1/C3 primary-care pathways)** and **Abdullah et al. 2024 (CC BY-NC)**, with **Ooi et al. 2022 (CC BY 4.0)** for epidemiology. This is a corpus-content change, not an architecture change.
2. **Add licence metadata to the guideline chunk schema.** Minimum: `sourceLicence` and `verbatimAllowed: boolean`. MOH NAG content is all-rights-reserved (summarise + link only); Abdullah 2024 and Ooi 2022 are quotable. Right now the schema has no way to express that difference, and the difference is legally load-bearing.
3. **Represent guideline disagreement rather than flattening it.** NAG 2024 (Modified Centor ≥3 → antibiotic) and the 2024 Malaysian consensus (McIsaac ≥4 → antibiotic, <2 → none) differ at a score of 3. One source per chunk; source + year + threshold on every chunk; per-chunk attribution in the UI. Merging them would let the model cite a manufactured consensus using a _valid_ ID — which the ID-constraint mechanism cannot catch.
4. **Scope the evidence-span rule to assertion state, not concept vocabulary.** Require a verbatim span for **PRESENT** and **DENIED**; allow normalised terminology for the concept label. Without this the system inherits the documented "over-literal" failure (35% → 9% hallucination purely by changing the judging criterion) and produces a note the doctor rewrites anyway — the editing-burden paradox reported by clinicians in the Singapore study.
5. **Treat the schema itself as a hypothesis to be tested, not a mitigation to be assumed.** The one published study that imposed a template on LLM note generation measured _increased_ major hallucinations. The eval must compare schema-constrained output against free-form on the same sparse transcripts, and must make **NOT_ASSESSED the default and cheapest path** — no field may be implicitly required to be filled.
6. **Add the ASR layer to the threat model.** Whisper hallucinates whole phrases in ~1% of transcriptions and does so more with long non-vocal spans. A hallucinated Whisper span is indistinguishable from a real one to the evidence-binding check — it passes. Minimum: state this in the README as a known limitation and name it as a second fabrication surface. Cheap mitigation if there is room: VAD-trim long silences before transcription.
7. **State the language scope explicitly and do not claim multilingual support.** The only SEA scribe study found names code-switching (Mandarin/Hokkien/Malay) as a _major_ barrier with equity implications — clinicians rewrote Malay-language notes from scratch. Malaysian GP consultations are heavily code-switched. Declaring "English-only prototype" as a named limitation is credibility; discovering it in a demo is not.
8. **Correct two framing claims in the PRD/README.** (a) The "~2 hours EHR per hour of care" figure is international — there is no published Malaysian private-GP documentation-time measurement, and the PRD must not imply one. Use the Malaysian data that _does_ exist (respiratory = 26.8–37.2% of primary care problems; cough 68.4% and sore throat 24.1% of URTI-clinic presentations) to justify the **clinical scope choice**, which it supports far better. (b) Reframe "Singapore hosting = data residency" as "in-region ASEAN + documented PDPA s.129 basis + region-portable adapter," and add an explicit Intended Purpose statement in Act 737 §2's own vocabulary.
9. **Nothing here changes the core architecture.** The PHI boundary, the single LLM egress point, deterministic-first red flags with LLM add-only, and ID-constrained citation all survive this research intact and are, if anything, better supported than before — clinicians in the field are independently asking for exactly the audit and error-reporting affordances the design already implies. The changes above are to corpus sourcing, schema metadata, evaluation design, and how the system is described.

**Explicitly not worth pursuing now:** obtaining a NICE syndication licence; seeking an MDA classification determination; measuring Malaysian GP documentation time. All are correct long-term actions and none can change a decision on the current build. They belong in the README's "what we would do next" section, which is a cheaper and more honest place for them.
