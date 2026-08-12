# Research 02 — The Malaysian Private GP's Tooling, Language, and Billing Reality

**Stream:** Forward-deployed / market reality (second half)
**Date:** 13 August 2026
**Question set:** What do Malaysian private GPs type into? Is "no EMR write-back" fatal? How much code-switching is there? What does panel/TPA billing compel?

**Evidence conventions used throughout**

| Tag              | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| **[VERIFIED]**   | Fetched the source page/PDF directly and read the claim                  |
| **[REPORTED]**   | Appeared in search-result snippets from a named source; page not fetched |
| **[INFERRED]**   | My reasoning on top of cited facts — not a sourced claim                 |
| **[UNVERIFIED]** | Searched for it and found nothing usable. Stated as a gap, not as a fact |

No clinical fact or statistic in this document is invented. Where a number is contested or single-sourced, it says so.

---

## 0. Bottom Line Up Front

1. **There is no dominant private-GP EMR in Malaysia to write back to.** The market is a long tail of small local vendors, plus a legacy on-premise installed base, with no published API standard and no interoperability mandate that currently reaches private GP clinics.
2. **"No EMR write-back" is therefore an acceptable MVP boundary — but the stated justification in the PRD is weak and should be replaced.** "MVP scope" is a shrug; "there is no write-back rail in Malaysian private primary care, and the national one lands with private _hospitals_ from January 2027" is a defensible architectural answer.
3. **The export set is aimed at the wrong artifact.** PDF/print is a dead end in a clinic that is already required to e-invoice and already submits claims through a TPA portal. Segmented copy (per-SOAP-section) plus a structured JSON export is a far better use of the same effort.
4. **English-only survives contact with reality better than expected** — because Malaysian doctors _write_ in English even when they _speak_ Malay/Manglish. The input is mixed; the output language is stable.
5. **Browser-side Whisper on code-switched Malaysian speech is the real risk**, and its documented failure mode (silently translating instead of transcribing) is clinically dangerous because it produces fluent, plausible, wrong text.
6. **Roughly six in ten Malaysian GP patients are panel/TPA cases**, and the TPA — not clinical convention — is what actually shapes what gets recorded.

---

## 1. What System Do Malaysian Private GPs Already Type Into?

### 1.1 The Honest Answer: A Fragmented Long Tail, Not a Platform

I could not find a credible market-share study for clinic management systems in Malaysian private GP clinics. **[UNVERIFIED]** — and I do not think one exists publicly. What the evidence supports instead is a fragmented market of small local vendors, none of which shows up as a de-facto standard.

**Vendors I could verify as real, Malaysia-facing clinic systems:**

| Vendor / Product                         | What it is                                                                                            | Source                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| kumoDoc                                  | Malaysian cloud CMS for GP clinics; TPA management, MyInvois/LHDN integration                         | [kumodoc.com](https://www.kumodoc.com/)                                                       |
| Desk Clinic                              | Cloud CMS for private clinics / GP groups / multi-branch                                              | [desk.clinic](https://desk.clinic/malaysia)                                                   |
| Clinex                                   | Malaysian cloud CMS + queue management, "built by doctors"                                            | [clinexmy.com](https://www.clinexmy.com/)                                                     |
| MocDoc                                   | Cloud EMR/e-prescription/billing, markets to Malaysian GPs                                            | [mocdoc.com/malaysia](https://mocdoc.com/malaysia)                                            |
| EasyClinic                               | EMR/scheduling/billing for solo physicians                                                            | [easyclinic.io](https://www.easyclinic.io/emr-software-in-malaysia/)                          |
| CLINICA                                  | "Smart ERP for clinics", Malaysia                                                                     | [clinica.com.my](https://clinica.com.my/best-clinic-management-system-malaysia-2026-guide/)   |
| Curo                                     | Malaysian CMS                                                                                         | [curo.com.my](https://curo.com.my/blog/best-clinic-management-system-malaysia)                |
| GPiS Solutions                           | Johor Bahru medical clinic + pharmacy POS software                                                    | [gpissolutions.com](http://www.gpissolutions.com/usr/page.aspx?pgid=2)                        |
| aceHealth, Visual Doctor                 | Listed among clinic management software in Malaysia                                                   | [softwaresuggest.com](https://www.softwaresuggest.com/clinic-management-software/malaysia)    |
| Medilink-Global (ICMS, MEDIBRIDGE, ECCS) | Regional TPA that also ships an Integrated Clinic Management System                                   | [medilink-global.com](https://medilink-global.com/profile)                                    |
| Qmed Asia                                | Queue/appointment/kiosk/teleconsult layer; self-reports **4,500+ healthcare providers, 6M+ patients** | [qmed.asia](https://qmed.asia/our-story), [hello.qmed.asia](https://hello.qmed.asia/about-us) |
| MyCLINIC / MyHIS                         | Cloud clinic app + hospital system                                                                    | [myclinichealthcare.com](https://www.myclinichealthcare.com/)                                 |
| CMAGSYS                                  | Named as a legacy Malaysian clinic stack running on local servers                                     | [desk.clinic blog](https://desk.clinic/blog/best-clinic-management-system-malaysia-2026)      |

**Names from the brief — verification status:**

| Name in brief | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qmed Asia** | **[VERIFIED]** real, but it is a patient-experience/queue/teleconsult layer, **not** a full GP EMR                                                                                                                                                                                                                                                                                                                               |
| **Mednefits** | **[VERIFIED]** real, but it is **not** a clinic system — it is a Singapore-origin employee medical benefits platform operating in Malaysia (1,500+ GP clinics in its SG+MY network; RM24m Series A in 2020). Sits on the _payer_ side. [mednefits.com](https://www.mednefits.com/about-us), [hrnews.my](https://hrnews.my/2020/11/19/mednefits-concludes-series-a-rm24-million-funding-enhancing-employee-benefits-in-malaysia/) |
| MediSense     | **[UNVERIFIED]** — no evidence found as a Malaysian GP clinic system. Do not assert it                                                                                                                                                                                                                                                                                                                                           |
| iSihat        | **[UNVERIFIED]** — no evidence found                                                                                                                                                                                                                                                                                                                                                                                             |
| Vios          | **[UNVERIFIED]** — no evidence found as a Malaysian clinic system                                                                                                                                                                                                                                                                                                                                                                |
| Medisys       | **[UNVERIFIED]** — no evidence found. Nearest real hits are MyHIS and GPiS                                                                                                                                                                                                                                                                                                                                                       |
| GPsoft        | **[UNVERIFIED]** — no evidence found. Nearest real hit is **GPiS Solutions** (Johor Bahru)                                                                                                                                                                                                                                                                                                                                       |
| ClinicAssist  | **[UNVERIFIED]** — no evidence found                                                                                                                                                                                                                                                                                                                                                                                             |
| MYNIC         | **[UNVERIFIED]** — no evidence found as a clinic system                                                                                                                                                                                                                                                                                                                                                                          |
| TM offerings  | **[UNVERIFIED]** — no evidence found of a TM clinic system for GPs                                                                                                                                                                                                                                                                                                                                                               |
| Ottobock      | **[UNVERIFIED]** — no evidence found as Malaysian clinic software                                                                                                                                                                                                                                                                                                                                                                |

> Do not put any of the UNVERIFIED names into the PRD, TRD, README, or a demo script. Naming a vendor that does not exist in this market is a credibility hit an external reviewer will catch instantly.

### 1.2 Are Many Clinics Still Paper-Based?

Direct measurement of private GP paper use: **[UNVERIFIED]**. But the surrounding evidence points hard in one direction.

- **Public sector is the documented laggard.** As of 2019, "only 24% of MoH hospitals (35 out of 145) equipped with a HIS" and "7% of health clinics (118 of 1703) using a clinical information system." **[VERIFIED]** — [Naim et al., _DIGITAL HEALTH_ (2025), four-decade narrative review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12227897/)
- The same review states the private sector shows "markedly stronger digital adoption" and warns "the digitalisation gap between the public and private sectors, if left unaddressed, may lead to a fragmented and inequitable healthcare landscape." **[VERIFIED]** — same source
- A 2017 MMA survey is repeatedly cited as showing "almost 80 per cent [of] private medical practitioners across the country already using personal computers." **[REPORTED]** — surfaced via search snippets of [The Borneo Post via PressReader](https://www.pressreader.com/malaysia/the-borneo-post/20220109/281668258326834); the page returned HTTP 403 and I could not read the primary. Treat as directional only. Note also that "uses a PC" ≠ "uses an EMR."
- MMA and MCMC launched a digitalisation push for private GPs in March 2024 via **Geran Digital PMKS Madani** — a RM100 million grant giving 50% matching up to RM5,000 to eligible micro/small enterprises. **[VERIFIED]** — [CodeBlue, Mar 2024](https://codeblue.galencentre.org/2024/03/mma-mcmc-launch-digitalisation-initiative-for-private-gps/). **[INFERRED]** a government-funded push to get private GPs onto digital tools in 2024 implies a meaningful un-digitised base at that point.
- Malaysia had roughly **9,830 private medical clinics as of 2022**. **[REPORTED]** — [Statista](https://www.statista.com/statistics/1464154/malaysia-number-of-private-medical-clinics/) (redirect loop on fetch; figure taken from the search snippet). Treat the exact number as approximate.
- Chains are a minority but a digitised one: **Qualitas Medical Group** operates ~300 primary care/dental/imaging sites across Malaysia, Singapore and Australia and self-reports 1.2M annual patient visits and "20% market share of the GP clinic chain" segment. **[REPORTED]** — [Qualitas](https://qualitashealthgroup.com/overview/), [Sojitz](https://www.sojitz.com/en/news/article/20210301.html). Note "of the _chain_ segment", not of all GPs.

### 1.3 The Structural Point That Matters More Than Any Vendor Name

**A Malaysian private GP clinic system is, first and foremost, a dispensing + billing + panel-claims system. The clinical note is a small field inside it.**

- Malaysian private GPs both prescribe _and_ dispense. Dispensing separation "is currently practiced in government health facilities, but not in the private sector," and GPs argue "most private GP clinics survive because they are allowed to both consult and dispense medicines, since GPs' consultation fees have remained stagnant at a rate of RM10 to RM35 for 33 years." **[VERIFIED]** — [CodeBlue, Aug 2025](https://codeblue.galencentre.org/2025/08/mandatory-prescription-sparks-doctors-fury-dispensing-separation-fears/), [PMC study on dispensing separation](https://pmc.ncbi.nlm.nih.gov/articles/PMC7909346/)
- Vendor feature lists confirm the centre of gravity: kumoDoc markets "front desk workflows to medication management," inventory, TPA management, MyInvois. [kumodoc.com](https://www.kumodoc.com/solutions/)

**[INFERRED]** — Consequence for CatatMD: even _if_ a write-back API existed, the destination field for a full SOAP note in a typical Malaysian GP CMS is a small free-text box, not a structured clinical document. A rich structured note has nowhere native to land. This weakens the case for write-back independently of the API question.

### 1.4 What the Government Is Building (And Who It Reaches)

| Programme                                                                                                      | Scope                                                                                                                                     | Reaches private GPs?          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **CCMS** (Cloud-Based Clinic Management System), reportedly running **SystmOne**                               | MOH _public_ health clinics. 412 clinics by end-2025, +137 in 2026, remaining 588 by end-2027; another source cites 2,917 clinics by 2028 | **No**                        |
| **MDHCN** (Malaysia Digital Health Certification Network) + Malaysia Patient Summary, "One Person, One Record" | Trust framework for public⇄private interoperability; MediAsas _network hospitals_ expected to participate                                 | **Not yet** — hospitals first |
| **Digital Health Act**                                                                                         | Tabled 2026; standardises digital healthcare delivery                                                                                     | Future                        |

Sources: [The Vibes on the 2027 EMR deadline](https://www.thevibes.com/articles/lifestyles/120041/moh-to-complete-electronic-medical-records-rollout-in-primary-care-by-2027) **[REPORTED]**; [MOF press release on MediAsas + MDHCN, 6 July 2026](https://www.mof.gov.my/portal/en/news/press-release/press-release-jbmkks-mediasas-060726) **[VERIFIED]** (pilot end-July to Oct 2026 in Klang Valley, nationwide rollout Jan 2027); [OpenGov Asia](https://archive.opengovasia.com/2025/02/10/malaysia-cloud-based-management-and-ai-enhance-healthcare/?c=us) and [The Sun](https://thesun.my/news/malaysia-news/people-issues/cloud-based-clinical-management-system-reduces-patient-waiting-times-in-health-clinics-to-under-60-minutes/) on CCMS **[REPORTED]** — the two clinic-count figures are inconsistent across sources; treat as "hundreds now, low thousands by 2027–28."

The MOF release is explicit that MediAsas/MDHCN participation is framed for **hospitals**, and says nothing about GP adoption requirements. **[VERIFIED]**

---

## 2. Is "No EMR Write-Back" an Acceptable MVP Boundary — or a Fatal Flaw?

### Verdict: Acceptable. Not fatal. But the _justification_ and the _export set_ both need to change.

### 2.1 Why It Is Not Fatal

1. **There is no rail.** No dominant private-GP EMR; no published API standard; no interoperability obligation that currently reaches private GP clinics (§1.4). Integration would be N bespoke vendor deals, not one integration. Where an API is offered at all it is a commercial add-on — kumoDoc lists APIs "as an add-on" with no public developer documentation found. **[REPORTED]** — [kumodoc.com](https://www.kumodoc.com/)
2. **The national interoperability path is real but not here yet.** MDHCN + Malaysia Patient Summary is pilot-stage with private _hospitals_; nationwide January 2027. **[VERIFIED]** — [MOF](https://www.mof.gov.my/portal/en/news/press-release/press-release-jbmkks-mediasas-060726). Building write-back today would mean building to a target that does not exist and will change.
3. **Copy-paste is the industry-standard MVP posture.** Self-serve AI scribes commonly stop at copy-paste. **[REPORTED — and this source is a competitor-comparison marketing page, so treat with suspicion]** — [Heidi Health blog](https://www.heidihealth.com/en-us/blog/nabla-copilot-alternative). The claim is directionally consistent with how these products are marketed, but I would not put it in the README as evidence.
4. **There is no obvious destination field** for a structured SOAP note inside a dispensing-and-billing-first CMS (§1.3). **[INFERRED]**

### 2.2 Why the Current Framing Is Still Wrong

**PDF/print is the weakest export you could have picked for this market.**

- Clinics are moving _away_ from paper under tax pressure, not toward it. E-invoicing is mandatory for clinics above the turnover threshold, with direct MyInvois API submission inside the CMS as the recommended pattern. **[REPORTED]** — [einvoicingmalaysia.com](https://einvoicingmalaysia.com/guides/e-invoicing-for-healthcare), [medicalmet.com](https://medicalmet.com/blog/lhdn-e-invoice-complete-guide-clinics/)
- A printed SOAP note has no consumer in the clinic day. It is not the claim, not the MC, not the invoice, and not the record. It creates a _second_ unfiled artifact and a PHI-handling problem (a paper note containing identifiers, left on a printer).
- **[INFERRED]** The genuine risk to this product is not write-back. It is that for a 10-minute URTI consult, review-then-edit-then-paste costs more time than a Malaysian GP's existing behaviour: writing "URTI, T39, PCM QID, MC 2/7". If approval takes longer than ~30 seconds the product loses on its own terms.

### 2.3 The Honest Answer to "Is a Copy-Paste Note Useful in a Real Clinic Day?"

- **For the high-volume short URTI consult: marginal.** Consultation fees anchored at RM10–RM35 for decades, six-in-ten patients on TPA rates paying below RM35 (§4.1), and dispensing-dependent economics all point to a throughput-optimised clinic where a 3-minute note is already fast.
- **For the longer consult: plausibly yes.** The 2026 fee reform raised the ceiling from RM35 to RM80 explicitly to reward depth — the Health Minister contrasted "a 10-minute consultation for a common cold" with "a 40-minute session for diabetes, cholesterol, hypertension, or mental health assessments." Floor stays RM10, unchanged since the MMA Fee Schedule 1992. **[VERIFIED]** — [Malay Mail, 11 Oct 2025](https://www.malaymail.com/news/malaysia/2025/10/11/health-minister-says-rm10-still-the-floor-price-for-doctor-visits-but-ceiling-raised-to-rm80/194240)
- **[INFERRED]** The defensible positioning is therefore **documentation quality and a safety net**, not "saves you time on coughs." Red-flag detection and missing-information prompts are the value; the note is the vehicle. That framing survives the "but I can write it faster by hand" objection. The time-saving pitch does not.

---

## 3. Real Language Behaviour

### 3.1 What Is Actually Established

- Malaysia is high-proficiency in English by international measure: **EF EPI 2025 score 581/650, 24th globally, highest-ranked in Asia** (2024 fact sheet: 566). **[REPORTED]** — [The Star](https://www.thestar.com.my/news/education/2025/11/21/malaysians-lead-asia-in-english-proficiency-says-survey), [Malaysian Reserve](https://themalaysianreserve.com/2025/11/21/malaysia-ranks-among-aseans-most-english-proficient-countries-after-singapore/), [EF fact sheet 2024 PDF](https://www.ef.com/assetscdn/WIBIwq6RdJvcD9bc8RMd/cefcom-epi-site/fact-sheets/2024/ef-epi-fact-sheet-malaysia-english.pdf)
- Malays are ~58.1% of a ~34.2M population (DOSM Q4 2024); ~137 living languages; Malay, English, Mandarin/Chinese dialects and Tamil dominate. **[REPORTED]** — [Tomedes language overview](https://www.tomedes.com/translator-hub/malaysian-language), [HKU Malaysia multilingualism field guide](https://fieldtrip-malaysia2019.linguistics.hku.hk/multilingualism-in-malayisa)
- Malay–English code-switching is documented as pervasive across formal and informal Malaysian settings, and Manglish is a recognised, corpus-attested variety. **[REPORTED]** — [MDPI _Languages_ on Malay–English CS patterns](https://www.mdpi.com/2226-471X/7/4/299) (403 on fetch — cited from search description only), [Manglish X-post corpus, _Data in Brief_](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10820639/)

### 3.2 What I Could Not Find — Say This, Don't Fake It

**A quantified study of code-switching rates specifically in Malaysian GP consultations does not appear to exist publicly. [UNVERIFIED]**

I found Malaysian code-switching work in classrooms and nurse–patient interaction, and code-switching-in-consultation work from _other_ health systems (Galician–Spanish, using a 586-consultation audio corpus — [MDPI _Languages_](https://www.mdpi.com/2226-471X/9/6/209)), but nothing that gives a switch rate for a Malaysian GP room.

> **Do not put a made-up percentage in the PRD.** Write the Known Limitation qualitatively and cite the ambient evidence. An external reviewer who knows this literature will respect "we could not find a quantified figure" far more than an invented one.

### 3.3 The Asymmetry That Saves the Design

**[INFERRED, but well-supported]** Malaysian doctors _speak_ Malay/Manglish/dialect with patients and _write_ records in English. Malaysian clinical documentation, prescriptions, and medical education run in English; the MMC's own records guidance and MOH clinical materials are English. See [MMC Medical Records & Medical Reports guidance](https://mmc.gov.my/wp-content/uploads/2025/09/Medical-Records-Medical-Reports.pdf) (PDF is binary-encoded and I could not extract quotes — **[UNVERIFIED]** as to its exact clauses) and [Malay medical terminology overview](https://preply.com/en/blog/malay-medical-terminology/) confirming Rumi-script official documentation.

Consequence: **the output language is stable (English) even when the input is mixed.** English-only _output_ is not a limitation at all in this market. The limitation is entirely on the _input_ side. That reframing is worth making explicitly — it converts a scary-sounding Known Limitation into a narrow, technical, ASR-scoped one.

### 3.4 How Badly Does This Hit Whisper?

This is where the real damage is, and it is worse for CatatMD's specific architecture than for a server-side scribe.

**Whisper's documented behaviour on code-switched speech:**

- Whisper Large V3 Turbo sat bottom of a frontier-ASR code-switching benchmark, **WER 0.16 to 0.61**. **[VERIFIED]** — [ServiceNow-AI code-switching benchmark](https://huggingface.co/blog/ServiceNow-AI/code-switching)
- Language pairs tested were **Spanish/French/Canadian-French/German ↔ English. No Southeast Asian language was included.** **[VERIFIED]** — same source. So these numbers are a floor-setting analogy, not a Malay measurement. State it that way.
- The critical failure mode: "when called without an explicit language parameter on code-switched audio, Whisper defaults to **translating into English rather than transcribing**, failing to preserve the language spoken in the audio." **[VERIFIED]** — same source.

**[INFERRED — and this is the load-bearing safety point]** Silent translation is the worst possible failure for a clinical pipeline. It does not produce garbage that a doctor notices; it produces _fluent, plausible English_ that a downstream LLM will confidently structure into a SOAP note. The de-identification gate, the red-flag rules engine, and the citation constraint all sit _downstream_ of a transcript that may already be a paraphrase. None of them can detect it. This deserves a line in the TRD's threat model, not just the Known Limitations list.

**Browser-side specifically makes it worse:**

- Practical browser models are small: whisper-tiny ~75MB, whisper-small.en ~240MB; large-v3-turbo ~2.7GB is impractical to ship to a clinic browser. **[REPORTED]** — [whisperstt.com](https://whisperstt.com/blog/transcribe-audio-in-browser/), [OfflineTTS comparison](https://offlinetts.com/blog/browser-speech-recognition-whisper-comparison/)
- Whisper is designed for 30-second windows; long audio needs sliding-window chunking, and hallucination clusters at chunk boundaries and in silence. **[REPORTED]** — same sources
- One source claims `SuppressTokensLogitsProcessor` is commented out in transformers.js v3.8.1, meaning ~90 hallucination-prone tokens are never suppressed. **[REPORTED — single source, technically specific, not independently confirmed]** — [whisperstt.com](https://whisperstt.com/blog/transcribe-audio-in-browser/). Verify in the installed version before repeating this anywhere public.
- Default pipeline is single-threaded on the main thread; long audio blocks the UI. **[REPORTED]** — same source

**The remediation that already exists and should be named:**

**Mesolitica / malaysia-ai publish Whisper models fine-tuned on Malaysian audio** — `malaysian-whisper-small-v2/v3`, `malaysian-whisper-medium`, trained on IMDA STT, pseudolabelled Malaysian YouTube, the Malay Conversational Speech Corpus and Nusantara audiobooks; v3 is described as offering better handling for **Malay, Manglish, Mandarin, Tamil**. A Malay–Singlish code-switching finetune also exists. **[REPORTED]** — [Malaysian Whisper collection](https://huggingface.co/collections/mesolitica/malaysian-whisper-6590b6b733d72b44f0cfae79), [malaysian-whisper-small-v3](https://huggingface.co/mesolitica/malaysian-whisper-small-v3), [malaya-speech](https://github.com/malaysia-ai/malaya-speech/releases)

Not a build item in the current window. But naming it turns the Known Limitation from a shrug into a costed roadmap item, which reads completely differently to a reviewer.

---

## 4. Documentation Compelled by Panel/MCO Billing Rather Than Clinical Need

### 4.1 Panel Work Is the Majority of Malaysian GP Practice

- "Currently about **60 per cent of GP clinics are seeing third-party administrator (TPA)-related cases**" — PMPS President Dr Kirubakaran Malapan. And per MMA, "**six in 10 patients seen by GPs come from TPAs and companies that pay doctors below RM35**." **[VERIFIED]** — [CodeBlue, Oct 2025 GP town hall](https://codeblue.galencentre.org/2025/10/at-town-hall-gps-demand-fee-revision-to-rm40-to-rm125/)
- FPMPAM: private clinic doctors "once managed 60% of outpatient visits but now their patient numbers are falling." **[REPORTED]** — [FMT, Nov 2024](https://www.freemalaysiatoday.com/category/nation/2024/11/18/private-clinic-doctors-threaten-rm20-surcharge-over-new-price-display-rule)
- "About **30 TPAs** currently managing the health benefits of employees," each with its own registration procedure, claim submission process and documentation; registration fees RM100–RM2,500, plus monthly admin fees, per-claim submission fees, payment fees, and mandatory **terminal rental at the clinic**; payment delayed 3–6 months. **[VERIFIED]** — [Malaysiakini letter](https://www.malaysiakini.com/letters/328416). Note this is an opinion letter, not a study — but the operational picture it describes is consistent with everything else here.

**Verified TPA/MCO names** (the brief asked for verification, not guesses): **PMCare** (self-described pioneer/leading TPA — [pmcare.com.my](https://www.pmcare.com.my/)), **MediExpress**, **MiCare** ([eclaims.micaresvc.com](https://eclaims.micaresvc.com/)), **Medilink-Global** ([medilink-global.com](https://www.medilink-global.com/)), **HealthMetrics**, **WeCare TPA** ([wecaretpa.com](https://www.wecaretpa.com/)), **Selcare** ([CodeBlue](https://codeblue.galencentre.org/2024/03/selcare-isnt-your-typical-tpa-with-fast-payments-no-consultation-fee-cap/)), **MediJaring**, **Compumed**, **Emas**, **HealthConnect** (last four **[REPORTED]** from [Mayflax panel-clinic guide](https://mayflax.com/becoming-a-panel-clinic/) only). **Mednefits** is payer-side but is a benefits platform, not a classical TPA. **ProtectHealth** is the government-scheme administrator.

### 4.2 What the Panel Claim Actually Demands

**The claim workflow (verified shape):**

1. Receptionist verifies eligibility "via the insurer or MCO portal" — annual benefit limit, employment still active
2. Consultation "proceeds exactly as a regular visit"
3. Medication dispensed, tests ordered if needed
4. "**The clinic records all items for the claim**"
5. Patient signs the claim form authorising direct billing; no bill for covered services

**[VERIFIED]** — [Klinik Muhibbah panel guide](https://klinikmuhibbah.com/guides/insurance-panel-clinic-guide)

**The submission channel is a TPA portal, not the clinic's EMR:**

- PMCare panel clinics submit through **Mediline** (pmcare4u.com.my) for member verification, claims submission and status; clinics "are required to have an Internet-ready computer system to implement the Mediline applications"; submissions carry a **RM0.20 processing fee**; manual submission within 30 days of month-end attracts **RM2.00 per transaction**. **[REPORTED]** — from search snippets of the [PMCare panel GP terms PDF](https://www.mediline.com.my/popalert/WGGPClinics_Revision7.pdf) and [PMCare partner page](https://www.pmcare.com.my/?page_id=21187). The PDF is binary-encoded; I could not fetch and quote its clauses directly. **Do not quote clause numbers.**
- The government's Madani Medical Scheme uses **PRIMIS** (Primary Care Information System), a free web-based provider portal run by ProtectHealth, on a fee-for-service basis; panel clinics need "a telephone line, Internet access, computer and printer." **[REPORTED]** — [ProtectHealth](https://protecthealth.com.my/skimperubatanmadani/), [primis-provider.protecthealth.com.my](https://primis-provider.protecthealth.com.my/)

**What fields the claim record contains — the most interesting single finding:**

A peer-reviewed study of **83,556 outpatient visits by 10,150 employees (Jan 2016 – Aug 2019)** drawn from the **PMCare database** lists the captured fields as: _"claim codes, dates of clinic visit, patient codes, medicine costs, consultation fees, total costs, medicine names and doses, the treatment duration, and the number of tablets prescribed."_ **[VERIFIED]** — [Trends in the Cost of Medicines, Consultation Fees and Clinic Visits in Malaysia's Private Primary Healthcare System, _PMC10284298_](https://pmc.ncbi.nlm.nih.gov/articles/PMC10284298/)

**[INFERRED — flagged carefully]** That field list is **billing and dispensing data with no clinical narrative and no diagnosis field named**. Absence from one study's field list is not proof the claim carries no diagnosis, and I could **not** verify whether Malaysian panel GP claims require ICD-10 or any diagnosis coding — **[UNVERIFIED]**, and the answer is behind private panel agreements, so it is not obtainable in this window. But the direction is clear: what the payer wants is _what was given and what it cost_, not _what the doctor reasoned_.

The same study's caveat is also instructive: "only drug charges within the coverage (≤RM 45) were captured in the database, whereas excess charges covered out-of-pocket by the patients themselves were not recorded." **[VERIFIED]** — the payer record is not even a complete billing record, let alone a clinical one.

### 4.3 The TPA Also Constrains the Clinical Decision Itself

FPMPAM states that "**referrals, investigations, medication choices, and even treatment quantities were subject to TPA validation and approval**," calling it "unauthorised intrusion into medical decision-making, not benefit management," and adding that "No call centre or administrative officer should override or delay a doctor's clinical judgement." It attributes GP fees anchored at RM30–RM35 to "decades-old fee ceilings and strict TPA reimbursement controls." **[VERIFIED]** — [CodeBlue, Dec 2025](https://codeblue.galencentre.org/2025/12/managed-care-achieves-lower-costs-by-restricting-care-says-fpmpam/)

**[INFERRED]** So the plan a Malaysian GP writes is partly a negotiation artifact with a TPA, not a pure clinical statement. A CatatMD-generated Plan that recommends an investigation the panel will not approve is not merely unhelpful — it creates work.

### 4.4 The Medical Certificate

A Malaysian MC carries: patient name and NRIC/passport number, doctor's name and MMC registration number, date of consultation and date of issuance, dates and duration of sick leave, and clinic name/address/contact. **[REPORTED]** — [Klinik Muhibbah teleconsult MC page](https://klinikmuhibbah.com/teleconsultation/online-mc-malaysia), [drcertificate.com](https://drcertificate.com/my/medical-certificates-online-in-malaysia/)

**[INFERRED]** For acute URTI — CatatMD's exact clinical scope — the MC is very often the artifact the _patient_ actually came for, and MC days is the single most consequential number the GP writes. It is also directly PHI-bearing (NRIC), which intersects the de-identification boundary.

### 4.5 Tax-Driven Documentation: LHDN e-Invoice

| Phase | From       | Turnover band                                  |
| ----- | ---------- | ---------------------------------------------- |
| 1     | 1 Aug 2024 | > RM100m                                       |
| 2     | 1 Jan 2025 | RM25m – RM100m                                 |
| 3     | 1 Jul 2025 | RM5m – RM25m                                   |
| 4     | 1 Jan 2026 | RM1m – RM5m (relaxation period to 31 Dec 2026) |
| 5     | 1 Jul 2026 | RM500k – RM1m — **reportedly eliminated**      |

- IRB exempted businesses below RM500,000 and delayed the RM1m–RM5m group to 2026. **[VERIFIED]** — [Malay Mail, 6 Jun 2025](https://www.malaymail.com/news/malaysia/2025/06/06/irb-malaysia-exempts-businesses-below-rm500000-from-e-invoicing-delays-mandate-for-rm1m-to-rm5m-group-to-2026/179391), [FMT](https://www.freemalaysiatoday.com/category/nation/2025/06/05/govt-revises-e-invoicing-deadlines-for-businesses-earning-below-rm5mil)
- A further Cabinet decision on 6 Dec 2025 reportedly raised the exemption threshold to **RM1,000,000**, eliminating the July 2026 phase. **[REPORTED — single source]** — [ClearTax](https://www.cleartax.com/my/en/different-phases-implementation-timelines-einvoicing-malaysia). Verify against LHDN before stating this anywhere public.
- Healthcare services use the **Exempt (E)** SST tax code. **[REPORTED]** — [einvoicingmalaysia.com](https://einvoicingmalaysia.com/guides/e-invoicing-for-healthcare)

**[INFERRED]** Rough arithmetic: a solo GP seeing ~40 patients/day at ~RM60/visit over ~300 days ≈ RM720k turnover — i.e. **below** the reported RM1m exemption. So the very clinics most likely to still be lightly digitised are also the ones the e-invoice mandate does _not_ force to buy software. The tax lever pushes group practices and chains, not solo GPs. This is my arithmetic, not a sourced figure — do not publish the numbers.

### 4.6 Does Billing Shape the Note More Than Clinical Convention?

**Yes.** The dominant documentation pressures on a Malaysian private GP, ranked:

1. **TPA claim** (~60% of patients) — itemised drugs, doses, quantities, consultation fee, eligibility, pre-approvals
2. **MC** — days, NRIC, MMC number
3. **Dispensing/inventory** — clinic economics depend on it
4. **Tax e-invoice** — where above threshold
5. **The clinical narrative** — required professionally, but the least externally audited of the five

**[INFERRED]** CatatMD's SOAP note serves #5 and touches none of #1–#4. That is not a fatal flaw for a prototype whose stated value is safety and documentation quality — but it does mean nobody outside the room is _demanding_ this artifact, which is exactly why the copy-paste boundary is survivable and why the time-saving pitch is not.

---

## 5. What Could Not Be Established (And Isn't Worth Chasing Now)

Stated so nobody re-runs this work:

| Gap                                                       | Why it isn't worth chasing                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Market share of any Malaysian GP CMS                      | No public study exists. Wouldn't change the write-back decision — no vendor is dominant enough to integrate with regardless |
| Whether panel claims require ICD-10                       | Behind private panel agreements. Doesn't change a 72-hour build                                                             |
| Quantified code-switch rate in Malaysian GP consultations | Literature gap. Report it as a gap; do not invent a number                                                                  |
| Exact PMCare/Mediline claim schema                        | Binary PDF + behind panel agreements                                                                                        |
| Fine-tuning or self-hosting a Malaysian Whisper           | Not a short-window task. Name it as roadmap, don't attempt it                                                               |

---

## What This Changes

Concrete deltas only. Everything here is doable in the current window unless marked otherwise.

### PRD — Non-Goals

- **Change the _justification_, keep the non-goal.** "No EMR write-back" should stop reading as MVP triage and start reading as a market fact: _there is no write-back rail in Malaysian private primary care — the market is a long tail of small vendors with no published API standard, and the national interoperability layer (MDHCN / Malaysia Patient Summary, "One Person One Record") reaches private hospitals from January 2027, not GP clinics._ Cite the MOF release. This converts the project's weakest-looking boundary into its most defensible one.
- **Drop "PDF/print export" from the primary export set, or demote it.** In a clinic under e-invoicing pressure with claims flowing through TPA portals, a printed SOAP note has no consumer and creates an unfiled PHI-bearing artifact. Replace as the second export with **structured JSON** — near-zero build cost, and it is the direct answer to "how would this ever reach an EMR?"

### PRD / TRD — Export Surface (highest-leverage single change)

- **Replace one "Copy note" button with segmented copy: S / O / A / P individually, plus a one-line encounter summary.** Malaysian GP CMS note fields are small free-text boxes inside dispensing-and-billing-first software; a doctor pasting into one will paste fragments, not a document. This is a small UI change with a large workflow effect.

### PRD — Positioning

- **Stop positioning on time saved; position on documentation quality and the safety net.** For a 3-minute URTI consult against a GP who already writes "URTI, T39, PCM QID, MC 2/7", a review-edit-paste loop plausibly _costs_ time. Red-flag detection and missing-information prompts are the defensible value. Add an explicit acceptance target: **an approved note in under 30 seconds** in the demo.

### PRD — Known Limitations (language)

- **Split the single "English-only" limitation into two, because they are not equally serious:**
  - _Output language:_ not a limitation. Malaysian clinical records are written in English regardless of the language spoken in the room.
  - _Input language:_ the real limitation. Malay/Manglish/dialect code-switching degrades ASR, and the transcript is upstream of every safety control in the system.
- **Do not state a code-switching percentage.** No quantified figure exists for Malaysian GP consultations. Say so — it reads as rigour, not as a gap.
- **Name `mesolitica/malaysian-whisper-*` as the identified remediation path.** Turns a shrug into a costed roadmap item.

### TRD — ASR and Threat Model

- **Always pass an explicit `language` parameter to Whisper. Never rely on auto-detect.** Whisper's documented default on code-switched audio without a language parameter is to _translate_ rather than transcribe — producing fluent, plausible English that is not what was said.
- **Add silent-translation to the TRD threat model.** The de-identification gate, deterministic red-flag engine, and ID-constrained citations all sit downstream of the transcript and cannot detect a paraphrased input. This is a genuine architectural gap worth one paragraph.
- **Make pasted text the primary demo path; browser ASR is the "also works" path.** Browser-viable Whisper is tiny/small-class (~75–240MB), 30-second-window with boundary hallucination, single-threaded by default. Demoing live ASR on code-switched Malaysian speech is a self-inflicted wound.
- **Surface a low-confidence indicator on ASR output** so the doctor is cued to check the transcript, not just the note.

### PRD — Explicitly Out of Scope (name it, don't build it)

- **A claim/MC-facing output** (one-line reason for encounter, MC days, referral/follow-up flag) would be the single highest-value addition for a real Malaysian GP, because ~6 in 10 patients are panel cases and the MC is often what the patient came for. **Do not build it in this window**, and note the collision risk: generating MC duration or a diagnosis label invites rubber-stamping and cuts against "the system never diagnoses." Recording what the doctor decided is safe; deciding it is not.
- **Note the TPA constraint in the Plan section's limitations:** referrals, investigations, medication choices and quantities are subject to TPA pre-approval in Malaysian panel practice, so a suggested investigation may be unactionable regardless of clinical merit.

### Nothing Changes For

- The clinical scope (adult GP, acute cough / sore throat / URTI) — settled, and it is the right scope: high-volume, MC-generating, and the exact consultation type where panel economics bite hardest.
- The PHI boundary, the deterministic-first red-flag design, and the ID-constrained citation design. Nothing in this research touches them except to note that all three sit downstream of a transcript that may be wrong — which is a TRD paragraph, not a redesign.

---

## Source Index

Primary sources fetched and read directly are marked **[VERIFIED]** in-line. All URLs cited above:

- [Naim et al., healthcare digitalisation policies in Malaysia 1985–2025, _DIGITAL HEALTH_](https://pmc.ncbi.nlm.nih.gov/articles/PMC12227897/)
- [Trends in Cost of Medicines, Consultation Fees and Clinic Visits in Malaysia's Private Primary Healthcare (PMCare data)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10284298/)
- [MOF — JBMKKS / MediAsas / MDHCN press release, 6 July 2026](https://www.mof.gov.my/portal/en/news/press-release/press-release-jbmkks-mediasas-060726)
- [CodeBlue — GP town hall, fee revision demand, Oct 2025](https://codeblue.galencentre.org/2025/10/at-town-hall-gps-demand-fee-revision-to-rm40-to-rm125/)
- [CodeBlue — FPMPAM on managed care, Dec 2025](https://codeblue.galencentre.org/2025/12/managed-care-achieves-lower-costs-by-restricting-care-says-fpmpam/)
- [CodeBlue — MMA-MCMC digitalisation initiative, Mar 2024](https://codeblue.galencentre.org/2024/03/mma-mcmc-launch-digitalisation-initiative-for-private-gps/)
- [CodeBlue — mandatory prescription / dispensing separation, Aug 2025](https://codeblue.galencentre.org/2025/08/mandatory-prescription-sparks-doctors-fury-dispensing-separation-fears/)
- [CodeBlue — Selcare TPA profile, Mar 2024](https://codeblue.galencentre.org/2024/03/selcare-isnt-your-typical-tpa-with-fast-payments-no-consultation-fee-cap/)
- [Malay Mail — GP fee floor RM10 / ceiling RM80, Oct 2025](https://www.malaymail.com/news/malaysia/2025/10/11/health-minister-says-rm10-still-the-floor-price-for-doctor-visits-but-ceiling-raised-to-rm80/194240)
- [Malay Mail — IRB e-invoicing exemption/delay, Jun 2025](https://www.malaymail.com/news/malaysia/2025/06/06/irb-malaysia-exempts-businesses-below-rm500000-from-e-invoicing-delays-mandate-for-rm1m-to-rm5m-group-to-2026/179391)
- [FMT — revised e-invoicing deadlines, Jun 2025](https://www.freemalaysiatoday.com/category/nation/2025/06/05/govt-revises-e-invoicing-deadlines-for-businesses-earning-below-rm5mil)
- [ClearTax — e-invoicing phases and reported Dec 2025 threshold change](https://www.cleartax.com/my/en/different-phases-implementation-timelines-einvoicing-malaysia)
- [EInvoicingMalaysia — healthcare e-invoicing guide](https://einvoicingmalaysia.com/guides/e-invoicing-for-healthcare)
- [MedicalMet — LHDN e-Invoice guide for clinics](https://medicalmet.com/blog/lhdn-e-invoice-complete-guide-clinics/)
- [Malaysiakini — letter on regulating TPAs](https://www.malaysiakini.com/letters/328416)
- [PMCare](https://www.pmcare.com.my/) · [PMCare partner page](https://www.pmcare.com.my/?page_id=21187) · [PMCare panel GP terms PDF](https://www.mediline.com.my/popalert/WGGPClinics_Revision7.pdf)
- [MiCare eClaims](https://eclaims.micaresvc.com/) · [Medilink-Global](https://www.medilink-global.com/) · [WeCare TPA](https://www.wecaretpa.com/)
- [ProtectHealth — Skim Perubatan MADANI](https://protecthealth.com.my/skimperubatanmadani/) · [PRIMIS provider portal](https://primis-provider.protecthealth.com.my/)
- [Mayflax — becoming a panel clinic](https://mayflax.com/becoming-a-panel-clinic/) · [Klinik Muhibbah — panel clinic guide](https://klinikmuhibbah.com/guides/insurance-panel-clinic-guide) · [Klinik Muhibbah — online MC](https://klinikmuhibbah.com/teleconsultation/online-mc-malaysia)
- [Mednefits](https://www.mednefits.com/about-us) · [HR News on Mednefits Series A](https://hrnews.my/2020/11/19/mednefits-concludes-series-a-rm24-million-funding-enhancing-employee-benefits-in-malaysia/)
- [kumoDoc](https://www.kumodoc.com/) · [Desk Clinic](https://desk.clinic/malaysia) · [Clinex](https://www.clinexmy.com/) · [MocDoc Malaysia](https://mocdoc.com/malaysia) · [EasyClinic](https://www.easyclinic.io/emr-software-in-malaysia/) · [CLINICA](https://clinica.com.my/best-clinic-management-system-malaysia-2026-guide/) · [Curo](https://curo.com.my/blog/best-clinic-management-system-malaysia) · [GPiS Solutions](http://www.gpissolutions.com/usr/page.aspx?pgid=2) · [MyClinic](https://www.myclinichealthcare.com/) · [SoftwareSuggest Malaysia listing](https://www.softwaresuggest.com/clinic-management-software/malaysia)
- [Qmed Asia](https://qmed.asia/our-story) · [Qmed enterprise](https://hello.qmed.asia/about-us)
- [Qualitas Health Group](https://qualitashealthgroup.com/overview/) · [Sojitz investment release](https://www.sojitz.com/en/news/article/20210301.html)
- [The Vibes — MOH primary care EMR by 2027](https://www.thevibes.com/articles/lifestyles/120041/moh-to-complete-electronic-medical-records-rollout-in-primary-care-by-2027) · [OpenGov Asia — CCMS](https://archive.opengovasia.com/2025/02/10/malaysia-cloud-based-management-and-ai-enhance-healthcare/?c=us) · [The Sun — CCMS waiting times](https://thesun.my/news/malaysia-news/people-issues/cloud-based-clinical-management-system-reduces-patient-waiting-times-in-health-clinics-to-under-60-minutes/) · [PhIS Portal — CCMS-PhIS integration](https://phisportal.moh.gov.my/photo_gallery/pelaksanaan-pengintegrasian-ccms-phis)
- [ServiceNow-AI — frontier ASR on code-switched speech](https://huggingface.co/blog/ServiceNow-AI/code-switching)
- [Mesolitica Malaysian Whisper collection](https://huggingface.co/collections/mesolitica/malaysian-whisper-6590b6b733d72b44f0cfae79) · [malaysian-whisper-small-v3](https://huggingface.co/mesolitica/malaysian-whisper-small-v3) · [malaya-speech](https://github.com/malaysia-ai/malaya-speech/releases)
- [WhisperSTT — browser transcription internals](https://whisperstt.com/blog/transcribe-audio-in-browser/) · [OfflineTTS — browser STT landscape](https://offlinetts.com/blog/browser-speech-recognition-whisper-comparison/) · [transformers.js WebGPU vs WASM issue](https://github.com/huggingface/transformers.js/issues/894)
- [EF EPI Malaysia fact sheet 2024](https://www.ef.com/assetscdn/WIBIwq6RdJvcD9bc8RMd/cefcom-epi-site/fact-sheets/2024/ef-epi-fact-sheet-malaysia-english.pdf) · [The Star — EF EPI 2025](https://www.thestar.com.my/news/education/2025/11/21/malaysians-lead-asia-in-english-proficiency-says-survey) · [Malaysian Reserve — EF EPI 2025](https://themalaysianreserve.com/2025/11/21/malaysia-ranks-among-aseans-most-english-proficient-countries-after-singapore/)
- [Manglish X-post corpus, _Data in Brief_](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10820639/) · [MDPI _Languages_ — Malay-English code-switching patterns](https://www.mdpi.com/2226-471X/7/4/299) · [MDPI _Languages_ — code-switching in doctor–patient communication (Galician)](https://www.mdpi.com/2226-471X/9/6/209) · [HKU — multilingualism in Malaysia](https://fieldtrip-malaysia2019.linguistics.hku.hk/multilingualism-in-malayisa)
- [MMC — Medical Records and Medical Reports (PDF, not text-extractable)](https://mmc.gov.my/wp-content/uploads/2025/09/Medical-Records-Medical-Reports.pdf)
- [Awareness and Perception Towards Dispensing Separation in Malaysia](https://pmc.ncbi.nlm.nih.gov/articles/PMC7909346/)
- [Statista — number of private medical clinics in Malaysia](https://www.statista.com/statistics/1464154/malaysia-number-of-private-medical-clinics/)
