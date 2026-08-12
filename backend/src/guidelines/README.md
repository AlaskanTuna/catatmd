# Citation corpus

Curated guideline chunks the model may cite, each with a stable ID. The model
receives the candidate IDs and may only cite from that set; free-text references
fail schema validation, which makes hallucinated citations structurally
impossible rather than merely unlikely.

Sources to seed: NICE guidance on acute cough, Centre/FeverPAIN scoring for sore
throat, Malaysian CPG for URTI, WHO. Record title, publisher, year, and URL per
chunk so the UI can render a real reference.
