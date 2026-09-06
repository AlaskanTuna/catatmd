# Citation corpus

Curated guideline chunks the model may cite, each with a stable ID. The model
receives the whole corpus (`serialiseCorpusForPrompt` in `prompt.ts` — no
retrieval step at this size) and may only cite an ID present in it; free-text
references fail schema validation, which makes hallucinated citations
structurally impossible rather than merely unlikely.

Sources (resolved 13/08/26, see `docs/trd.md` §11 — canonical):

- **MOH National Antimicrobial Guideline (NAG), 4th ed., 2024** — Modified
  Centor scoring, acute pharyngitis, adult acute-cough assessment, acute
  bronchitis, acute rhinosinusitis, and UTI scope. © MOH Malaysia, all rights
  reserved: `sourceLicence: 'MOH-ARR'`, `verbatimAllowed: false` (summarise and
  link, never quote).
- **Abdullah et al. (2024)**, Malaysian sore-throat Delphi consensus,
  _Infect Drug Resist_ — McIsaac scoring, antibiotic thresholds, point-of-care
  testing, and symptomatic treatment. CC BY-NC 3.0: `verbatimAllowed: true`.
- **Ooi et al. (2022)**, _Malaysian Family Physician_ — Malaysian URTI
  presenting patterns and antibiotic use. CC BY 4.0: `verbatimAllowed: true`.

Every summary was checked against its linked primary source on 07/09/26. A
clinician review of the corrected summaries is still required by issue #240.

**NICE is excluded.** Its UK Open Content Licence does not cover use for
artificial intelligence purposes; no NICE recommendation text may enter this
corpus.

One source per chunk — MOH NAG and the Delphi consensus disagree on the
antibiotic threshold (Modified Centor ≥3 vs. McIsaac ≥4), and merging them
into one chunk would manufacture a consensus the ID-constraint mechanism
cannot detect, since the model would be citing a real, valid ID.
