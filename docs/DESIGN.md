# DESIGN.md

> Visual authority for CatatMD. `docs/PRODUCT.md` answers who and why; this answers how it looks. Grounded in `docs/superpowers/research/09-medical-web-design.md`, which surveyed 20+ Malaysian, institutional, and clinician-AI interfaces.

## Theme

**Composed clinical daylight.** A warm off-white ground with near-black ink, one deep teal accent used scarcely, and severity colours borrowed from the NHS care-card grammar. Chrome floats and frosts; content sits flat and solid.

The scene that decides it: a GP at a consulting-room desk at 3pm, overhead fluorescent plus a window, glancing between a patient and a screen for forty seconds at a time. That forces high contrast, generous type, and a ground that is not a white rectangle glaring back. It does not force dark mode, so dark is offered as a preference rather than a default.

Both themes ship. Light is the default and the design target; dark is fully derived, not a filter.

## Color

OKLCH throughout. Tokens are named by **role**, never by material, so nothing invites a second cream.

### Light

| Token              | Value                    | Hex       | Role                                                                  |
| ------------------ | ------------------------ | --------- | --------------------------------------------------------------------- |
| `--ground`         | `oklch(0.978 0.004 85)`  | `#FAF9F7` | Body background                                                       |
| `--surface`        | `oklch(1 0 0)`           | `#FFFFFF` | Cards, note surface, any panel carrying safety content                |
| `--surface-sunken` | `oklch(0.955 0.005 85)`  | `#F2F0ED` | Transcript rail, inset wells                                          |
| `--ink`            | `oklch(0.245 0.008 160)` | `#1F2421` | Body text, 15.1:1 on ground                                           |
| `--ink-muted`      | `oklch(0.470 0.012 160)` | `#5C6560` | Metadata, labels, 6.4:1 on ground                                     |
| `--line`           | `oklch(0.895 0.004 85)`  | `#E4E1DD` | Borders, dividers                                                     |
| `--accent`         | `oklch(0.470 0.089 168)` | `#0F6B5C` | Approve, active state, links. 6.2:1 on ground, 6.5:1 under white text |
| `--accent-hover`   | `oklch(0.405 0.082 168)` | `#0A5347` |                                                                       |

### Dark

Not an inversion. The ground keeps the same faint green cast so the accent still belongs to it, and every severity colour is re-derived rather than reused.

| Token              | Value                    | Hex       | Contrast on ground                        |
| ------------------ | ------------------------ | --------- | ----------------------------------------- |
| `--ground`         | `oklch(0.185 0.006 160)` | `#141816` |                                           |
| `--surface`        | `oklch(0.225 0.007 160)` | `#1C211E` |                                           |
| `--surface-sunken` | `oklch(0.165 0.006 160)` | `#101413` |                                           |
| `--ink`            | `oklch(0.945 0.004 160)` | `#EDF0EE` | 15.8:1                                    |
| `--ink-muted`      | `oklch(0.720 0.010 160)` | `#A6B0AB` | 7.1:1                                     |
| `--line`           | `oklch(0.305 0.008 160)` | `#2B322E` |                                           |
| `--accent`         | `oklch(0.720 0.110 168)` | `#3FBFA6` | 8.1:1, carries dark ink on filled buttons |

### Severity

One grammar in both themes: **solid card, coloured top rule, icon, word label, ink body.** Never a tinted passage, never colour alone, never a left stripe.

| Severity  | Light                          | Dark      | Ratio (light / dark)       |
| --------- | ------------------------------ | --------- | -------------------------- |
| Emergency | `#B32116` text, `#D5281B` rule | `#FF7A66` | 6.9:1 / 7.2:1              |
| Urgent    | `#B85C00` text, `#ED8B00` rule | `#F5A623` | 4.7:1 / 9.0:1              |
| Advisory  | `#005EB8` text, `#005EB8` rule | `#6FB3F2` | 6.6:1 / 8.2:1              |
| Resolved  | `--ink-muted`, neutral rule    | same      | de-emphasised, never green |

Green is reserved for Approve. A resolved red flag never turns green, because a doctor scanning for green would then be scanning for two different meanings.

Information gaps are **not** severity. They render as dotted-outline chips in `--ink-muted`, because a gap is a prompt to ask something, not a warning.

### Color Strategy

**Restrained.** Tinted neutrals plus one accent under 10% of surface area. The Approve button is the only large filled accent element in the entire app.

## Typography

Two families, paired on a contrast axis. The interface itself is one sans across many small labels; the serif is confined to headings and the landing page, which is the marketing surface the original single-family rule assumed did not exist.

- **Family:** Inter Variable, `system-ui` fallback. Large x-height, real tabular figures for timestamps and vitals.
- **Headings:** Source Serif 4 Variable, `Georgia` fallback. A text serif drawn to be read, not a display face.
- **Scale:** fixed rem, ratio 1.2. `0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25 rem`. No `clamp()`; users view at consistent DPI and a fluid heading in a side rail looks worse, not better.
- **Body floor:** 16px in the note, 14px for metadata. Never below.
- **Line height:** 1.6 in note prose, 1.5 in UI, 1.3 on headings.
- **Measure:** 68ch cap on note text.
- **Tabular figures** on every timestamp, vital, and MC-day count so columns do not shimmer.
- `text-wrap: balance` on headings, `pretty` on prose.

No serif inside the clinical surfaces. Headings and the landing page carry it; the note, the checklist, and every label around them stay Inter, where the small sizes and dense labelling are what the sans is for.

### The Logotype

- **Face:** Mafins, and only ever the wordmark. A display serif drawn for 48px and up is a legibility risk at the 16px a note is read at.
- **Delivery:** outlines, not live text. `Wordmark.tsx` carries the real Mafins glyphs as SVG paths, so the lockup's proportions are settled once instead of re-derived from `em` arithmetic at every render, and no font load sits on the logo's critical path. The source woff2 and the generator live in `docs/brand/`.
- **The mark** is vector and takes its colour from `currentColor`, so one file serves both themes and the accent panel. It is drawn for 24px: the stroke holds 2.3px at 16px, and the aperture stays open enough that the chestpiece never welds to the C.

## Material And Elevation

This is where the Apple influence lives, and it is deliberately confined.

**Glass is chrome only.** Translucency plus backdrop blur applies to: the sidebar island, the top bar, the floating action dock, modals, and the demo-tour spotlight. It never applies to the note, a red flag, a gap, a suggestion, or any surface carrying text a doctor acts on. The NHS rule holds: solid panels for content.

The reasoning is not aesthetic. A translucent surface has a contrast ratio that depends on whatever scrolls behind it, so it cannot be verified once. Chrome carries icons and short labels at large sizes; content carries the clinical record.

| Layer                            | Treatment                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Content                          | Opaque `--surface`, 1px `--line`, radius 12px, no shadow at rest                                  |
| Raised content (menus, popovers) | Opaque, radius 12px, soft shadow                                                                  |
| Chrome (sidebar, top bar, dock)  | `--surface` at 72% alpha, `backdrop-filter: blur(20px) saturate(150%)`, 1px hairline, radius 16px |
| Scrim                            | Single fixed layer, `blur(8px)` plus 32% dim                                                      |
| Modal                            | Opaque content on a scrim, radius 16px                                                            |

Radii: 8px controls, 12px cards, 16px floating chrome, 999px chips. Nothing square, nothing pill-shaped that is not a chip.

### Z-Index Scale

Semantic, no arbitrary values.

```
--z-base: 0  --z-sticky: 10  --z-scrim: 20  --z-sidebar: 30  --z-modal: 40  --z-toast: 50  --z-tooltip: 60
```

The sidebar sits directly beneath modals, per the brief.

## The Sidebar Island

A floating, rounded, glass panel on the left, detached from all four edges. Collapsed it shows icons only at 64px; expanded it shows icons plus labels at 232px.

**Expansion triggers, all three:**

1. Pointer hover, with a 120ms open delay and 200ms close delay so a cursor crossing the edge does not dim the app.
2. `:focus-within`, so a keyboard user tabbing into it sees the same state.
3. An explicit toggle button, which pins it open. Touch has no hover, and pinning is the only honest answer.

**While expanded**, a single fixed scrim covers everything beneath the sidebar and above the content: `blur(8px)` and a 32% dim. One element carries the effect; the content tree is never filtered, because filtering a large subtree on every hover janks.

**Reduced motion:** the width change becomes instant, and the scrim drops to dim-only with no blur. Blur transitions are the most expensive and the most vestibular-hostile part of the effect. The sidebar still expands, still dims, still works.

## Layout

- **App shell:** floating sidebar island left, content right, no fixed top bar on the review screen because vertical space is the scarce resource there.
- **Review screen, three panels** per PRD §14: transcript (280px, sunken) · note (fluid, dominant, ~62%) · clinical safety rail (360px).
- **The safety rail orders by severity, never chronologically.** Emergency first, always, and severity must be visible without scrolling.
- **Below 1280px** the safety rail moves beneath the note. **Below 900px** the transcript collapses to a toggle. The panels never become tabs, because tabs hide safety content.
- Density target: everything needed for a 60-second review inside one 1440×900 viewport.

## Motion

150 to 250ms, `ease-out-quart` and friends. No bounce, no elastic, no orchestrated page-load sequence.

| Element        | Motion                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Sidebar expand | 220ms width plus opacity on labels                                           |
| Scrim          | 180ms opacity, blur only when motion is allowed                              |
| Panel entrance | 180ms fade plus 4px rise, staggered 40ms across the safety rail only         |
| Status change  | 200ms colour and shape, never motion alone                                   |
| Analysing      | Determinate-feel progress on the pipeline stages, not a spinner over content |
| Approve        | 240ms fill and check, the one moment of delight in the product               |

**The rule from issue #30:** motion degrades to an instant state change, never to no state change. Nothing starts at `opacity: 0` awaiting a class. Every animated element is authored in its final state, with the transition as an enhancement.

## Components

Every interactive element ships default, hover, focus, active, disabled, loading, and error. Focus is a 2px `--accent` ring with a 2px offset, visible in both themes, never removed.

- **Skeletons, not spinners**, for content-shaped loading.
- **Empty states teach the interface.** "No consultations yet" carries the action that creates one.
- **Assertion states** render as a fixed vocabulary: `PRESENT`, `DENIED`, `CLINICIAN_OBSERVED`, `NOT_ASSESSED`, `UNKNOWN`, `NOT_APPLICABLE`. `NOT_ASSESSED` is visible and legible, never blank and never grey-to-invisible.
- **Provenance is a visual property, not a legend.** Rule-sourced flags carry a solid marker and the word "Rule"; model-sourced carry an outlined marker and the word "AI suggested". Clinician-edited note text carries a left gutter mark and a "You edited this" affordance. All three survive into print.
- **Citations** are monospace guideline-ID chips that expand in place, echoing the ID-constrained backend contract in the UI.

## Print

A document, not a screenshot. Chrome, navigation, and controls are hidden; the note, consultation date, approving clinician, and every red flag with its resolution state remain. AI-generated versus clinician-edited stays distinguishable without colour, because most clinic printers are monochrome: edited passages carry a rule and a label, not a tint.
