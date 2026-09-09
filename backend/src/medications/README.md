# medications

Deterministic support for a prescription the doctor dictates: a versioned list of generic drug names, a matcher that offers spelling candidates for names the recogniser garbled, and a parser that reads a dosing phrase into fields. No LLM, no I/O, no clock, no randomness.

---

## The Boundary

**This is a spelling aid, not a formulary.** It holds drug names and nothing else: no dose, no indication, no interaction, no recommendation, and no brand names. It never proposes a drug the doctor did not say, never validates one, and never edits the text it was given. Its whole output is a candidate the doctor accepts or rejects, because look-alike sound-alike confusion is a leading medication-error class and published guidance on speech recognition names selection from a list as the control. `docs/decisions.md` D-001 is the recorded scope decision and its Not Built table governs; the ingested CPG chunks draw the identical line for themselves.

---

## What Each File Does

| File            | Responsibility                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| `lexicon.ts`    | `MEDICATION_LEXICON`, its version, and `lexiconFor(profileId)`                      |
| `vocabulary.ts` | Dose, frequency and duration words, bilingual. Also read by `suggestions/safety.ts` |
| `similarity.ts` | Phonetic and orthographic distance, and the bars that admit a candidate             |
| `match.ts`      | `matchMedication`, span-preserving                                                  |
| `sig.ts`        | `parseSig`                                                                          |

---

## Three Things Worth Knowing Before Changing It

**Synonyms are alternative names, never mishears.** `redflags/mishears.ts` caps its confusable table at pairs measured on real audio, and this repository has no drug-mishear measurements. Adding a guessed spelling here would be a second, unversioned confusable table. The phonetic matcher absorbs mishears instead, which is why it exists.

**Both similarity measures are load-bearing, and the bars are measured.** Each admits a real garbling the other misses, with a worked case apiece in `similarity.test.ts`. The bars sit above the loudest noise found on this lexicon (0.500 phonetic, 0.400 orthographic between a drug name and an ordinary consultation word). Moving either changes which names reach a doctor, so they are asserted against their literals in a test.

**Dose units are kept as spoken; duration units are translated.** `hari` and `minggu` have exact English equivalents, so `selama lima hari` and `for five days` both give `5 days`, which is what lets the same prescription in either language parse to the same object. `biji` and `sudu` do not: `sudu` is 5 ml or 15 ml depending on the spoon, and converting it would be a clinical judgement this module must not make.

---

## Residual Risks, Stated Rather Than Hidden

| Risk                                                         | Position                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A real drug offered as a candidate for a different real drug | Intended, and the reason the doctor confirms. `amoxapine` raises an `amoxicillin` candidate because either reading is possible and only the doctor can tell. The candidate is ranked below a true mishear and the heard text is always shown beside it |
| Profile scoping raises that risk rather than lowering it     | An out-of-profile drug has no correct entry to match, so it can only attract an in-profile look-alike. Scoping is a precision aid for the common case, not a safety control                                                                            |
| No brand names                                               | Costs real recall on the words Malaysian doctors actually say. Deliberate, per D-001                                                                                                                                                                   |
| The lexicon is narrow by design                              | Two acute profiles only. A drug outside them yields no candidate and the doctor types it, which is the safe degrade                                                                                                                                    |
