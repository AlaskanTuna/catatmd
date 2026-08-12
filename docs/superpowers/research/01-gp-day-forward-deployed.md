# 01 — The Malaysian Private GP's Actual Day (Workflow Stream)

> Desk research for CatatMD. Every claim is tagged **VERIFIED** (a source says it) or **INFERRED** (reasoning from verified facts). **No clinician has reviewed anything in this project, and no Malaysian GP was interviewed for this document.**

## Method And Its Biggest Limitation

- Sources: Malaysian Medical Council guidelines, Malaysian statute/regulation, a leading Malaysian TPA's panel-clinic contract, peer-reviewed Malaysian primary-care research, Malaysian clinic-software vendors, and Malaysian health press.
- **The load-bearing gap:** almost every published Malaysian study of primary-care documentation was done in **public** clinics (Klinik Kesihatan). Private GP note-writing is essentially unstudied in the literature. The verdict below therefore rests on regulation, payer contracts, and product evidence rather than on an audit of real private GP notes.
- Where a source could only be read through a search index (page blocked direct fetch), it is marked **VERIFIED (index)**.

---

## 1. Do Malaysian Private GPs Write SOAP Notes?

### Verdict

**No — not as a named format, and probably not as a structure either.** SOAP is not _wrong_ for Malaysia, but it is not what the note is required to be, not what the payer consumes, and not what the incumbent tooling was built around. The product's core output should keep SOAP as a **review scaffold** and stop treating it as the payload.

### VERIFIED — No Malaysian Rule Mandates SOAP

**MMC Guideline 002/2006, _Medical Records and Medical Reports_, never mentions SOAP.** What it actually prescribes is a chronological, signed, contemporaneous entry:

| MMC Section | What It Requires                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.2         | A content **inventory**: doctor's clinical notes, referral notes, lab/histopath reports, imaging, clinical photographs, drug prescriptions, nurses' reports, consent forms, computerised/electronic records                                                                                                  |
| 1.3         | **"The use of Integrated Clinical Notes is encouraged"** — doctor, nurse, and others make contemporaneous entries on the **same Continuation Sheet**. Each entry records **"the Date, Time and the Procedure or Treatment, in chronological sequence, and should be signed by the person making the entry"** |
| 1.4         | Abbreviations and short forms **"should generally be avoided"**                                                                                                                                                                                                                                              |
| 1.5         | No blank spaces between entries (to prevent retrospective back-filling); entries must be objective and relevant                                                                                                                                                                                              |
| 1.6         | Corrections struck through but still legible, and signed                                                                                                                                                                                                                                                     |

Source: <https://mmc.gov.my/wp-content/uploads/2025/09/Medical-Records-Medical-Reports.pdf>

The mandated _shape_ is a timestamped, signed, legible chronological line — not a four-heading structure.

### VERIFIED — The Closest Thing To A Mandated Spine Is Six Slots, Not Four

MMC 1.1 defines a record's purpose: it should **"contain sufficient information to identify the patient, support the diagnosis based on history, physical examination and investigations, justify the professional management given, record the course and results thereof, and ensure the continuity of care."**

MMC 2.2 (contents of a Medical Report — the document the GP is legally obliged to produce from the record) lists: **Brief history · Significant examination findings · Results of relevant investigations · Diagnosis · Treatment · Management plan.**

That maps onto SOAP only loosely: it splits investigations out of "objective", and splits _treatment_ from _management plan_ — which SOAP collapses into one "P".

### VERIFIED — The Payer Enforces A Different Schema Entirely

Panel/MCO patients are a major share of Malaysian private GP volume. PMCare (a leading Malaysian third-party administrator) publishes its panel GP contract, and it specifies the record itself.

**Working Guidelines §1.9 — Medical Record.** The clinic's record shall include:

1. Member/patient name and details
2. PMCare membership number
3. Date and time for each visit
4. Consent for the release of medical information
5. **Medical condition**
6. **Treatment and service rendered**
7. **Results of diagnostic tests and procedures, if any**
8. **Note on referral, if applicable**

**Working Guidelines §1.15 — what must accompany the claim** (abridged): _"Medical condition and/or diagnosis and treatment given"_; medication — _"drug name, dosage, amount dispensed and itemized cost"_; injection (drug, dose, route); nebuliser; sutures; dressing type; minor surgery; X-ray; lab test with result attached; and **"Medical (sick) leave certificate — please provide MC to deserving case and indicate number of days clearly."**

Source: <https://www.mediline.com.my/popalert/WGGPClinics_Revision7.pdf>

**The commercially-enforced schema is: condition/diagnosis → treatment → itemised medication dispensed → MC days → referral.** There is no subjective/objective split anywhere in it, and two of its fields (dispensed medication, MC days) have no home in SOAP at all.

### VERIFIED — Product Evidence That The Incumbent Format Is Freehand

Klinify — the most-cited private-clinic record system in Malaysia (reported at 1,200+ doctors and 350+ clinics) — succeeded by explicitly **refusing** to restructure the note. It **"does not change the workflow processes of doctors, taking into account the thought processes of these users, which are affected by the style in which they peruse a patient file or how they take down notes"**, and doctors **"just annotate on top of it, just as they would with paper-based records"**, using active digitisers and handwriting recognition.

Sources: <https://www.digitalnewsasia.com/sizzle-fizzle/klinify-out-to-cure-medical-paperwork-pains> (VERIFIED (index) — direct fetch returns 403) · <https://eb.fyi/klinify/>

A vendor that won this market by preserving handwriting is strong evidence the incumbent artefact is a **free-form written entry on a patient card**, not a filled template.

Corroborating, weakly: where SOAP _does_ appear in Malaysian clinic software marketing, it is pinned to allied health — one Malaysian vendor advertises **"voice-to-text SOAP notes"** specifically **for physiotherapy practices**, not GP. <https://medicalmet.com/features/emr/>

### VERIFIED — The Realistic Baseline Is An Incomplete Note, Not A Well-Formed One

Khoo et al., _Medical errors in primary care clinics — a cross sectional study_ (12 Malaysian **public** primary care clinics, 1,753 records):

- **98.0%** of records had documentation problems, including illegible handwriting
- No/inadequate **history**: 46.5%
- No/inadequate **physical examination**: 51.2%
- No/inadequate **diagnosis**: 42.5%

Source: <https://pmc.ncbi.nlm.nih.gov/articles/PMC3565960/>

And private is likely **worse**, not better. QUALICOPC Malaysia (221 public + 239 private primary care doctors) found: _"The public practitioners were better at maintaining informational continuity (Record keeping, Medical info, and Records continuity)."_ <https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0276480>

### INFERRED

- A Malaysian private GP's URTI note today is probably **1–3 lines**: complaint + duration, a couple of findings, a diagnosis label, the drugs dispensed, MC days. Under SOAP headings, three of the four would be one line or empty. _(Reasoned from: the MMC chronological-entry form, the PMCare field list, the ≤10-minute consultation band, ~32 patients/day, and the 98%-incomplete public baseline. Not directly observed.)_
- SOAP is nonetheless **recognisable** to any Malaysian doctor — it is standard in international medical education and appears in Malaysian allied-health documentation. The risk is therefore **not comprehension**; it is **fit and editing cost**. A GP who has to delete two empty headings and hand-add "MC 2/7" every time will stop using the tool.

---

## 2. Volume And Time

### VERIFIED — Patients Per Day

| Figure                                     | Value                                                                                    | Source                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------- |
| Median attendances/day, **private** clinic | **32.3 patients**                                                                        | Sivasampu et al., PLOS One 2017 |
| Median attendances/day, public clinic      | 133.8 patients (>4×)                                                                     | same                            |
| Private clinics vs public                  | outnumber by **5.6:1** (clinics), **3.9:1** (doctors); ~5,335 primary care clinics total | same                            |
| 2016 survey of **1,800 Malaysian GPs**     | **~70% of clinics saw fewer than 30 patients/day**                                       | CodeBlue / FPMPAM               |
| FPMPAM president's own KL clinic           | ~30/day, ~600/month; 9–5 weekdays, 9–1 Sat                                               | CodeBlue                        |
| A two-doctor Klang clinic                  | 60–100/day; 9am–9pm, closed Sundays                                                      | CodeBlue                        |

Sources: <https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0172229> · <https://codeblue.galencentre.org/2023/09/fpmpam-questions-lofty-1000-madani-patients-monthly-target-per-clinic/>

### VERIFIED — Minutes Per Consultation

- **The regulator now prices consultations in 10-minute bands.** Schedule 7 of the Private Healthcare Facilities and Services (Private Medical Clinics or Private Dental Clinics) Regulations 2006 was amended by **P.U. (A) 150/2026, in force 2 April 2026**, revising GP consultation fees to **RM10–RM80** — the first revision in over 30 years (the prior range, RM10–RM35, traced to a 1992 MMA schedule).
  <https://www.moh.gov.my/en/publications-and-reports/policies-act-policies-guide-lines/akta-kesihatan/senarai-akta-kesihatan/private-healthcare-facilities-and-services-private-medical-clinics-or-private-dental-clinics-amendment-of-fee-schedule-order-2026-p-u-a-150> · <https://www.malaymail.com/news/malaysia/2026/04/03/private-gps-welcome-revised-rm10rm80-consultation-fee-after-30-year-freeze/214926>
- **The band structure used when this reform was drafted:** simple consultation **up to 10 minutes** RM30–50; intermediate **up to 20 minutes** RM51–80; complex **over 20 minutes** RM81–125. <https://ringgitplus.com/en/blog/personal-finance-news/government-to-increase-private-clinic-consultation-fees-by-year-end.html>
  > **Caveat:** I could not verify from the 2026 gazette text that the final tiers retain those exact minute thresholds. Treat **RM10–80 / 2 Apr 2026** as VERIFIED and the **minute bands as indicative**.
- **Measured consultation time, Malaysian public primary care:** mean **18.21 minutes** consultation against 41 minutes of waiting. Malaysian Family Physician 2017;12(1):14–21. <https://e-mfp.org/wp-content/uploads/an-assessment-of-patient-waiting-and-consultation-time-in-a-primary-healthcare-clinic.pdf> · <http://mymedr.afpm.org.my/publications/51647>
- A second Malaysian clinic study reports mean **10.54 minutes** (SD 8.78). <https://journal.unisza.edu.my/myjas/index.php/myjas/article/download/268/105/>

### INFERRED

- A private GP acute-URTI consultation realistically runs **~5–12 minutes**, anchored on the regulator's "simple consultation ≤10 minutes" band. The **note-review budget inside that is on the order of 30–60 seconds**, not three minutes.
- At ~32 patients/day, **every extra 60 seconds per patient costs ~32 minutes of clinic time per day.** CatatMD must be net time-_negative_ within the first handful of patients or it gets abandoned.

---

## 3. When Documentation Happens

No Malaysian time-and-motion study of GP documentation was found. But the workflow is **structurally pinned to the consultation** by four verified constraints:

| Constraint                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The GP dispenses in-house.** Medicine is handed over at the clinic, commonly by non-pharmacist staff, so the drug list must be final before the patient leaves. Patient quote from a Malaysian qualitative study: _"In [GP] clinics normally they [non-pharmacist] don't explain. They just give you the medication."_         | <https://pmc.ncbi.nlm.nih.gov/articles/PMC4372008/>                                                                                                          |
| **The MC is produced at the visit**, with days "indicated clearly".                                                                                                                                                                                                                                                              | PMCare Working Guidelines §1.15(11)                                                                                                                          |
| **The panel claim has a 3-day clock.** _"Submit claims within 3 days of obtaining Authorization Code"_; T&C 14.1 _"within three (3) days of date of service"_; late claims _"shall not be accepted or payable"_. Manual fallback: within 30 days of end of service month, with written explanation and a per-transaction charge. | PMCare §1.16, T&C §14.1                                                                                                                                      |
| **MMC requires contemporaneous entries** — records should be _"clear, accurate, legible, made contemporaneously, signed and dated"_ — and §1.5 forbids leaving blank spaces that would let entries be back-filled later.                                                                                                         | MMC 002/2006 §1.3, §1.5; MMC _Good Medical Practice 2019_ — VERIFIED (index): <https://mmc.gov.my/wp-content/uploads/2022/04/Good-Medical-Practice-2019.pdf> |

### INFERRED

- **Documentation happens in-room, during or immediately at the end of the consult** — because the prescription, the MC, and the bill all depend on it and the patient is physically waiting at the dispensing counter. What genuinely _is_ batched is **claim submission** (up to 3 days) and filing — not the clinical note.
- **Implication:** the review-and-approve step must live inside the consultation. A design that assumes the doctor returns to a queue of AI drafts after clinic is modelling a different market (US ambient-scribe / hospital outpatient), not a Malaysian dispensing GP.

---

## 4. Who Else Touches The Note

### VERIFIED

- **Clinic assistants, mostly uncertified.** Nationally: _"Private workforce comprised primarily doctors and noncertified nursing aides."_ Certified nurses were present in only **15.0%** (rural) and **10.1%** (urban) of private clinics. Consumer perception echoes it: _"They normally only employ people who are out from form 5 [high school leavers] to be a so called clinical nurse."_
  <https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0172229> · <https://pmc.ncbi.nlm.nih.gov/articles/PMC4372008/>
- **Medical assistants are a separate statutorily registered profession** — Medical Assistants (Registration) Act 1977 (Act 180); only registered medical assistants may be employed in government **or private** healthcare facilities, and the Act's definitions expressly cover "private clinic". <https://www.moh.gov.my/images/04-penerbitan/akta-kesihatan/medical%20assistants%20registration%20act%201977.pdf>
  **Sector nuance that matters:** in **public** clinics medical assistants _run consultations_ — Khoo et al. found **81% of patient encounters were with medical assistants**, only 17.9% with medical officers. In **private** clinics they are far rarer, and the note's author is the doctor. CatatMD targets private, so "the doctor approves" holds — but the claim "in Malaysia the doctor writes the note" is only true in the private sector.
- **MMC explicitly contemplates non-doctors writing in the same record** — Integrated Clinical Notes, all disciplines on one Continuation Sheet, every entry signed and traceable (§1.3); §1.10 governs handling by nursing and ancillary staff.
- **Locums are routine** in Malaysian private GP, typically half-day or 3–4 hour sessional blocks — so the "next reader" of a note is often a different doctor. Industry source, weak: <https://weassistjobs.com/blog/part-time-doctor-jobs-malaysia.html>
- **The MCO/TPA reads and audits the record.** PMCare T&C §10 _Provider Audit_ (clinical and procedural audits); §11 _"We reserve the right to review the above stated clinic records for verification of claims… on site review and/or submit to us copy of record"_, with on-site **GP Service Provider Audit** on ≥24 hours' notice; §15 _Queried Claims_ lets PMCare query _"Questionable or inappropriate prescription or procedure, with given diagnosis"_, with 1 day (telephone) or 7 days (letter) to respond and deductions if unanswered.
- **MMC governs disclosure to third-party payers and MCOs** (§1.16): release only with informed, case-by-case consent; blanket employer consent _"is not to be encouraged"_.
- **Patients can demand the record** — withholding is unethical (§1.15) — and medical reports are due within **six weeks** (§2.4).
- **Employers, via closed panels** (PMCare closed-panel stickers shown for TNB, TM, CIMB, BSN, IWK) receive the benefit-side output, including the MC.
- **Government scheme readers:** Skim Perubatan MADANI, run by ProtectHealth for MOH, covers **acute** primary care for the B40 group through hundreds of registered private GP clinics, with claims submitted through ProtectHealth's portal. <https://protecthealth.com.my/skimperubatanmadani/>

### INFERRED

The note has at least **five audiences**: (1) the same doctor at the next visit, (2) a locum or second doctor, (3) the assistant dispensing the medicine, (4) an MCO claims auditor, (5) potentially a lawyer or the MMC. Audience (4) is the one who punishes an inconsistency between the recorded diagnosis and the drugs dispensed — which argues for CatatMD keeping **diagnosis and dispensed medication visually adjacent and obviously consistent**.

---

## 5. Bonus: The Clinical Scope Choice Is Well-Aimed

**VERIFIED.** National Medical Care Survey 2014 (nationally representative; 129 public + 416 private clinics):

- **URTI was the most common condition in private clinics — 13.1% of cases.**
- URTI accounted for **49.2%** of all antibiotic prescriptions; **46.2%** of URTI patients received an antibiotic, rising to **57.7% in private clinics**.

<https://pmc.ncbi.nlm.nih.gov/articles/PMC4869350/>

**VERIFIED.** Skim Perubatan MADANI is explicitly an **acute** primary-care scheme — it does not cover health screening, chronic disease follow-up, or vaccination. Government money is flowing to precisely the acute-episode visit type CatatMD targets. <https://protecthealth.com.my/skimperubatanmadani/>

**INFERRED.** Acute cough / sore throat / URTI is the highest-frequency, lowest-variance encounter in Malaysian private GP — the best demo _and_ the most defensible narrow scope. Separately, antibiotic over-prescription in URTI is the most-cited quality problem in Malaysian primary care; a future "is an antibiotic indicated here?" suggestion type would land on a recognised national issue. **Do not build that now** — record it as positioning, not scope.

---

## What This Changes

Ordered by value per unit of effort.

1. **PRD output format — keep SOAP, add the Malaysian operational block.** The structured note should carry, as first-class fields alongside SOAP: **`diagnosis`, `medicationsDispensed`, `mcDays`, `referral`, `followUp`.** _Why:_ the payer-enforced record schema (PMCare §1.9 / §1.15) plus the dispensing-doctor model make these the fields the note is actually consumed for; a SOAP-only note is incomplete against the contract the clinic signed.
   - **If only one field is added, add `mcDays`.** It is discrete, trivially extractable, and instantly signals to a Malaysian GP that the tool understands their job.
   - **Zero-schema-churn fallback:** render an "At a glance" strip above the SOAP card showing Diagnosis / Dispensed / MC / Follow-up, derived from the Plan.

2. **PRD Goals — restate the time target quantitatively.** Change any unquantified "saves documentation time" to **"note reviewed and approved in under 60 seconds, inside a consultation the regulator prices at ≤10 minutes"**, justified by Schedule 7 banding and the ~32 patients/day private-clinic median.

3. **PRD — convert a hidden assumption into a stated one.** Add: _"SOAP is used as a review scaffold. No Malaysian regulation mandates SOAP; MMC 002/2006 requires contemporaneous, signed, chronological entries, and Malaysian private GP notes today are typically free-text or handwritten."_ Add to README limitations: **no Malaysian GP has reviewed this product.** In front of an external evaluator, naming that is a credibility asset, not a weakness.

4. **UI — approval is in-consult, not a draft inbox.** Design the review screen for a doctor with the patient still in the room. If a draft queue exists, it is a secondary path, never the hero flow. _(Directly contradicts the US ambient-scribe UX pattern most references will suggest.)_

5. **UI — per-section copy-out.** Malaysian GPs will paste into an existing clinic system (Klinify, Curo, Desk Clinic, kumoDoc, MedicalMet, EasyClinic) or write onto a card. Per-section copy buttons plus one "copy all" is a small feature with outsized credibility — and it _defends_ the "no EMR write-back" non-goal rather than merely asserting it: write-back is a per-vendor integration into a fragmented market; copy-out is the honest interim.

6. **README/TRD — name the third audience in one line.** The note is read not only by the doctor but by a panel/MCO claims auditor with contractual on-site audit rights (PMCare T&C §10/§11) and a right to query _"questionable or inappropriate prescription or procedure, with given diagnosis"_ (§15). This is a sharp, verifiable local detail that demonstrates domain grounding, and it explains why diagnosis/treatment consistency is a design concern.

7. **Fixtures — rewrite synthetic transcripts to Malaysian register.** Manglish code-switching, **MC** (not "sick note"), panel/company patients, medicine **dispensed at the clinic** (not a prescription taken elsewhere), NRIC, RM. Cheap and high-yield: if the fixtures read American, the whole prototype reads as a template. _(Check the current fixtures before committing to this — I did not read them.)_

8. **Scope — keep URTI, and justify it with the number.** One line citing NMCS 2014: URTI is the **most common private-clinic presentation at 13.1% of cases**, and **57.7%** of private URTI patients receive an antibiotic. That turns a narrow scope from "we ran out of time" into "we picked the modal Malaysian GP encounter".

### What This Explicitly Does Not Change

Nothing found argues against the de-identification boundary, deterministic-red-flags-first, ID-constrained citations, the single-provider Qwen decision, or the "no EMR write-back" non-goal. The last one is, if anything, **strengthened** — the Malaysian private clinic software market is fragmented across many vendors with no interoperability standard in force for private facilities, and MOH's own EMR programme is a **public**-sector rollout targeted for completion in primary care by 2027, with private-sector involvement described only as future standardisation of work processes and interoperability. <https://www.thevibes.com/articles/lifestyles/120041/moh-to-complete-electronic-medical-records-rollout-in-primary-care-by-2027> · <https://codeblue.galencentre.org/2025/02/moh-to-deploy-off-the-shelf-cloud-emr-systems-across-public-health-facilities/>

---

## Open Questions A Real GP Would Settle In Ten Minutes

Not answerable from desk research. Listed so they are not silently assumed:

- What does a real Malaysian private GP URTI note physically look like — how many lines, what abbreviations survive despite MMC §1.4?
- What fraction of a typical clinic's visits are panel/MCO vs cash, and does that change how much gets written?
- Is the note written while the patient is still seated, or in the 20 seconds after they walk to the dispensing counter?
- Would a GP accept a longer note in exchange for a better MC/claim trail, or is shorter always better?
