<a id="top"></a>

# Guideline Identity and Serialisation

The `guidelines` module holds the versioned identity of the citable document
set and the serialisation that goes into LLM prompts.

Stable document ids are used by deterministic layers, so a red-flag trigger
or gap checklist can cite a `doc:` reference that survives re-ingest.
Retrieved CPG chunks are fed to the model through `serialiseCorpusForPrompt`.

---

## What Each File Does

| File                | Responsibility                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `documents.ts`      | `GUIDELINE_CORPUS_VERSION`, `CITABLE_DOCUMENT_IDS`, `corpusIdsFor`, `documentRef`, `parseDocumentRef` |
| `prompt.ts`         | `serialiseCorpusForPrompt`                                                                            |
| `documents.test.ts` | Manifest coverage and reference parsing                                                               |

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## Citable Documents

`CITABLE_DOCUMENT_IDS` are the source documents the deterministic layers may
cite. They are the `doc:` ids in `corpus/cpg/manifest.json`, not the generated
chunk ids the model cites.

`corpusIdsFor(chunks)` turns a retrieved chunk list into a non-empty tuple for
the `guidelineId` enum, so a fabricated or free-text reference fails schema
validation before it reaches a route.

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>

---

## Prompt Surface

`serialiseCorpusForPrompt` emits only `id`, `title`, and `summary`. It never
emits `url`, `sourceLicence`, `verbatimAllowed`, or `quote`, because a licence
field in the prompt invites the model to reason about rights it cannot judge.

<div align="right"><a href="#top">&#8593;&nbsp;Back to top</a></div>
