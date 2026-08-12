# 06 — What Wins Healthcare-AI Competitions: The Pattern

**Stream:** Competition/hackathon winning patterns, extracted as reusable moves — not a project list.
**Date:** 13/08/26 · **Runway assumed:** ~72 hours · **Audience:** demo script + README/proposal owners.

## How To Read This

| Tag                      | Meaning                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**             | Published judging criteria, named judge statements, or peer-reviewed/primary findings. URL given.                                         |
| **VERIFIED (secondary)** | Found via search summary of a real source; source URL given, but I did not fetch the primary text end to end. Treat quotes as paraphrase. |
| **INFERRED**             | My synthesis across sources. Defensible, but nobody published it as a rule.                                                               |

I found **no** healthcare hackathon rubric that explicitly awards points for "demonstrating a guardrail catching a failure." The support for that move is strong but indirect — I mark it INFERRED and say what it rests on.

---

## 1. Published Judging Criteria (VERIFIED)

Five real rubrics, side by side. The convergence matters more than any single one.

| Event                                       | Criteria                                                                                                                                                                                                                | Format Constraints                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Stanford health++ (2021)**                | Need Definition (10) · Quality of Implementation (10) · Technical Complexity (10) · **Progress During the Hackathon (10)** — "prototype development stage, presentation thoroughness, next steps, story of progression" | 40 pts total                                                                                                               |
| **Singapore Healthcare AI Datathon / NUS**  | Clinical Relevance and Impact · **Method Novelty — "NOT complexity"** · Result Presentation · Team's Plan for Moving Forward                                                                                            | 5-min live pitch, or ≤5-min recorded                                                                                       |
| **Healthcare AI Symposium pitch challenge** | Innovation and uniqueness · Impact on healthcare · Feasibility and scalability · Team capability · Clarity of presentation                                                                                              | 4-min pitch + 2–3 min Q&A; deck + ≤3.5-min video                                                                           |
| **Anthropic AI Hackathon (Toronto)**        | Innovation · **Technical Execution — "code quality, system design, robustness, depth of implementation, not just UI polish"** · Impact · Human Experience (incl. ethical alignment) · Presentation                      | ≤5-min demo video · GitHub repo with **readable README plus all prompts and config files** · **≤500-word written summary** |
| **MIT Hacking Medicine (Grand Hack)**       | 5-min pitch + 3 min judge Q&A; panel of clinicians, entrepreneurs, investors                                                                                                                                            | Need-first culture: pitch the **pain point, not the solution**                                                             |

Sources: [health++ 2021](https://healthplusplus21.devpost.com/) · [NUS Datathon rules](https://www.nus-datathon.com/rules-and-prizes) · [Healthcare AI Symposium pitch](https://healthsymposium.ai/pitch/) · [Anthropic Hackathon Toronto](https://anthropic-ai-hackathon-toronto.devpost.com/) · [MIT Grand Hack 2023 (Patient Safety Tech)](https://www.patientsafetytech.com/past-competitions/mithackingmedicinegrandhack2023) · [MIT Hacking Medicine model, IJTAHC](https://www.cambridge.org/core/journals/international-journal-of-technology-assessment-in-health-care/article/less-noise-more-hacking-how-to-deploy-principles-from-mits-hacking-medicine-to-accelerate-health-care/FBBA3F78A0FC31B93FD5C078657C7F78) (VERIFIED (secondary) for the "problem not solution" rule)

**What converges across all five:**

- **Need Definition is a scored line item, not a preamble.** Stanford gives it 25% of the total. NUS leads with clinical relevance. MIT makes it the entire pitch culture.
- **"Novelty, NOT complexity"** appears explicitly. A clever architecture scores nothing on its own.
- **"Next steps / plan for moving forward"** is scored at 2 of 5 events. Judges are buying trajectory, not a finished artifact.
- **The written artifact is a separate, mandatory deliverable** with its own tight word/time budget (500 words, 3.5 min, 5 min). It is not a dumping ground.

---

## 2. Demo Structure

### 2.1 What Judges Say (VERIFIED)

From [JetBrains, "How to Win a Hackathon: Notes From the Judging Table"](https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/) (named judges: Avi Press, Jono Bacon, Jan-Niklas Wortmann, Colin Lowenberg):

- **Show something working within 90 seconds** (Bacon's rule).
- **Pre-fill forms, mock slow API calls, remove every stalling point.** Explicitly sanctioned — this is not cheating, it is respecting the clock.
- **"Being straightforward about what works, what doesn't" reads as confidence** (Press). Honesty is framed as a _scoring asset_, not a confession.
- **Scope control is the top failure mode.** "If it's too long, cut down on your features" (Lowenberg). Five features done badly loses to one done end to end.

From [Devpost's 5-judge roundup](https://info.devpost.com/blog/hackathon-judging-tips):

- Richard Moot (Square): _"A project that really stands out is one that was clearly considering the judging criteria."_ He also penalises over-indexing on one criterion, and back-end-heavy work with no visible surface.
- Karen Bajza-Terlouw (Databricks): _"Ambiguity is a red flag, and also projects that lack detail and code."_ And: _"the more open you can be with how you created your project, the better."_
- Moot again: judges score **the combination** — a strong video with a weak written description still fails.

### 2.2 Live vs Recorded (VERIFIED (secondary))

- The practitioner consensus is that **live demos are not worth the risk**; pre-recorded sequences and screenshots **do not count against you** — "judges appreciate foresight, not risk." ([levelup/gitconnected](https://levelup.gitconnected.com/how-to-win-a-hackathon-ee740c6d47db), [SlideModel](https://slidemodel.com/hackathon-presentation/))
- A named hybrid tactic: **record the screen capture silently, narrate it live.** Keeps the human presence, removes the crash risk.
- Devpost's own demo-video guidance: 2–5 minutes, elevator pitch in the **first few seconds**, roughly **60% explaining / 40% demoing**. ([Devpost tips](https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video), [World's Largest Hackathon demo tips](https://worldslargesthackathon.devpost.com/updates/36832-demo-video-tips))

### 2.3 The One Real Contradiction (VERIFIED)

[YC's Demo Day guide](https://www.ycombinator.com/blog/guide-to-demo-day-pitches/) says the opposite: live product demonstrations _"seldom work in modern demo day presentations"_; don't use app screenshots; use a simple drawing; show **one** thing it does.

**Resolution (INFERRED):** YC is optimising a 60-second investor filter where the product is a proxy for traction. A prototype evaluated by a technical/clinical reviewer against a working end-to-end demo is the opposite regime — here the artifact _is_ the evidence. Take YC's **compression discipline** (one point per screen, speak slowly, cut the team slide) and reject its **anti-demo advice**. Do not let a pitch-deck instinct hollow out the demo.

### 2.4 The Extracted Demo Pattern (INFERRED)

Winning healthcare demos are sequenced **happy path → deliberate failure → the human's control → the honest limit**, not happy-path-only.

```
0:00–0:20  One sentence: who it is for, what it does, what it refuses to do.
0:20–1:30  Happy path, one realistic fixture, end to end. Something real on screen by 0:90.
1:30–2:30  The guardrail reel — 2–3 engineered failures, each visibly caught.
2:30–3:10  The doctor edits and approves. Show that approval is a state transition, never a default.
3:10–4:00  Limits, honestly. What is mocked, what is unvalidated, the named next step.
```

Beat 3 is where the runway goes. Beats 4 and 5 are what almost nobody else does.

---

## 3. Safety Framing: Does Showing a Guardrail Catch Win Points?

### 3.1 Direct Support (VERIFIED, but from buyer-evaluation, not judging)

[AI Smart Ventures, "How to Evaluate AI Tool Demos Without Getting Sold"](https://aismartventures.com/posts/how-to-evaluate-ai-tool-demos-without-getting-sold/) lists credibility signals evaluators are told to look for:

- **"The demo includes a failure case, not only a best-case output."**
- Shows what happens when input is unclear; shows data storage, retention, access controls; shows audit logs.
- **Red flags:** every output perfect in under two minutes; presenter avoids edge cases; vague on error handling; redirects to future features.

Corroborating buyer-side data point (VERIFIED (secondary)): Forrester (2025) is cited as finding **67% of AI buyers said the product performed worse than the demo within 90 days** — which is exactly why an all-green demo now reads as a _warning_, not a strength. ([The VC Corner](https://www.thevccorner.com/p/the-ai-trust-tax))

### 3.2 The Domain Evidence That Makes the Guardrail Reel Land (VERIFIED)

A healthcare reviewer who knows this space already knows AI scribes fail. Showing you know it too is the credibility move.

| Finding                                                                                                                                                                                                                                                                                                     | Source                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 commercial ambient-scribe platforms, 14 **simulated** ambulatory encounters: **mean note error rate 26.3%**; an average of **3.0 errors per case with potential for moderate-to-severe harm** (AHRQ harm scale); only **35.8% of correctly reported elements were consistently correct across platforms** | Mayo Clin Proc Digit Health, 9 Oct 2025 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/41234546/) · [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12605248/) |
| Netherlands GP study, 12 GPs, **535 consultations**, Dec 2024–Jul 2025: documentation time **−42.7s per consultation** (p<0.0001), **total consultation time unchanged**; drawbacks were **inaccurate summaries**, barriers to discussing sensitive information, interference with practice                 | [medRxiv](https://www.medrxiv.org/content/10.1101/2025.10.30.25339135v1) → [npj Digital Medicine](https://www.nature.com/articles/s41746-026-02454-3)         |
| ~60 ambient-scribe products on market, >$600M invested in three years; burnout improves, **financial ROI unproven**                                                                                                                                                                                         | [PHTI, Mar 2025](https://phti.org/announcement/ai-scribes-reduce-clinician-burnout/)                                                                          |
| Failure taxonomy from clinician end-user feedback: **omission, commission, contextual misunderstanding, clinical reasoning gaps**                                                                                                                                                                           | Dai et al., [arXiv:2512.04118](https://arxiv.org/pdf/2512.04118) (Dec 2025)                                                                                   |
| Automation bias in AI-assisted pathology under time pressure: **7%** of initially correct reads overturned by erroneous AI advice                                                                                                                                                                           | [arXiv:2411.00998](https://arxiv.org/abs/2411.00998)                                                                                                          |

### 3.3 The Trap: "The Doctor Reviews Everything" Is Not a Safety Argument (VERIFIED)

This is the single sharpest thing a knowledgeable reviewer can push back with, and it is the most valuable finding in this stream.

[Penn LDI, "In the Loop or On the Loop"](https://ldi.upenn.edu/our-work/research-updates/in-the-loop-or-on-the-loop-the-conundrum-of-ai-clinical-decision-support/), summarising Adam Rodman: _"just giving a human an AI system doesn't inherently improve that human's performance, and it doesn't improve their performance as much as if the AI system had just run by itself."_ Humans overriding correct algorithmic guidance is documented across trading, chess/Go, sentencing, weather, and industrial QC. There is a live academic critique titled ["Clinician in the loop: a flawed solution for AI oversight"](https://www.researchgate.net/publication/404514656_Clinician_in_the_loop_a_flawed_solution_for_AI_oversight).

**Implication (INFERRED):** "the doctor reviews and approves everything" is table stakes and, on its own, a _weak_ answer. The strong answer is: **what in the design makes that review actually effective?** Concretely, name the mechanisms — deterministic rules that cannot be suppressed by the model, ID-constrained citations that make a fabricated reference a parse error, missing-info prompts that direct attention rather than assume it, visible provenance so the doctor knows what came from where. That is a safety argument. "A human checks it" is not.

### 3.4 What Governance Frameworks Expect You To Disclose (VERIFIED)

Useful because they give you a _ready-made outline_ for the proposal's safety section, and mapping to them signals seriousness cheaply.

- **CHAI Applied Model Card** — the "nutrition label" for health AI: known risks and limitations, training data, bias mitigation, ongoing maintenance, covering CHAI's five principles (Transparency, Safety, Security & Privacy, Fairness & Bias, Usefulness). Free, open-source template. ([GitHub](https://github.com/coalition-for-health-ai/mc-schema) · [Registry](https://registry.chai.org/applied-model-card))
- **Malaysian Medical Council — Guideline on the Ethical Use of AI** (Sept 2025). Places obligations on the _practitioner_: accountability for AI-assisted decisions, independent verification of AI output, disclosure to patients, documentation of AI use, data protection, and primacy of clinical judgement. ([PDF](https://mmc.gov.my/wp-content/uploads/2025/09/MMC-Guideline-on-The-Ethical-Use-of-Artificial-Intelligence-AI-.pdf)) — VERIFIED that the document exists and covers these themes; **section-level quotes not verified**, the PDF extraction was lossy. Do not quote a clause number without re-reading it.
- **Malaysia AIGE** (MOSTI, Sept 2024) — seven principles: fairness, reliability, privacy & security, inclusiveness, transparency, accountability. Voluntary, national. ([malaysia.gov.my](https://www.malaysia.gov.my/en/my-initiative/whole-government-digital-services/tadbir-urus/national-guidelines-on-artificial-intelligence-governance-and-ethics-aige))
- **Malaysia PDPA (Amendment) Act 2024**, in force in stages Jan–Jun 2025: DPO appointment, breach notification, and a **revised s.129 cross-border transfer regime requiring Transfer Impact Assessments**. ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines))
- **Singapore AIHGle 2.0** (MOH + HSA, Mar 2026) — lifecycle guidance, explicit gen-AI coverage, clarity of responsibilities between developer / deployer / user. ([PDF](https://isomer-user-content.by.gov.sg/3/23fb5b36-56b4-4abb-9370-75c9ddcaf3ed/AIHGle%202.0.pdf))

---

## 4. Evidence Of A Real User

### 4.1 How Much Weight Judges Give It (VERIFIED / VERIFIED (secondary))

- MIT Hacking Medicine's whole method is **stakeholder-first**: map patients, clinicians, hospitals, payers; scrutinise their incentives; seek early feedback. Pitches are needs, not solutions. ([IJTAHC](https://www.cambridge.org/core/journals/international-journal-of-technology-assessment-in-health-care/article/less-noise-more-hacking-how-to-deploy-principles-from-mits-hacking-medicine-to-accelerate-health-care/FBBA3F78A0FC31B93FD5C078657C7F78), VERIFIED (secondary))
- A published health-hackathon study found only **18.6% of participants were physicians**, with experienced (40+) clinicians largely absent — and named this as the quality gap to fix. ([PMC4899493](https://pmc.ncbi.nlm.nih.gov/articles/PMC4899493))
- Multi-time winner guidance treats validation as a **collectable artifact**: _"Having at least 2 of these artifacts shows the judge that you dared to take the next step."_ Pitch order: Problem → Solution → Market → **Validation** → Demo. ([Gary Yau Chan](https://medium.com/garyyauchan/ultimate-8-step-guide-to-winning-hackathons-84c9dacbe8e))
- Judging-design guidance recommends a rubric of **problem fit, evidence of execution, feasibility, adoption potential, presentation clarity**, and warns that a polished prototype should not automatically win without user evidence or workflow fit. ([DoraHacks](https://dorahacks.io/blog/guides/hackathon-judging-plan)) — **MEDIUM confidence:** this line came from a search summary; the Medium mirror I fetched did not reproduce it verbatim. Use the idea, not the quote.
- 3Cloud's healthcare-hackathon retro: the winning team **scrapped their Friday pitch and pivoted Saturday** after a physician shared insight from her network; compliance (HIPAA, credentialing, liability) was built into the concept rather than bolted on. ([3Cloud](https://3cloudsolutions.com/resources/standing-out-at-a-healthcare-focused-hackathon/))

### 4.2 The Minimal Honest Substitute When No Clinician Has Reviewed (INFERRED)

Never claim clinician validation that did not happen — a healthcare panel contains clinicians, and a fabricated or vague quote is unrecoverable. The workable substitute, in descending order of cost:

1. **State the absence in one flat line, early.** "No practising clinician has reviewed this prototype. Here is what we used instead, and here is exactly how we would close that gap." Absence stated up front reads as rigour; absence discovered in Q&A reads as spin.
2. **Cite published clinician evidence and trace design decisions to it.** The GP ambient-scribe study, the Mayo simulated-encounter study, and the PHTI report are _real clinicians, at scale, on this exact product category_. A requirement traced to "GPs reported inaccurate summaries as a primary drawback (npj Digit Med 2026)" is stronger than one anonymous hallway quote.
3. **Ship the validation protocol you would run.** One page: the 30-minute session, the five fixtures, the rubric (see §5.3), the specific questions, the pass/fail bar, who you would recruit. This converts a missing input into demonstrated method — and it maps directly onto the "next steps / plan for moving forward" line item that two of the five rubrics score.
4. **Publish a falsification list.** "This design is wrong if a GP says X." Three or four entries. Nobody expects it; it is disproportionately convincing.
5. **Let the fixtures carry the domain evidence.** A transcript that gets Malaysian private-GP reality right — code-switching, brand-name medicines, the MC request, the walk-in cadence — proves domain understanding that a generic US-clinic transcript cannot. (Synthetic only, per project rules.)

---

## 5. Written-Proposal Patterns

### 5.1 The Criterion-Mapping Rule (VERIFIED / VERIFIED (secondary))

- Moot (Square), VERIFIED: standout projects _"clearly considered the judging criteria."_
- Grant-review guidance, VERIFIED (secondary): reviewers work a scoresheet, and **"if they can't find where you addressed a criterion, they'll give you a low score for that section, even if the information is buried somewhere in your narrative."** ([grants.com](https://grants.com/grant-review-process-explained-how-grant-applications-are-evaluated-scored-2026-guide/))

**Move:** make the brief's evaluation criteria the literal H2 headings of the proposal, in the brief's order. Do not make a reviewer hunt.

### 5.2 What AI-Specific Evaluators Score (VERIFIED)

The closest published analogue to "working prototype + written proposal, reviewed by a technical panel" is the AI-engineering take-home. From a field guide analysing 100+ submissions and company rubrics ([alexeygrigorev/ai-engineering-field-guide](https://github.com/alexeygrigorev/ai-engineering-field-guide/blob/main/interview/questions/06-home-assignments.md)):

- **Evaluation methodology is the top differentiator.** _"Red flag if candidate doesn't start with evals."_ Building the eval harness before the main logic reads as production thinking.
- Scored dimensions: functional correctness end to end and at the edges · architecture and error handling ("not code golf") · **evals** · production readiness (PII handling, input sanitisation, cost, monitoring) · tests even when optional.
- README should carry: **design decisions and trade-offs (the why, versus alternatives)** · architecture walkthrough · **eval results with numbers** · limitations and what you would do with more time.
- Named failure modes: skipping evals · under-documenting decisions · too little effort overall · ignoring the follow-up defence round (_"often more important than the code itself"_).
- _"Connect metrics to outcomes"_ — don't just report numbers, say what they mean.

### 5.3 Metrics That Are Legible To A Health Reviewer (INFERRED, built on VERIFIED instruments)

Small-n numbers beat no numbers, provided the instrument is recognisable:

- **PDQI-9** (Physician Documentation Quality Instrument) is the standard note-quality rubric; modified versions add Likert criteria **plus binary hallucination detection**. Known limitation, worth acknowledging: PDQI-9 dates to 2012, was validated on a small inpatient sample, and is a poor detector of LLM-specific errors. ([arXiv:2503.16504](https://arxiv.org/abs/2503.16504) · [PMC12586549](https://pmc.ncbi.nlm.nih.gov/articles/PMC12586549/))
- **Error taxonomy:** omission / commission / partially correct, with harm potential graded on the **AHRQ harm scale** — exactly what the Mayo simulated-encounter study did. Reusing their method makes your numbers comparable to a published benchmark.
- **The metric only this project can report:** red-flag recall on a fixture set where false negatives are counted at zero tolerance, plus a PHI-egress test asserting that zero identifiers crossed the boundary. Deterministic, cheap to compute, and it measures the thing the architecture exists for.

### 5.4 Honest Limitations As A Scoring Asset (INFERRED, converging support)

Press's "straightforward about what works, what doesn't" · the buyer checklist's "include a failure case" · CHAI's mandatory known-risks-and-limitations field · Bajza-Terlouw's "ambiguity is a red flag" all point one way: **a specific, severity-graded limitations table outscores a confident silence.** Vague limitations ("may need further testing") score as ambiguity. Specific ones ("we do not handle paediatric presentations; the trigger list is v0.1 and covers N conditions; Malay-English code-switching is unmeasured") score as control.

---

## 6. The 72-Hour Checklist

Ordered by return per hour. Everything below is adoptable without new infrastructure.

**Demo (highest leverage)**

- [ ] Cut to **one** fixture for the happy path. Rehearse until real output is on screen by **0:90**.
- [ ] Pre-seed the database, pre-warm caches, stub any slow call. Sanctioned, not cheating.
- [ ] Build a **guardrail reel** of 2–3 engineered failures, each visibly caught: (a) an identifier-laden transcript, showing the **actual de-identified payload** that left the API; (b) the model attempting to drop or soften a red flag, with the deterministic rule still firing; (c) a free-text citation rejected at parse time. These are the demo's differentiator — nothing else you can build in 72h is as hard to copy.
- [ ] Show approval as an explicit state transition, with the audit event. Show that nothing auto-approves.
- [ ] Close on limits with a named next step. Do not end on a feature.
- [ ] **Record it, narrate live.** Keep the raw recording as the fallback if anything is live.
- [ ] Time it against the brief's stated limit, minus 15%.

**Fixtures**

- [ ] Follow the published method: **simulated encounters + a per-case rubric of key elements**, so notes can be graded, not admired.
- [ ] Include at least one deliberately hard case (interruption, mumbled dose, code-switching, a symptom mentioned once in passing) and one red-flag case.
- [ ] Make Malaysian private-GP reality visible in the text itself. Synthetic only — this is a hard project rule, and it is also the honest answer to "where did this data come from."

**README / Proposal**

- [ ] H2 headings mirror the brief's evaluation criteria, in the brief's order.
- [ ] A **traceability table**: requirement → design decision → file/module → test that proves it → status. Nothing buried.
- [ ] A **trade-offs** section that names the alternatives rejected and why (provider adapter vs direct SDK; deterministic-first red flags vs LLM-only; ID-constrained citations vs free text).
- [ ] **Numbers from your own eval run** on the fixtures, with the instrument named (PDQI-9-derived dimensions; omission/commission counts; red-flag recall; PHI-egress assertions). State n. State what the numbers do _not_ establish.
- [ ] A **severity-graded limitations table**, specific enough to be uncomfortable.
- [ ] One line, unmissable: **no clinician has reviewed this prototype** — followed immediately by the one-page validation protocol and the falsification list.
- [ ] A one-page **model card** in CHAI's shape (intended use, out-of-scope use, known risks, data, maintenance).
- [ ] A short **local-fit** paragraph: MMC's practitioner obligations, AIGE's principles, PDPA s.129 / TIA for cross-border, and where the deployment sits. Cheap to write, hard for an out-of-region competitor to match.
- [ ] Commit prompts and config to the repo — one published rubric requires exactly this.

**Anti-patterns to avoid (all VERIFIED as penalised)**

- Five half-features instead of one that works end to end.
- Back-end depth with no visible surface (Moot penalises this explicitly).
- A strong demo with a thin write-up, or vice versa — judges score the combination.
- Marketing register. "Novelty, NOT complexity"; plain language beats "next-generation AI-powered."
- "A doctor reviews everything" offered as the safety story, unsupported by mechanism.
- A limitations section written in hedges.

---

## What This Changes

**Demo Script — four concrete deltas:**

1. **Add a guardrail reel as its own beat (~60s), between the happy path and the close.** Currently the natural instinct is happy-path-only. Three catches, in this order: PHI never leaving (show the actual outbound payload), a red flag surviving an LLM attempt to suppress it, a free-text citation failing schema validation. This is the strongest available answer to the buyer-side "include a failure case" credibility test and to the automation-bias critique at once.
2. **Hard-gate the happy path at 90 seconds to first real output.** Pre-seed data and stub slow calls deliberately; this is explicitly sanctioned by judges, not a compromise.
3. **Record the demo and narrate it live**, keeping the recording as the fallback. Judges are documented as reading pre-recording as foresight, not weakness.
4. **End on limits plus a named next step, not on a feature.** Two of the five published rubrics score "next steps / plan for moving forward" as a line item.

**README / Proposal — five concrete deltas:**

1. **Restructure H2s to mirror the brief's evaluation criteria in the brief's order,** and add a requirement → module → test **traceability table**. Reviewers score against a sheet and do not hunt.
2. **Add an eval section with real numbers from the fixture set**, using a named instrument (PDQI-9-derived dimensions plus omission/commission counts on the AHRQ harm scale, matching the published Mayo method) alongside the project-specific ones (red-flag recall at zero-tolerance for false negatives; PHI-egress assertions). "Red flag if candidate doesn't start with evals" is the single most-cited differentiator in AI-specific evaluation.
3. **Upgrade the safety section from "the doctor approves everything" to "here is what makes that review effective."** The human-in-the-loop defence is actively contested in the literature; leaving it unsupported hands a knowledgeable reviewer their opening question.
4. **State plainly that no clinician has reviewed the prototype,** then substitute: published clinician evidence traced to design decisions, a one-page validation protocol, and a falsification list. Do not manufacture a quote.
5. **Add a one-page CHAI-shaped model card and a short local-fit paragraph** (MMC practitioner obligations, AIGE principles, PDPA s.129 cross-border/TIA). Low cost, high signal, and it is the part an out-of-region competitor cannot fake.

**Fixtures — one delta:** design them as _gradeable_ simulated encounters with a per-case key-element rubric, including one deliberately hard case and one red-flag case, rather than as clean showcase transcripts. The published evaluations work this way; matching their method is what lets you report numbers at all.

**Unchanged:** architecture, provider strategy, and scope. Nothing in this stream argues for building something different — only for demonstrating and documenting what is already being built differently.
