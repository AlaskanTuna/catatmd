# Consultation Report — Design Spec

> Issue #376. The printed artefact for an approved consultation. This is the contract four implementers build against: every class name, measurement and data rule below is pinned, not suggested.

---

## The Problem

`Export` on an approved consultation is `window.print()` against the live review page. Print fidelity is attempted by **subtraction** — roughly twenty scattered `data-print="hide"` attributes plus a `@media print` block in `frontend/src/index.css`. The result is the three-column review layout with chrome removed: the transcript rail and safety rail still print, textareas print as textareas, and there is **no `@page` rule anywhere in the codebase**, so there is no paper size, no margins and no break discipline.

The artefact reads as a DOM dump because it is one.

## The Approach

A **document**, not a filtered screen. A route at `/consultations/:id/report`, rendered outside `AppShell`, whose entire DOM is the report. `window.print()` from it prints only the report, so correctness stops depending on twenty attributes staying in sync with the layout.

Rejected alternatives are recorded in issue #376: Puppeteer (512 MB / 0.1 CPU Render free instance), server-side `pdf-lib` (viable, but a follow-up), and a hidden `print:block` subtree on the review page (unverifiable — nobody can see the result, so "beautiful" becomes a guess).

---

## Ownership

Four implementers, strictly disjoint files. The spec is the interface between them; no implementer needs to read another's output.

| Owner | Files | Owns |
| ----- | ----- | ---- |
| **W1** | `frontend/src/review/report-data.ts`, `report-data.test.ts` | Pure data shaping. No JSX. |
| **W2** | `frontend/src/index.css` | Every visual property of the report. All of it. |
| **W3** | `docs/trd.md`, `docs/decisions.md` | The field-list decision record. |
| **W4** | `frontend/src/review/ConsultationReport.tsx`, `ConsultationReport.test.tsx` | Semantic structure. Layout utilities only. |
| **Lead** | `frontend/src/routes/ConsultationReportPage.tsx`, `App.tsx`, `routes/ConsultationReview.tsx` | Route, guard, Export wiring. |

**The CSS/markup split is the load-bearing rule.** W2 owns appearance, W4 owns structure. W4 writes `<p className="report-prose">`, never `<p className="text-[10pt] leading-[1.45] text-[#14171A]">`. Colour, size, weight, tracking, rules and break behaviour live in `index.css` under the pinned class names below. W4 may use Tailwind **only** for layout and spacing — `grid`, `flex`, `gap-*`, `mt-*`, `col-span-*`.

---

## Hard Constraints

**The report is theme-independent.** A doctor with dark mode on must still get a white page with black ink. The report therefore **must not use the app's colour tokens** — `text-ink`, `bg-surface`, `text-ink-muted`, `border-line` all invert under `:root[data-theme='dark']`. Every report colour is an explicit value declared inside `.report-sheet`. This is not a style preference; it is the difference between a working export and an unreadable one.

**No colour carries meaning.** `docs/DESIGN.md` is explicit that clinic printers are monochrome and meaning must not depend on a colour cartridge. Red-flag severity is conveyed by an uppercase word and weight, never by hue. The only colour on the page is the wordmark's accent badge, which is brand rather than meaning and degrades to grey harmlessly.

**No page numbers.** `counter(page)` and `@page` margin boxes are CSS Paged Media features Chrome does not implement. Do not attempt them, and do not simulate them with `position: fixed` — a fixed footer *is* repeated per page in Chrome but overlaps body content on pages 2+ unless `@page { margin: 0 }` is paired with `box-decoration-break: clone`. That trade is not worth making here. See issue #376 Notes.

---

## Page Geometry

| Property | Value |
| -------- | ----- |
| Paper | A4, 210mm × 297mm, portrait |
| `@page` margin | `15mm 16mm 14mm` |
| Content width | **178mm** |
| Note field grid | label `40mm` · gap `6mm` · value `132mm` |

The 132mm value column is the reason for the two-column field layout. At 10pt Work Sans, the full 178mm measure runs to roughly 100 characters per line, well past comfortable reading; 132mm lands at 72–78. The layout solves the measure and reads as a clinical form at the same time.

### Screen Versus Print

On screen the sheet reproduces the paper so the design can be judged without printing:

- `.report-viewport` — the app ground plus dot grid, `min-h-screen`, vertical padding
- `.report-sheet` — 210mm wide, white, centred, drop shadow, **padding equal to the `@page` margins**

In print the `@page` rule supplies the margin, so `.report-sheet` padding drops to `0`, its width goes `auto`, and the shadow and viewport background are removed. Screen and paper then agree.

---

## Type Scale

Print sizes in `pt`, because this is a paged medium. `--font-sans` (Work Sans) for everything except the wordmark and block headings, which take `--font-display` (Outfit). Work Sans carries `tnum`; **every table and every timestamp sets `font-variant-numeric: tabular-nums`** so columns do not shimmer.

| Role | Size | Weight | Tracking | Colour |
| ---- | ---- | ------ | -------- | ------ |
| Document kind (letterhead, right) | 8pt | 600 | `0.14em` | `--report-ink` |
| Meta label | 6.5pt | 600 | `0.12em` | `--report-faint` |
| Meta value | 10pt | 500 | normal | `--report-ink` |
| Block heading (Prescriptions, Clinical Safety Review) | 9pt | 600 | `0.12em` | `--report-ink` |
| Field label | 7.5pt | 600 | `0.1em` | `--report-muted` |
| Body prose | 10pt / 1.45 | 400 | normal | `--report-ink` |
| Table heading | 7pt | 600 | `0.08em` | `--report-muted` |
| Table cell | 9.5pt | 400 | normal | `--report-ink` |
| Flag severity | 7pt | 700 | `0.12em` | `--report-ink` |
| Flag label | 10.5pt | 500 | normal | `--report-ink` |
| Evidence quote | 9pt | 400 | normal | `--report-muted` |
| Disposition | 8.5pt | 400 | normal | `--report-muted` |
| Signature name | 12pt | 500 | normal | `--report-ink` |
| Footer | 7.5pt / 1.4 | 400 | normal | `--report-faint` |

All labels are Title Case per `docs/DESIGN.md`; uppercase is a CSS transform, never baked into the string.

**Prose is ragged-right.** Do not set `text-align: justify` — CSS justification has no hyphenation dictionary here and opens rivers at this measure.

## Palette

Declared on `.report-sheet` so no descendant reaches a theme token:

```
--report-ink:         #14171A   /* body, headings, table cells */
--report-muted:       #5A5A5A   /* labels, evidence, dispositions */
--report-faint:       #6B6B6B   /* meta labels, footer */
--report-rule-strong: #14171A   /* letterhead rule, table head underline, signature box */
--report-rule:        #C9C9C9   /* field dividers, evidence gutter */
--report-rule-soft:   #DCDCDC   /* table row dividers */
```

`.report-sheet` also sets `color-scheme: light` and `background: #fff`.

### Rule Weights

| Rule | Weight | Colour |
| ---- | ------ | ------ |
| Letterhead | `1pt` | `--report-rule-strong` |
| Block heading (above) | `0.75pt` | `--report-rule-strong` |
| Table head (below) | `0.75pt` | `--report-rule-strong` |
| Field divider | `0.4pt` | `--report-rule` |
| Table row | `0.4pt` | `--report-rule-soft` |
| Evidence gutter (left) | `1.5pt` | `--report-rule` |
| Signature box | `0.75pt` | `--report-rule-strong` |

---

## Document Structure

In order. Every block listed carries `break-inside: avoid`.

### 1. Letterhead

A single row, baseline-aligned, with a `1pt` rule beneath.

- **Left:** `<Wordmark />` at roughly 9mm cap height.
- **Right:** `CONSULTATION REPORT`, right-aligned.

### 2. Meta Band

Immediately under the letterhead rule, a three-column grid. Each cell is a label above a value.

| Cell | Label | Value |
| ---- | ----- | ----- |
| 1 | Patient | `detail.patient.name`, or `Not recorded` when `patient` or `name` is `null` |
| 2 | Consultation Date | `detail.createdAt`, `en-MY`, `dateStyle: 'long'` |
| 3 | Record Reference | `detail.id` |

Roughly 12mm of air below the band before the first field.

### 3. Clinical Note

The two-column field grid. One row per section, a `0.4pt` divider above every row except the first.

Sections come from W1's `reportSections(detail)` — eight for `malaysian`, four for `soap`. Never hard-code the list in the component.

### 4. Prescriptions

Omitted entirely when there is no prescription. **Full width**, breaking the field grid, under a block heading.

| Column | Width | Alignment |
| ------ | ----- | --------- |
| `#` | 8mm | right |
| Drug | auto | left, weight 500 |
| Dose | 26mm | left |
| Directions | auto | left |
| Duration | 24mm | left |

- `thead` carries `display: table-header-group` so headings repeat across a page break. This is well supported, unlike page margin boxes.
- `0.75pt` rule under the head, `0.4pt` between rows, **no zebra striping** — it wastes toner and adds nothing at five rows.
- `font-variant-numeric: tabular-nums` on the table.
- `break-inside: avoid` on every `tr`.

### 5. Clinical Safety Review

Omitted when `analysis.redFlags` is empty. Full width, under a block heading, ordered by `SEVERITY_ORDER` — emergency, urgent, advisory. Each entry:

1. Severity word, uppercase and tracked, in a left gutter
2. The flag label
3. `flag.evidence` as a quote with a `1.5pt` left gutter rule and indent
4. The disposition line

**A flag with no disposition prints `Not reviewed`.** It is never omitted. Silently dropping an unreviewed safety finding from the clinical record is the one failure mode this section exists to prevent.

### 6. Approval

The legally load-bearing block, and the visual anchor of the page: a `0.75pt` box with roughly 6mm padding.

- `Approved By` label
- `detail.approvedBy` at 12pt
- `detail.approvedAt`, `en-MY`, `dateStyle: 'long'` + `timeStyle: 'short'`
- A `0.4pt` signature rule roughly 70mm wide, with a `Signature` label beneath, for a wet signature on the printed copy

### 7. Provenance Footer

Separated by a `0.4pt` rule. Two lines:

1. "This note was drafted with AI assistance from a recorded consultation, then reviewed, edited and approved by the named clinician, who remains responsible for all clinical decisions."
2. `CatatMD · Generated <timestamp> · Record <id>`

The disclaimer is not boilerplate. An AI-assisted clinical document that does not say so on its face misrepresents its own provenance.

---

## Pinned Class Names

W2 declares every one of these in `@layer components` in `frontend/src/index.css`. W4 uses exactly these names and adds no colour, size, weight or tracking of its own.

| Class | Applies To |
| ----- | ---------- |
| `.report-viewport` | Screen-only page ground around the sheet |
| `.report-sheet` | The A4 sheet. Declares the palette custom properties |
| `.report-letterhead` | Letterhead row plus its `1pt` rule |
| `.report-kind` | "Consultation Report" |
| `.report-meta` | Three-column meta band |
| `.report-meta-label` | Meta cell label |
| `.report-meta-value` | Meta cell value |
| `.report-block-heading` | "Prescriptions", "Clinical Safety Review", plus rule above |
| `.report-field` | One label/value row in the field grid, plus its divider |
| `.report-field-label` | Field label, left column |
| `.report-prose` | Field value prose |
| `.report-table` | Prescriptions table |
| `.report-flag` | One red-flag entry |
| `.report-flag-severity` | Severity word |
| `.report-flag-label` | Flag label |
| `.report-evidence` | Evidence quote with gutter rule |
| `.report-disposition` | Disposition line |
| `.report-approval` | Boxed approval block |
| `.report-signature-rule` | Wet-signature rule and its label |
| `.report-footer` | Provenance footer |

The route's action bar — Back, Print — is **not** in this list. It is app chrome, lives in `ConsultationReportPage.tsx`, and carries `print:hidden`.

---

## Data Rules

W1 owns all of this. Every function is pure and separately tested.

### Note Source Precedence

Approval, not whether text changed, is what makes a note final — a doctor may approve an unedited analysis. So each template falls back:

| Template | Source | Fallback |
| -------- | ------ | -------- |
| `malaysian` | `detail.editedMedicalRecordNote` | `detail.analysis.medicalRecordNote` |
| `soap` | `detail.editedNote` | `detail.analysis.note` |

Reuse `medicalRecordSections()` from `frontend/src/lib/note-templates.ts` rather than restating the eight labels. An empty value renders the shared `NOT_ESTABLISHED` constant from `@shared/types`, never a blank.

A `malaysian` consultation whose analysis predates `medicalRecordNote` must fall back to `LEGACY_CATEGORY_UNAVAILABLE` for the five history fields, exactly as `medicalRecordSections` already does. Do not reimplement that branch.

### Directions

Assembled from the prescription's sig fields, `null` omitted. Reuse `titleCase` and `FOOD_LABELS` from `frontend/src/review/prescription-draft.ts`.

- Order: `route` · `frequency` · `food`
- Joined with ` · `
- `dose` and `duration` are their own columns and must **not** appear in Directions
- All fields `null` yields `As directed`, never an empty cell

`summarise()` in `prescription-draft.ts` is the screen-row formatter and joins all five fields into one string. It is the wrong shape for a five-column table. Do not use it, and do not change it.

### Dispositions

`detail.redFlagDispositions` is keyed by flag `id`.

| State | Printed |
| ----- | ------- |
| `acknowledged` | `Acknowledged · <decidedAt>` |
| `dismissed` | `Dismissed · <reason>` |
| `not_applicable` | `Not applicable · <decidedAt>` |
| absent | `Not reviewed` |

`reason` is required on `dismissed` and forbidden on the others — that asymmetry is enforced by `DispositionSchema` and must be reflected, not re-validated.

Consultations reviewed before dispositions shipped carry only `acknowledgedRedFlagIds`. A flag whose id appears there, with no entry in `redFlagDispositions`, prints as `Acknowledged` **without** a timestamp. Those rows project forward as acknowledged, which is what they meant; printing them as `Not reviewed` would misreport a review that happened.

---

## Testing

| Owner | Must Cover |
| ----- | ---------- |
| W1 | Both template branches · the legacy-analysis fallback · `NOT_ESTABLISHED` on empty · Directions with every field `null`, one `null`, none `null` · all four disposition states · the `acknowledgedRedFlagIds` legacy path · severity ordering |
| W4 | Renders eight sections for `malaysian` and four for `soap` · omits Prescriptions when empty and renders a row per prescription when not · renders an undisposed flag as `Not reviewed` · names `approvedBy` and `approvedAt` · asserts no app colour token class (`text-ink`, `bg-surface`, `text-ink-muted`, `border-line`) appears in the rendered tree |

That last assertion is the regression guard for the dark-mode failure. It is cheap and it is the one defect a reviewer would not catch by reading.

Follow `test-driven-development`: the test is written first and observed failing.

---

## Out Of Scope

Named so nobody adds them:

- Page numbers and per-page running attribution — platform limits, issue #376 Notes
- Server-generated PDF file — the `pdf-lib` follow-up
- Information gaps, clinical suggestions, citations, the transcript, `clinicalFacts`, `evidenceLinks`
- Any change to `deid/`, `lib/llm/`, `redflags/`, `guidelines/`, logging, or the §23 EHR export contract
- Removing the existing `data-print` attributes. They still serve printing from other routes; retiring them is separate work
