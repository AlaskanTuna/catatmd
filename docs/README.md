# AI Clinical Assistant

An assistant that turns a GP consultation transcript into a **reviewable** structured clinical note — with missing-information prompts, red-flag detection, and clinical suggestions carrying real citations.

> **The doctor decides.** This system does not diagnose and does not replace clinical judgement. Every output is reviewed, edited, and explicitly approved by the clinician, who remains fully responsible for all medical decisions. All consultation data in this repository is **simulated**.

**Clinical scope:** adult GP consultations for acute cough, sore throat, and other upper respiratory symptoms.

---

## Status

This repository is currently a **scaffold**. The PHI boundary types and the LLM adapter interface are implemented; the de-identification gate itself, the red-flag rules engine, and citation-constrained clinical suggestions described below are specified but not yet built. See `docs/trd.md` for per-component status.

---

## What it does

| Capability                           | Approach                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Structured clinical note             | SOAP note generated from the transcript, schema-validated                                          |
| Missing clinical information         | Gaps surfaced as prompts to ask, each with a rationale                                             |
| Red flags & escalation triggers      | **Deterministic rules engine first**; the model may only add candidates, never suppress a rule hit |
| Clinical suggestions with references | Model cites **guideline IDs** from a curated corpus; free-text references fail validation          |
| Review & approve                     | `approved` is only reachable through an explicit doctor action                                     |

---

## The PHI boundary

The central architectural invariant: **no text containing patient identifiers leaves the API.**

```
transcript ──► deid gate ──► LLMClient ──► provider
   (raw)      tokenises      only egress    (outside
              identifiers      point         boundary)
                  │
                  └──► vault (request-scoped, never persisted)
                            └──► rehydrates model output on return
```

`LLMClient.generate()` accepts only a `Deidentified` branded string, so passing a plain `string` here — an accidental leak — is a compile error, not a code-review question. Two enforcement points are not yet compiler-level:

- **Minting is a convention, not a lock.** `markDeidentified` is exported from `backend/src/deid/types.ts`, so any module can call it directly rather than going through the de-identification gate.
- **`DEID_FAIL_CLOSED` is checked at boot only.** It is validated in `backend/src/config/env.ts` but not read at the egress point in `OpenAICompatibleClient`, so it currently has no runtime effect on requests.

The provider itself is a **swappable adapter**. All three supported providers speak the OpenAI-compatible protocol, selected by `LLM_PROVIDER`:

| Provider                        | Role                                    | Data residency                                                      |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| **Qwen** (Alibaba Model Studio) | default — demo and proposal path        | Singapore endpoint                                                  |
| Gemini                          | **local dev only, synthetic data only** | free-tier terms permit use for product improvement and human review |
| DeepSeek                        | benchmarking only                       | PRC; raises a PDPA 2010 s.129 cross-border question                 |

---

## Stack

Bun workspaces · TypeScript · Zod (shared contracts) · Express 5 · Prisma 6 · better-auth · React 19 + Vite 7 + Tailwind 4 · Supabase Postgres · Vitest · Biome

Hosting: frontend → Vercel · backend → Render (Singapore) · database → Supabase (Singapore). All three in-region by design.

```
shared/          @shared/types — Zod schemas, built first, imported by both sides
backend/
  src/deid/      PHI detection, tokenisation, re-hydration vault  ← trust boundary
  src/lib/llm/   LLMClient port + provider adapter                ← only egress point
  src/redflags/  deterministic escalation-trigger rules
  src/guidelines/ curated citation corpus
frontend/        React SPA
prisma/          schema + migrations
docs/            product and workflow docs
```

---

## Getting started

```bash
bun install
cp .env.example .env          # fill DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET, QWEN_API_KEY
bun run prisma:generate
bun run db:migrate
bun run dev                   # shared watch + API :3001 + web :5173
```

Verify: `curl localhost:3001/api/health`

```bash
bun run lint                  # biome
bun run typecheck             # all three workspaces
bun run test                  # vitest
```

`BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.

---

## Contributing

Conventional Commits, enforced by commitlint: `<type>[scope]: <description>`.

`main` is shared by two developers — `git pull --rebase` before pushing.
