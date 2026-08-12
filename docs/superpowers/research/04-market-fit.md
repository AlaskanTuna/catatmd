# 04 — Market Fit: Malaysian Private Primary Care

> Research stream: who pays, what they can pay, and who we are actually competing against in Malaysian private GP.
> Compiled 13/08/26. Every claim carries a URL. **VERIFIED** = read from the cited source. **INFERRED** = my reasoning over verified inputs, labelled as such.
> This is a prototype to be evaluated by an external party; the market framing exists to shape the proposal narrative, not to justify a business plan.

---

## Executive Answer

| Question                        | Answer                                                                                                                                                                                                                      | Confidence |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Who buys?**                   | The solo/small-group **owner-operator GP** — legally required to be a registered medical practitioner. Buyer and user are the same person. Chains are a small share of clinic count and a long, centralised sale.           | High       |
| **Who actually pays for care?** | Not the patient. **~60% of GP clinic patients arrive via TPAs and corporate panels**, which cap the consultation at roughly **RM34**.                                                                                       | High       |
| **What price will it bear?**    | Anchored to the **whole clinic management system at RM45–RM179/clinic/month**, not to Western per-clinician scribe pricing.                                                                                                 | High       |
| **Who is the incumbent?**       | **Confirmed — and worse than hypothesised.** Malaysian CMS vendors already ship AI SOAP notes bundled at no extra charge, _and_ a funded regional scribe (Heidi) opened a Singapore SEA hub two weeks ago with a free tier. | High       |

---

## 1. Who Pays

### 1.1 The Legal Owner Is Always a Doctor

**VERIFIED.** Under the Private Healthcare Facilities and Services Act 1998 (Act 586), a certificate of registration for a private medical clinic may only be issued to a **registered medical practitioner**. A body corporate can hold a clinic only if **at least one board member is a registered medical practitioner**. ([Chambers and Partners — regulatory framework](https://chambers.com/articles/regulatory-framework-for-setting-up-private-healthcare-facilities-and-services-in-malaysia), [Act 586 text](https://rehdaselangor.com/wp-content/uploads/Act-586.pdf))

**Implication (INFERRED):** Malaysia has no equivalent of a non-clinical clinic-ownership market. The default buyer is a doctor-owner spending their own money, in a single-decision-maker sale — good for a prototype's go-to-market story, bad for deal size.

### 1.2 The Real Payer Is the TPA / Corporate Panel, Not the Patient

**VERIFIED figures:**

| Fact                                                        | Figure                                               | Source                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share of GP clinic patients arriving via TPAs and companies | **~60%**                                             | [CodeBlue, Oct 2025 — GP town hall](https://codeblue.galencentre.org/2025/10/at-town-hall-gps-demand-fee-revision-to-rm40-to-rm125/)                      |
| PMCare (one TPA) average paid per panel GP visit, 2024      | **RM131** = RM100 medication + **RM34 consultation** | [CodeBlue, Nov 2025 — PMCare medical trend](https://codeblue.galencentre.org/2025/11/a-tpas-medical-trend-average-rm9300-hospitalisation-rm131-gp-visit/) |
| Same, Jan–Oct 2025                                          | RM134 = RM100 + **RM34**                             | ibid.                                                                                                                                                     |
| PMCare panel GP clinics nationwide                          | **5,280**                                            | ibid.                                                                                                                                                     |
| PMCare approved GP visits, 2024                             | **3.2 million** (of 4.2m total claims)               | ibid.                                                                                                                                                     |
| PMCare members, 2024                                        | 983,931                                              | ibid.                                                                                                                                                     |

**VERIFIED — the newest payer entrant.** In August 2026 AIA launched a primary-care benefit in _A-Plus Health360_ capped at **RM50 per visit** (consultation + medication), 3 visits/year — claimed as the **first GP benefit from any Malaysian insurer**. MMA publicly rejected RM50 as a benchmark. ([CodeBlue, 10 Aug 2026](https://codeblue.galencentre.org/2026/08/mma-slams-insurers-rm50-limit-for-gp-visits/))

**VERIFIED — the government as payer.** _Skim Perubatan MADANI_ pays participating private GPs fee-for-service: consultation + medication capped at **RM70** (consultation ≤ RM35), labs RM50, procedures RM50, **max RM170/visit**; clinics may not top up the patient. Claims run through **PRIMIS**, a _free_ government web-based system operated by ProtectHealth. **1,205 clinics** registered, across **10 districts** only. ([ProtectHealth](https://protecthealth.com.my/skimperubatanmadani/), [clinic count](https://ecentral.my/skim-perubatan-madani/))

**VERIFIED — academic corroboration.** Analysis of 83,207 employer-insured visits across 1,668 Malaysian panel clinics (Jan 2016–Aug 2019) found consultation fees rose RM10.65 → RM22.78 while medicine cost _fell_ RM34.61 → RM20.85, total per visit ~RM42 against an **RM45 coverage cap**. The authors conclude GPs trade medicine spend against consultation fee to stay under the cap. ([J Multidiscip Healthc, PMC10284298](https://pmc.ncbi.nlm.nih.gov/articles/PMC10284298/))

> **The single most important payer fact (INFERRED from the above):** in the dominant panel channel a GP's _consultation_ is worth about **RM34**, and roughly three-quarters of the visit's value is dispensed medication. Any tool sold on "better documentation" is being sold against a RM34 line item that the doctor does not price.

### 1.3 Chains: Real, but a Small Slice of Clinic Count

**VERIFIED chain sizes** (note: mixed clinic types, self-reported, different dates):

| Group             | Scale                                                                                                                                                                | Source                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mediviron**     | "over 232 clinics" across 8 west-coast states                                                                                                                        | [mediviron.com.my](https://mediviron.com.my/about-mediviron/)                                                                                                                                                                                                                           |
| **BP Healthcare** | "more than 120 medical centers"                                                                                                                                      | [BP Healthcare](https://bpgroup.bphealthcare.com/overview/)                                                                                                                                                                                                                             |
| **CareClinics**   | "over 100 primary care clinics", targeting 200; signed an MOU with **HIMSS (13 Sep 2024)** to build its EMR to global standards                                      | [HIMSS](https://www.himss.org/news-center/careclinics-health-services-sb-partners-himss-drive-digital-health-transformation-malaysia/), [Healthcare IT News](https://www.healthcareitnews.com/news/asia/malaysian-primary-care-giant-careclinics-partners-himss-digital-transformation) |
| **Qualitas**      | claimed **20% share of the GP _clinic chain_ market**, 1.2m annual patient visits; targeting 500 clinics group-wide — **figures are from 31 May 2019 and are stale** | [Qualitas](https://qualitashealthgroup.com/qualitas-targets-500-clinics-by-2022/)                                                                                                                                                                                                       |
| Qualitas capital  | Sojitz Corporation injected new capital, announced 2021                                                                                                              | [Sojitz](https://www.sojitz.com/en/news/article/20210301.html)                                                                                                                                                                                                                          |

**INFERRED:** summing the named groups gives roughly **450–600 clinics** against a national registry of 11,000+ — i.e. **chains are a low-single-digit percentage of registered private clinic count**, even allowing for groups I did not find. Qualitas's "20% market share" is share _of the chain segment_, not of all GP clinics; do not restate it as a market share of Malaysian primary care.

**INFERRED — who decides at a chain.** CareClinics is building its own EMR to HIMSS standards; a group at that stage buys a platform, not a feature. Expect a corporate/CIO procurement cycle, integration requirements, and a long sales motion. **Not a 72-hour narrative asset.**

**NOT VERIFIED:** I found **no published solo-vs-chain split** of Malaysia's registered clinics. A CodeBlue commentary states only that "a significant proportion of GP clinics function as small, single-practitioner operations, often with limited diagnostic facilities" and restricted hours ([CodeBlue, Mar 2026](https://codeblue.galencentre.org/2026/03/outpatient-overload-can-private-gps-relieve-malaysias-public-hospitals-dr-mohamed-rafick-khan/)). Do not put a percentage in the proposal.

---

## 2. Clinic Population, Staffing, and Revenue Pressure

### 2.1 How Many Clinics

**VERIFIED, with source disagreement — quote a range, not a point:**

| Figure                                                                              | As of       | Source                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **10,495** registered private medical clinics                                       | 31 Dec 2023 | MOH _Health Facts 2024_ — [PDF](https://www.moh.gov.my/moh/resources/Penerbitan/Penerbitan%20Utama/HEALTH%20FACTS/Health_Facts_2024.pdf) _(PDF returned HTTP 403 to direct fetch; figure taken from search indexing of the document — treat as strong but not first-hand)_ |
| **"more than 11,000"** registered clinics, **4,000+ opened in the last four years** | Jun 2025    | MPCAM via [CodeBlue](https://codeblue.galencentre.org/2025/06/mpcam-proposes-rm50-to-rm80-gp-consultation-fee/)                                                                                                                                                            |
| **11,190** registered private GP clinics (MOH data)                                 | Mar 2025    | Cited in CodeBlue coverage; _I could not open the primary MOH table — treat as secondary_                                                                                                                                                                                  |
| **"nearly 10,000 private general practitioners"**                                   | Apr 2026    | MMA via [CodeBlue](https://codeblue.galencentre.org/2026/04/gp-led-care-central-to-ageing-nation-strategy-mma)                                                                                                                                                             |
| **Statista**: >9,800 registered private health clinics                              | 2022        | [Statista](https://www.statista.com/statistics/1464154/malaysia-number-of-private-medical-clinics/)                                                                                                                                                                        |

**Safe phrasing for the proposal:** _"roughly 11,000 registered private medical clinics, staffed by close to 10,000 private GPs."_

**VERIFIED context:** private practices outnumber public clinics roughly **6:1**, yet public clinics handle the majority of outpatient visits — public facilities took **83% of total visits (19.6 million) in 2023**. ([CodeBlue, Mar 2026](https://codeblue.galencentre.org/2026/03/outpatient-overload-can-private-gps-relieve-malaysias-public-hospitals-dr-mohamed-rafick-khan/))

### 2.2 Revenue Pressure — The Decisive Numbers

**VERIFIED — MMA survey of nearly 2,000 GP clinics, reported 6 May 2026:**

| Monthly clinic revenue          | Share of clinics |
| ------------------------------- | ---------------- |
| Under RM20,000                  | **21.1%**        |
| RM20,000 – RM40,000             | **32.4%**        |
| **Under RM60,000 (cumulative)** | **over 70%**     |
| Above RM80,000 ("comfortable")  | 17.8%            |

MMA President Datuk Dr R. Thirunavukarasu: monthly earnings are "insufficient to cover basic operational expenses, including rent, staffing, and utilities," and MMA warned of a possible "wave of closures." ([SAYS, citing Berita Harian](https://says.com/my/news/malaysia-private-clinic-financial-crisis))

**VERIFIED — setup capital.** Opening a GP clinic runs **RM300,000–RM350,000** (renovation ~RM100k, equipment ~RM150k, drugs ~RM20k, licensing/registration ~RM6.5k, premises deposits ~RM24k). ([Mayflax](https://mayflax.com/cost-to-open-a-clinic-in-malaysia/))

**WEAK / SECONDARY — monthly opex.** A Malaysian practice-management blog gives approximate monthly figures of rent ~RM4,000, maintenance ~RM1,000, staff salaries ~RM6,000. The source ([Disruptive Doctors](https://disruptive-doctors.com/how-much-does-it-cost-to-build-run-a-gp-clinic-in-malaysia/)) **returned HTTP 403 to direct fetch**; figures come from search indexing only. **Do not put these in the proposal as fact.**

**NOT VERIFIED:** typical headcount per clinic. No authoritative Malaysian source found for staff-per-clinic. Do not state one.

### 2.3 Consultation Fee Regulation — Just Changed, and That Is the "Why Now"

**VERIFIED timeline:**

- Consultation fees sat at **RM10–RM35** under **Schedule 7** of the Private Healthcare Facilities and Services Regulations 2006 — unchanged for over three decades (MMA originally proposed the RM10–RM35 band in 1992). ([CodeBlue, May 2025](https://codeblue.galencentre.org/2025/05/decentralised-approach-to-new-clinic-fees-shifts-balance-of-power/))
- Through 2025 the profession pushed for **RM40–RM125** (town hall), **RM50–RM80** (MPCAM, with a 3-yearly review mechanism), and **RM50–RM150** (another doctors' group). ([town hall](https://codeblue.galencentre.org/2025/10/at-town-hall-gps-demand-fee-revision-to-rm40-to-rm125/), [MPCAM](https://codeblue.galencentre.org/2025/06/mpcam-proposes-rm50-to-rm80-gp-consultation-fee/), [RM50–150 demand](https://codeblue.galencentre.org/2025/03/doctors-group-demands-gp-fee-correction-to-rm50-to-rm150/))
- **Gazetted: P.U. (A) 150/2026 amending Schedule 7 — new range RM10–RM80, effective 2 April 2026.** First revision in over 30 years. ([Malay Mail, 3 Apr 2026](https://www.malaymail.com/news/malaysia/2026/04/03/private-gps-welcome-revised-rm10rm80-consultation-fee-after-30-year-freeze/214926), [MOH order page](https://www.moh.gov.my/en/publications-and-reports/policies-act-policies-guide-lines/akta-kesihatan/senarai-akta-kesihatan/private-healthcare-facilities-and-services-private-medical-clinics-or-private-dental-clinics-amendment-of-fee-schedule-order-2026-p-u-a-150))
- **The catch, VERIFIED:** the **floor stayed at RM10**. FPMPAM's president said real impact "will depend on how it is implemented in practice," flagging managed care and TPA arrangements where "pricing may not be fully market-driven." MMA separately warned the RM10 floor lets TPAs undercut doctors. ([Malay Mail](https://www.malaymail.com/news/malaysia/2026/04/03/private-gps-welcome-revised-rm10rm80-consultation-fee-after-30-year-freeze/214926), [CodeBlue, Oct 2025](https://codeblue.galencentre.org/2025/10/maintaining-rm10-gp-fee-floor-risks-tpa-undercutting-doctors-mma/), [CodeBlue, Apr 2026](https://codeblue.galencentre.org/2026/04/gp-fee-revision-impact-depends-on-tpa-arrangements-fpmpam/))

**INFERRED:** the ceiling doubled from RM35 to RM80 four months ago, but for the ~60% panel channel the _effective_ price is still whatever the TPA sets (~RM34 at PMCare). A GP's ability to actually charge toward RM80 depends on being able to **justify** a higher-complexity consultation — which is a documentation argument. That is the most honest "why now" available, and it is defensible.

### 2.4 Consultation Length (Weak Evidence)

Malaysian primary-care consultation duration studies give **~10.5 min**, **12–13 min**, and **18.2 min** means across different settings, largely public/hospital outpatient rather than private GP ([Malaysian Journal of Applied Sciences](https://journal.unisza.edu.my/myjas/index.php/myjas/article/download/268/105/), [MFP waiting/consultation time study](https://e-mfp.org/wp-content/uploads/an-assessment-of-patient-waiting-and-consultation-time-in-a-primary-healthcare-clinic.pdf)). **Do not build a time-saved ROI claim on these** — they are not private-GP data and they disagree.

**NOT VERIFIED at all:** any Malaysian measurement of _GP documentation burden_ (minutes/day on notes, after-hours charting). I found none. Every scribe ROI statistic in circulation is US/AU/UK. Say so rather than borrowing one.

---

## 3. Realistic Price Points

### 3.1 What Malaysian Clinics Currently Pay for Clinic Software

**VERIFIED vendor pricing (all published by the vendor):**

| Vendor                                 | Published price                                                              | AI included?                                                                                                                             | Source                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MedicalMet**                         | **RM45/month** (Solo), no setup fee, 30-day trial                            | **Yes — "AI treatment notes"** in the base plan                                                                                          | [MedicalMet](https://medicalmet.com/faq/what-is-the-best-clinic-management-software-for-small-clinics-in-malaysia/)                                                                               |
| **Clinica ERP**                        | **RM49/clinic/month**                                                        | Not stated                                                                                                                               | [Desk Clinic comparison](https://desk.clinic/blog/best-clinic-management-system-malaysia-2026)                                                                                                    |
| **Curo**                               | **from RM60/month**                                                          | Not stated                                                                                                                               | [Curo](https://curo.com.my/blog/best-clinic-management-system-malaysia)                                                                                                                           |
| **Cliniclah**                          | **from RM179/month per clinic**; Pro+ adds _unlimited_ AI consultation notes | **Yes — "AI consultation notes" (auto-drafts SOAP from the clinical conversation, doctor signs off) + AI X-ray reporting**; 108+ clinics | [Cliniclah pricing](https://www.cliniclah.com/en/pricing/) _(page returned HTTP 403 to direct fetch — details from vendor's own indexed page copy; verify before quoting in a client-facing doc)_ |
| **Desk Clinic**                        | Starter **US$59/mo**, Growth **US$179/mo**                                   | Not stated                                                                                                                               | [Desk Clinic](https://desk.clinic/malaysia)                                                                                                                                                       |
| Broad Malaysia listing (20 products)   | Mostly **US$14–29/month**; ZibRX **US$20/doctor**, self-described "AI-based" | Mostly no                                                                                                                                | [SoftwareSuggest Malaysia](https://www.softwaresuggest.com/clinic-management-software/malaysia)                                                                                                   |
| **PRIMIS** (government, MADANI claims) | **Free**                                                                     | No                                                                                                                                       | [ProtectHealth](https://protecthealth.com.my/skimperubatanmadani/)                                                                                                                                |

### 3.2 The Price Ceiling Argument

**INFERRED, but the arithmetic is from verified inputs:**

1. The **entire clinic management system** — scheduling, billing, EMR, dispensing, e-invoice compliance — sells for **RM45–RM179/clinic/month**.
2. **AI SOAP notes are already inside that price** at two of those vendors. The marginal price of AI documentation in Malaysia today is therefore **RM0**.
3. Western standalone scribes price per clinician per month in the US$99–199 band; at any recent MYR rate that is several hundred ringgit per doctor — **3–10x the whole Malaysian CMS**. That pricing does not transplant.
4. Against a **RM34** panel consultation, RM179/month is roughly **five panel consultations**; RM45/month is barely more than one. Those are the only honest units to reason in.
5. **Heidi Health publishes a genuinely free tier with "unlimited transcription"** ([Heidi pricing](https://www.heidihealth.com/pricing)). A standalone scribe's floor price globally is zero.

**Defensible band for the proposal (INFERRED, flag it as an estimate, not a finding):** a _differentiated_ documentation layer plausibly commands **RM50–RM200/clinic/month** as an add-on, or is bundled/OEM'd into a CMS. Anything above ~RM250/clinic/month needs a payer other than the doctor (a TPA, a chain, or the government scheme). **I found no Malaysian willingness-to-pay survey for AI scribes — this band is reasoning, not evidence.**

### 3.3 The Actual Wedge Is Compliance, Not AI

**VERIFIED:** LHDN **e-Invoice / MyInvois** is a phased mandate — RM100m (Aug 2024), RM25m (Jan 2025), RM500k (Jul 2025), with later phases repeatedly revised; December 2025 guidelines **raised the exemption threshold to RM1 million**, and a no-minimum-threshold phase is dated 1 July 2026. Penalties RM200–RM20,000 per non-compliant invoice under s.82C Income Tax Act 1967. ([ClearTax Malaysia](https://www.cleartax.com/my/en/e-invoicing-malaysia), [JomEinvoice](https://jomeinvoice.my/article/lhdn-e-invoice-malaysia-2026-complete-guide/), [MedicalMet healthcare guide](https://medicalmet.com/blog/lhdn-e-invoice-complete-guide-clinics/))

> **Sources disagree on the exact small-business thresholds and dates.** Do not state a specific clinic-level deadline in the proposal.

**INFERRED:** every Malaysian CMS vendor now leads with **MyInvois compliance**, not AI. Compliance is what forces a paper clinic onto software; AI is an upsell on top of an already-installed system. A standalone AI product has no forcing function of its own.

**VERIFIED context on the digitisation baseline:** as of 2019 only **7% of Malaysian health clinics** had clinical information systems ([EHR performance study, PMC7908801](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7908801/)). MOH has since extended a cloud clinic management system to ~**2,400–2,489 public primary care facilities**, with a national EMR / "one citizen one record" target of **2029**. ([Healthcare IT News](https://www.healthcareitnews.com/news/asia/malaysia-expanding-total-his-16-hospitals), [Malay Mail, Dec 2025](https://www.malaymail.com/amp/news/malaysia/2025/12/11/one-citizen-one-record-govt-to-roll-out-national-digital-health-system-by-2029-says-dzulkefly/201520))

---

## 4. Who Is the Incumbent — Hypothesis Test

> **Hypothesis:** the real competitor is the existing clinic-management-system vendor adding AI features, not a standalone AI scribe.
> **Verdict: CONFIRMED — and there is a second front the hypothesis missed.**

### 4.1 Malaysian CMS Vendors Already Shipping AI Documentation

| Vendor                              | AI documentation feature                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Cliniclah**                       | "AI consultation notes" — auto-drafts **SOAP notes from the clinical conversation**, doctor reviews and signs off. Pro+ tier = unlimited. Plus AI X-ray reporting. 108+ Malaysian clinics.                                                                                                                                                        | [Cliniclah](https://www.cliniclah.com/en/) _(403 on direct fetch; from vendor's indexed pages)_                     |
| **MedicalMet**                      | "AI treatment notes" bundled in the **RM45/month** Solo plan                                                                                                                                                                                                                                                                                      | [MedicalMet](https://medicalmet.com/faq/what-is-the-best-clinic-management-software-for-small-clinics-in-malaysia/) |
| **Qmed Asia (QueueMed Healthtech)** | **"Qmed Scribe"** — clinical notes, advertised "note ready in 4s". Plus **NORA** (care navigation), **MATA**, **AskCPG** (guideline lookup). Claims **500+ providers**, **ISO 9001 / 27001 / 13485**, and **MDA approval**. Separately describes "QmedCopilot" for differential diagnosis, care planning and automated medical document creation. | [hello.qmed.asia](https://hello.qmed.asia/), [Qmed company profile](https://qmed.asia/en/companyProfile)            |
| **EasyClinic**                      | AI-powered EMR; AI assistant completes prescriptions in three clicks; multilingual (Malay, English, Mandarin, Tamil)                                                                                                                                                                                                                              | [EasyClinic Malaysia](https://www.easyclinic.io/emr-software-in-malaysia/)                                          |

**Qmed is the sharpest signal in this whole document.** A Malaysian vendor is already shipping an AI scribe **plus a guideline-lookup product (AskCPG)** with **ISO 13485 and MDA approval** — i.e. it has already paid the regulatory entry cost for clinical software. That is close to CatatMD's exact feature surface, minus the de-identification boundary.

### 4.2 The Second Front: A Funded Regional Scribe Just Landed

**VERIFIED:**

- **Heidi Health opened its Southeast Asia regional headquarters in Singapore on 31 July 2026**, with planned investment of **up to US$8 million over 2–3 years** and 10–12 initial hires. It had already supported **~55,000 consultations in Singapore** before formal launch. Globally it cites **2m+ consultations/week, 110 languages, 116 countries**. ([Heidi Singapore launch](https://www.heidihealth.com/en-us/blog/singapore-launch), [StartupResearcher](https://www.startupresearcher.com/news/heidi-establishes-southeast-asia-hub-in-singapore))
- Heidi publishes a **free tier with unlimited transcription** ([pricing](https://www.heidihealth.com/pricing)).
- Malaysia is **not named** in Heidi's launch post. **INFERRED:** a Singapore SEA hub reaches Malaysian private GP within a normal expansion cycle; treat it as an entrant, not a hypothetical.

### 4.3 The Market Is at an Inflection Point Right Now

**VERIFIED:** the **MMA's 1st AI in Healthcare Conference** runs **15–16 August 2026** in Petaling Jaya, organised by MMA's AI & Digital Health Committee, themed _"AI with a Human touch"_, targeting **200+ senior decision-makers** including MOH. The page lists **no dedicated session on AI documentation or clinical scribes**. ([MMA Events](https://www.mmaevents.org/ai-healthcare-2026))

**INFERRED:** the profession is convening its _first_ AI conference this month, and clinical documentation is not yet on its agenda even though three local vendors are already selling it. The category is being sold before it is being discussed. That is a real, citable framing for the proposal — and it is two days out, so it is a live fact, not a stale one.

### 4.4 Regulatory Entry Cost (Flag, Do Not Deep-Dive)

**VERIFIED:** Malaysia's MDA applies medical-device premarket requirements to software meeting the statutory definition (diagnosis, prevention, monitoring, treatment). Software that "provides clinical recommendations, assists in diagnosis, or influences treatment decisions" is expected to be **Class B minimum, possibly Class C**, requiring a CSDT dossier. MDA launched Malaysia's **first regulatory sandbox for medical devices, focused on AI**, in 2025. ([TrustedTraceMed on MDA SaMD](https://trustedtracemed.com/resources/malaysia-mda-medical-device-registration.html), [Pure Global — MDA AI sandbox](https://www.pureglobal.com/news/malaysia-mda-launches-first-regulatory-sandbox-for-medical-devices-2025), [MDA portal](https://portal.mda.gov.my/index.php/industry/medical-device-registration/medical-device-registration-information))

**INFERRED:** "cited clinical suggestions" is the feature most likely to pull the product across the SaMD line; "structured note + missing-info prompts" is much less likely to. The project's existing stance — doctor approves every output, never diagnoses, suggestions are ID-constrained references rather than recommendations — is the right posture and should be stated _as a regulatory position_, not only a safety one. Qmed holding ISO 13485 + MDA approval is evidence the bar is real and clearable.

---

## 5. What I Could Not Verify

State these as unknowns rather than filling them in:

| Gap                                                                    | Why it matters                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Solo vs chain split** of the ~11,000 registered clinics              | Determines whether the buyer is one doctor or a procurement committee. No published figure found.    |
| **Malaysian GP documentation-time burden**                             | Every scribe ROI number in existence is US/AU/UK. There is no local baseline to cite.                |
| **Willingness to pay for AI scribes in Malaysia**                      | No survey found. The RM50–RM200 band in §3.2 is reasoning, not evidence.                             |
| **Cliniclah and Curo pricing pages** returned HTTP 403 to direct fetch | Prices came from indexed copies of the vendors' own pages. Re-verify before any client-facing quote. |
| **MOH Health Facts 2024 PDF** returned HTTP 403                        | The 10,495 figure is strong but not first-hand.                                                      |
| **e-Invoice thresholds for the smallest clinics**                      | Sources contradict each other on dates and amounts.                                                  |
| Qualitas's current Malaysian clinic count                              | Only a 2019 press figure exists publicly.                                                            |

---

## What This Changes

Five concrete deltas. Everything else in this document is supporting evidence.

**1. PRD "Who It Is For" — name the buyer and the payer separately.**
Current framing ("Malaysian private GPs") is one step too coarse. Replace with: _the doctor-owner of a solo or small private GP clinic — who, under Act 586, must be a registered medical practitioner, and is therefore both the user and the purchaser_ — and add a second line naming the **payer environment**: ~60% of visits arrive through TPA/corporate panels that price the consultation near RM34. Two verified facts, one sentence each, and they make the "who it is for" section specific rather than generic.

**2. Proposal narrative — stop leading with the scribe. Lead with the boundary.**
The scribe function is **already commoditised in Malaysia**: bundled free inside a RM45/month CMS (MedicalMet), inside a RM179/month CMS (Cliniclah), and shipped by an MDA-registered local vendor (Qmed Scribe). A funded regional player with a free tier just opened a Singapore SEA hub. Positioning CatatMD as "an AI scribe" walks into a fight it loses on price and distribution. Positioning it as **the de-identification gate + deterministic red-flag engine + ID-constrained citations** — the three things no bundled CMS AI feature demonstrably does — is the only differentiated claim available, and it happens to be exactly what the architecture already is. This is a framing change to the proposal's opening, not a scope change.

**3. Add a "why now" paragraph anchored on the April 2026 gazette.**
**P.U. (A) 150/2026 raised the Schedule 7 consultation ceiling from RM35 to RM80 effective 2 April 2026 — the first revision in over 30 years — while leaving the floor at RM10.** Doctors can now charge more but must be able to justify it, and FPMPAM/MMA both publicly flagged that TPAs will hold the effective price down. That is a genuine, four-month-old, citable reason why consultation documentation acquired commercial value this year. It is stronger than any generic "AI is transforming healthcare" opener.

**4. Price the thing against the CMS, not against Abridge.**
Any pricing or business-model slide should anchor on **RM45–RM179 per clinic per month for an entire CMS**, and on **RM34 as the panel consultation value**. State plainly that Western per-clinician scribe pricing is 3–10x the whole Malaysian CMS and does not transplant. If a commercial path is mentioned at all, the credible one is **a component/OEM layer sold into CMS vendors, chains, or a payer** — not a direct subscription to a clinic where 70% earn under RM60,000/month.

**5. Competitive section — name the incumbents, and be right about them.**
Replace any generic competitor list with: **Qmed Asia (Qmed Scribe + AskCPG, ISO 13485, MDA-approved)**, **Cliniclah**, **MedicalMet**, and **Heidi Health (Singapore SEA HQ, 31 July 2026, free tier)**. Naming a locally-MDA-approved competitor and then explaining what CatatMD does that it does not is far more credible to an external evaluator than claiming an empty market.

**What this does _not_ change:** the clinical scope (adult GP, acute cough / sore throat / URTI) is settled and nothing here argues against it. The architecture is untouched. Do not attempt a market-sizing model, a WTP study, or an MDA classification analysis — none can be completed responsibly at the current pace, and §5 lists exactly which numbers would have to be invented to try.
