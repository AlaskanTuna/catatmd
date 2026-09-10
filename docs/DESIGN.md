# DESIGN.md

> Visual authority for CatatMD. `docs/PRODUCT.md` answers who and why; this answers how it looks. Grounded in `docs/superpowers/research/09-medical-web-design.md`, which surveyed 20+ Malaysian, institutional, and clinician-AI interfaces.

## Theme

**Composed clinical daylight.** A warm off-white ground with near-black ink, one deep teal accent used scarcely, and severity colours borrowed from the NHS care-card grammar. Chrome floats and frosts; content sits flat and solid.

The scene that decides it: a GP at a consulting-room desk at 3pm, overhead fluorescent plus a window, glancing between a patient and a screen for forty seconds at a time. That forces high contrast, generous type, and a ground that is not a white rectangle glaring back. It does not force dark mode, so dark is offered as a preference rather than a default.

Both themes ship. Light is the default and the design target; dark is fully derived, not a filter.

## Color

OKLCH throughout. Tokens are named by **role**, never by material, so nothing invites a second cream.

Token names carry the `--color-` prefix because Tailwind 4's `@theme` block is the
source of truth, and that is where a utility like `bg-surface` is generated from.
Values below are lifted from `frontend/src/index.css`; ratios are computed against
the ground in the same theme.

### Light

| Token                  | Value                    | Hex       | Role                                                            |
| ---------------------- | ------------------------ | --------- | --------------------------------------------------------------- |
| `--color-ground`       | `oklch(0.945 0.005 85)`  | `#EEEDE9` | Body background                                                 |
| `--color-surface`      | `oklch(1 0 0)`           | `#FFFFFF` | Cards, note surface, any panel carrying safety content          |
| `--color-sunken`       | `oklch(0.915 0.006 85)`  | `#E5E3DE` | Transcript rail, inset wells                                    |
| `--color-ink`          | `oklch(0.245 0.008 160)` | `#1D221F` | Body text, 13.8:1 on ground                                     |
| `--color-ink-muted`    | `oklch(0.47 0.012 160)`  | `#555D58` | Metadata, labels, 5.8:1 on ground                               |
| `--color-line`         | `oklch(0.895 0.004 85)`  | `#DDDCD9` | Borders, dividers                                               |
| `--color-accent`       | `oklch(0.47 0.089 168)`  | `#136A51` | Approve, active state, links. 5.5:1 on ground, 6.5:1 on surface |
| `--color-accent-hover` | `oklch(0.405 0.082 168)` | `#005740` | 7.4:1 on ground                                                 |

**The ground is recessed, and that is load-bearing.** It sat at `0.978` against a
`1.0` surface, which is not a step a viewer can see, so every card needed a border
to exist at all and the whole interface read as flat. Dropping it to `0.945` lifts
cards by contrast with the ground rather than by outlining them, which is why the
border is now optional. The cost is real and worth stating: every dark-on-ground
ratio fell by roughly 1.3 points. Everything still clears AA, and `--color-ink`
at 13.8:1 has room to spare, but this is the number to re-check before the ground
moves again.

### Dark

Not an inversion. The ground keeps the same faint green cast so the accent still belongs to it, and every severity colour is re-derived rather than reused.

| Token               | Value                    | Hex       | Contrast on ground                        |
| ------------------- | ------------------------ | --------- | ----------------------------------------- |
| `--color-ground`    | `oklch(0.155 0.006 160)` | `#0A0D0B` |                                           |
| `--color-surface`   | `oklch(0.215 0.007 160)` | `#171A18` |                                           |
| `--color-sunken`    | `oklch(0.135 0.005 160)` | `#070908` |                                           |
| `--color-ink`       | `oklch(0.945 0.004 160)` | `#EBEEEC` | 16.7:1                                    |
| `--color-ink-muted` | `oklch(0.72 0.01 160)`   | `#A0A7A2` | 7.9:1                                     |
| `--color-line`      | `oklch(0.305 0.008 160)` | `#2C302E` |                                           |
| `--color-accent`    | `oklch(0.72 0.11 168)`   | `#54BB97` | 8.3:1, carries dark ink on filled buttons |

### Severity

One grammar in both themes: **solid card, coloured top rule, icon, word label, ink body.** Never a tinted passage, never colour alone, never a left stripe.

Severity cards sit on `--color-surface`, so these ratios are measured against the
card, not the page ground.

| Severity  | Light                             | Dark      | Text ratio on surface (light / dark) |
| --------- | --------------------------------- | --------- | ------------------------------------ |
| Emergency | `#B30D16` text, `#D0211F` rule    | `#FB7764` | 7.1:1 / 6.6:1                        |
| Urgent    | `#A35700` text, `#D67600` rule    | `#F5A843` | 5.4:1 / 8.8:1                        |
| Advisory  | `#0752B0` text, `#6FB8F5` rule    | `#6FB8F5` | 7.4:1 / 8.2:1                        |
| Resolved  | `--color-ink-muted`, neutral rule | same      | de-emphasised, never green           |

**Rule contrast is a separate check from text contrast**, and the one that gets
missed. A severity rule is a graphical object carrying meaning, so WCAG 1.4.11
asks 3:1 of it rather than the 4.5:1 its text needs. The light Urgent rule was
`#E58400` at 2.8:1 against the card and failed that; it is now `#D67600` at
3.2:1 (issue #77).

`0.66` lightness is the _lightest_ value that clears 3:1, and that is the
constraint rather than an accident. Darkening further buys contrast but walks
Urgent toward `--color-emergency-rule` at `0.552` until the two read as one
orange-red at a glance, and severity being distinguishable is the entire purpose
of the rule. Contrast and separation pull against each other here; take the
minimum that passes.

The Urgent _text_ colour is untouched at 5.4:1. Nothing was ever unreadable, and
1.4.1 always held, because every severity card carries the icon and the word
alongside the colour.

Green is reserved for Approve. A resolved red flag never turns green, because a doctor scanning for green would then be scanning for two different meanings.

Information gaps are **not** severity. They render as solid cards with a **dashed** border in `--color-ink-muted`, because a gap is a prompt to ask something, not a warning. The fill is solid like every other content surface; the dashed edge is the only thing distinguishing them, and it is doing the whole job of keeping a gap from being read as a flag.

### Color Strategy

**Restrained.** Tinted neutrals plus one accent under 10% of surface area. The Approve button is the only large filled accent element in the entire app.

## Typography

Two families, paired on a **contrast axis**: geometric against humanist, rather
than the near-miss of two sans faces from the same family tree. No serif anywhere.
The earlier pairing put a text serif on headings; it was replaced because a serif
reads as editorial, and this is an instrument.

- **Body, UI and every number:** Work Sans Variable, `system-ui` fallback. Humanist, large x-height, and it carries `tnum`, which is the reason it holds the clinical content: vitals and timestamps sit in columns and must not shimmer between rows.
- **Headings and the wordmark:** Outfit Variable, falling back to Work Sans. Geometric, wide apertures, rounded terminals.
- **Both are self-hosted**, never a CDN. A clinical application that fetches a font from a third party on every page load leaks a request pattern to that third party and adds a dependency the data-residency argument then has to explain.
- **Scale:** fixed rem, ratio 1.2. `0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25 rem`. No `clamp()`; users view at consistent DPI and a fluid heading in a side rail looks worse, not better.
- **Body floor:** 14px. The note prose sits at 14px alongside everything else on the review screen; it was 16px and was the only element on that page at a different size.
- **Line height:** 1.5 in UI and body, 1.25 on headings, `leading-relaxed` on note prose.
- **Measure:** 68ch cap on note text. Note that `ch` tracks the font size, so the 14px note renders a narrower column than the 16px one did, by design.
- **Tracking:** `-0.01em` on headings. Outfit is already wide-set and geometric, so it takes less negative tracking than the serif it replaced before the counters start closing.
- **Tabular figures** on every timestamp, vital, and MC-day count so columns do not shimmer.
- `text-wrap: balance` on headings, `pretty` on prose.

### The Logotype

- **Face:** Mafins, and only ever the wordmark. A display serif drawn for 48px and up is a legibility risk at the 16px a note is read at.
- **Delivery:** outlines, not live text. `Wordmark.tsx` carries the real Mafins glyphs as SVG paths, so the lockup's proportions are settled once instead of re-derived from `em` arithmetic at every render, and no font load sits on the logo's critical path. The source woff2 and the generator live in `docs/brand/`.
- **The mark** is vector and takes its colour from `currentColor`, so one file serves both themes and the accent panel. It is drawn for 24px: the stroke holds 2.3px at 16px, and the aperture stays open enough that the chestpiece never welds to the C.

## Material And Elevation

This is where the Apple influence lives, and it is deliberately confined.

**Glass is chrome only.** Translucency plus backdrop blur applies to: the sidebar island, the top bar, the floating action dock, modals, and the demo-tour spotlight. It never applies to the note, a red flag, a gap, a suggestion, or any surface carrying text a doctor acts on. The NHS rule holds: solid panels for content.

The reasoning is not aesthetic. A translucent surface has a contrast ratio that depends on whatever scrolls behind it, so it cannot be verified once. Chrome carries icons and short labels at large sizes; content carries the clinical record.

**Floating surfaces are chrome, and that includes modals** (settled 15/08/26). An earlier revision of the table below said modals were opaque, which contradicted the sentence above listing them under glass; the contradiction is resolved in favour of glass. What keeps it safe is that everything floating sits over the scrim, which is already blurring and dimming whatever is behind it, so the backdrop a modal composites against is a controlled one rather than arbitrary scrolling content. Text on these surfaces stays at full-strength ink: a destructive confirmation is the last place to trade contrast for texture.

**A selected row is still content.** Selection is expressed as a tint layered _over_ the opaque surface, never by replacing it. Setting an `--color-accent` alpha as the row's `background-color` removes the surface instead of tinting it, and the row goes translucent over the page's dot grid. That shipped once and read as muddy rather than selected.

**Tints are opaque tokens, not alpha utilities** (settled 15/08/26). Every selected, active and open state uses `--color-accent-soft`, with `--color-accent-soft-hover` for its hover step and `--color-sunken-soft` for hovering an unselected control. None of them carry an alpha channel.

- **Why.** `bg-accent/8`, `/12` and `/16` are translucent fills rather than colours. On a card that reads correctly, because the card beneath is opaque. On the sidebar, the dock, the chrome cluster, the approve bar and the step bar it does not: those are glass, so the tint composited against whatever happened to be scrolling behind and read as a wash. That is the same objection this section already makes to translucent content, arriving one layer down.
- **Why not teal glass.** `backdrop-filter` establishes a backdrop root and a descendant may only sample inside it, so glass nested in glass is flat by construction. Every host listed above is itself glass, which leaves opaque as the only option that is actually a colour.
- **Measured.** 12% of accent over the surface is `#E3EDEA` light and `#1E2E28` dark, within 8/255 of what the translucent version happened to render over glass. Accent text on it measures 5.45:1 light and 6.05:1 dark.
- **One value replaced three.** The `/16` step existed only to survive the glass beneath it. Opaque removes that reason.

| Layer                            | Treatment                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Content                          | Opaque `--color-surface`, radius 16px, shadow rather than a border at rest                               |
| Raised content (menus, popovers) | `--color-glass`, radius 22px. These float above the page and carry chrome, not the record                |
| Chrome (sidebar, top bar, dock)  | `--color-glass`, 58% alpha light and 60% dark, `backdrop-filter: blur(20px) saturate(150%)`, radius 22px |
| Scrim                            | Single fixed layer, `blur(8px)` plus 32% dim light, 50% dark                                             |
| Modal                            | `--color-glass` on a scrim, radius 22px. Text on it stays full-strength ink                              |

Radii: **10px controls, 16px cards, 22px floating chrome, 999px chips.** Roundness
is a brand property here, not a default. The references this was built against carry
their softness in the radius and the shadow rather than in blur, which is what lets
clinical text sit on a fully opaque surface and still read as part of the same soft
interface.

**Every CTA is a rounded rectangle at the 10px control radius. Nothing you press
is a pill.** Buttons were stadium-shaped until they were not; the shape now echoes
the cards and inputs an action sits among instead of standing apart from them. The
999px radius is reserved for **chips and status markers**, which are labels rather
than controls: provenance marks, assertion states, citation IDs, count badges. That
split is the whole rule, and it is what makes the shape language readable at a
glance: round means "this is telling you something", rounded-rect means "this does
something".

It is enforced in one place, `ui/Button.tsx`, but three CTAs on the marketing and
list screens hand-roll the same styling rather than using it. Those exist and must
be changed in step; a sitewide shape rule that holds in the component and not on
the landing page is worse than no rule.

**Three implementation notes that have each already cost a shipped bug.**

The glass needs **texture behind it**. `backdrop-filter` blurs whatever is behind
it, so over a flat fill it has nothing to operate on and the chrome reads as merely
translucent no matter how large the radius is. The dot grid under every page is
what makes frost look like frost, which is why it is on both shells rather than
just the marketing one.

The `-webkit-backdrop-filter` declaration must come **first** and the standard
property **last**. Written the other way the CSS minifier treats the pair as one
property declared twice, keeps the last, and ships the prefix alone: the frost
degrades to flat translucency in the production build while dev, which does not
minify, looks perfect. Verify glass changes against `vite build`, never against
the dev server.

**Glass inside glass is always flat.** An element with `backdrop-filter` establishes a
backdrop root, and a descendant's own `backdrop-filter` may only sample within it. A
panel nested inside the chrome cluster therefore blurs the cluster's flat fill rather
than the page, which is the first note's "nothing to operate on" arriving through the
DOM instead of through a missing dot grid. Floating panels are portalled to `body` for
this reason. Modals escape it already: a `<dialog>` renders in the top layer, which is
outside any backdrop root.

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

**Reduced motion:** the width change becomes instant and the scrim's _blur
transition_ is dropped, but the blur itself stays. A static blurred layer is not
motion; animating the blur is. The earlier rule removed the blur entirely, which
suppressed an effect the preference was never asking about. The sidebar still
expands, still dims, still frosts, still works.

**The active nav item is tinted with `--color-accent-soft`**, the same token as
every other active state. It used to be the exception at `bg-accent/16` where the
rest of the app was `/12`, because it was painted on glass with the scrim behind
it and at that glass alpha the `/12` tint measured 4.05:1 with the island
expanded, under AA. An opaque token composites against nothing, so the exception
and the measurement it rested on both retire (settled 15/08/26).

## Layout

- **App shell:** floating sidebar island left, content right, no fixed top bar on the review screen because vertical space is the scarce resource there. Below `md` the island is replaced by a bottom dock rather than shrunk, because it is the wrong shape for a thumb and hover does not exist there.
- **Review screen, three panels**: transcript (280px, sunken) · note (fluid, dominant) · clinical safety rail (360px). Shipped as `lg:grid-cols-[280px_minmax(0,1fr)_360px]` in `ConsultationReview.tsx`.
- **The safety rail orders by severity, never chronologically.** Emergency first, always, and severity must be visible without scrolling.
- **Below `lg` (1024px) the safety rail moves _above_ the note, not below it.** On a narrow screen "visible without scrolling" can only mean first in source order. The transcript drops to a toggle at the same breakpoint. The panels never become tabs, because tabs hide safety content.
- The rail scrolls itself rather than stretching the page. One guest consultation produces four flags and twenty-seven gaps, which made it the tallest column by a wide margin and left the other two beside a long empty gutter.
- Density target: everything needed for a 60-second review inside one 1440×900 viewport.

### While Capture Is Running

The three panels are the **review** layout. During capture the conversation
takes the screen, and the two-panel layout below is what it docks back to.
Every choice here is about what a doctor can read in the two seconds they can
spare while looking at a patient.

**The theatre is the primary capture surface** (#287). Pressing Record opens the
conversation in a full-viewport `<dialog>`: transcript on the left as the only
scroller, `LivePrompter` beside it at 380px. The hero, the page and its chrome
go behind the scrim, so the height arithmetic below stops applying rather than
being tuned.

| Behaviour  | Rule                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Opens      | By itself, when capture starts. Never a control the doctor has to find  |
| Escape     | Docks, never stops. The socket stays open and the session keeps running |
| Docked     | Falls back to the two-panel layout below, prompter still on screen      |
| After Stop | Closes. `View Conversation` reopens the settled transcript, read only   |

**It is a `<dialog>` rather than a fixed panel** for the reason "Glass inside
glass is always flat" gives: `showModal()` promotes it to the top layer, outside
every backdrop root, and hands over focus trapping, Escape and inertness of the
page behind at no cost.

The docked layout, which is also what runs below `lg`:

| Panel          | During capture           | Why                                                        |
| -------------- | ------------------------ | ---------------------------------------------------------- |
| Transcript     | fluid, the only scroller | the one surface actually changing                          |
| Note           | hidden                   | it is a placeholder; the note is not written until Analyse |
| Safety rail    | hidden                   | twenty-eight gap cards is not a glance                     |
| `LivePrompter` | 380px, fixed height      | red flags plus three prompts, chosen by priority           |

**Severity is still visible without scrolling, and it is better served here.**
The rail's fixed width existed to guarantee that, but measured on production a
settled review overflows the page by 234px and hides 264px of the rail below the
fold, which is where a rule hit at position one of thirty-two actually sits. The
prompter's red-flag section is permanent, above the fold, and first.

**The prompter is push, never pull.** A warning behind a click is a warning
nobody opens mid-consultation, which is the tabs rule in another shape.

This rule is about **reachability, not markup**, and the difference now matters.
The conversation opens into a `<dialog>` when capture starts (#287) and the
prompter travels inside it, rather than staying on a page behind the scrim.
Two constraints preserve the original guarantee:

| Constraint                      | What it means                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| The theatre opens itself        | Nothing to find and nothing to press. The doctor never opens the surface holding the flags |
| The flags go where the words go | Prompter inside the theatre while it is open, in its own column while it is docked         |

The earlier wording said the prompter "is not a `<dialog>` and is never modal".
That was the mechanism, written down in place of the reason. Wherever the
conversation is, the flags are beside it, and that is the property to protect.

**Three prompts, and the cap is the design.** A panel holding twenty-seven gaps
scrolls exactly like a rail holding twenty-seven. The rest sit behind the shared
overflow dialog and are never dropped from the count.

**It is opaque, like every other content surface.** It carries red flags and
prompts, so the glass-is-chrome-only rule applies to it in full.

**Below `lg` it is `order-1`**, above the transcript, for the same reason the
rail was: on a narrow screen "visible without scrolling" can only mean first in
source order.

**The column ceiling is `calc(100vh-26rem)` while capture is docked, against
`calc(100vh-13rem)` for review, and the difference is measured rather than
guessed.** It governs the docked fallback only; the theatre has no page above
it to subtract. At 1440x900 the band above the grid is 292px and the page's own
bottom padding is 121px, so a 692px column overflows the viewport by 234px.
That is survivable while reading a note, because the columns are sticky and
settle after one scroll. It is not survivable while talking, which was the
original complaint: the doctor scrolls the page to reach the bottom of a
transcript that is scrolling itself. 484px is what makes 292 plus the column
plus 121 land inside 900, and it is why capture has exactly one scrolling
surface.

### The Prescription Theatre

Dictating a prescription opens a second full-viewport `<dialog>`, on the same
reasoning as the capture theatre and with two deliberate differences (#365).

**Why it is a theatre at all.** The compose surface lived in the review page's
middle column: about 620px wide, itself an internal scroller, holding a
three-line dictation box, a candidate list, six sig fields and a Confirm button.
Most of it sat below the fold. A doctor pressing Accept saw nothing change,
because the field it filled was off screen, so a wired button read as broken.

| Behaviour  | Rule                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| Opens      | By itself, on Dictate. Add opens the same room idle, with the box focused |
| Escape     | **Stops, then closes.** The first press ends the dictation and stays open |
| Discarding | Escape with rows staged asks first, because they were never saved         |
| Confirm    | Commits the whole staged list at once, then closes                        |

**It is one column while listening and two after Stop, and that is the
difference from the capture theatre.** The ambient one is two throughout because
red flags stream in beside the transcript, so both halves are alive at once.
Here the parse runs once, on Stop, so drug names and sig fields do not exist
while the doctor is speaking: a second column then would be furniture. After
Stop the dictated text moves left as the evidence, and the decisions take the
right at 440px.

**Escape stops rather than docks, and that is the second difference.** Ambient
docks because a consultation must keep recording while the doctor uses the page
behind it. A dictated phrase has nothing to keep running for, and stopping loses
nothing: the settled words are kept and the parse runs on them. A docked live
strip on the card would be a second live surface for a twenty second utterance.

**Accept has to produce something visible.** A row appears in the right column
carrying the drug name, its sig, and the stretch of text those fields were read
from. Reject visibly removes its row, so an Accept that changed nothing on
screen read as the dead half of a pair.

**What it costs is the safety rail, and that is recorded rather than solved.**
While the theatre is open the rail sits behind the scrim, which is in tension
with "the flags go where the words go" above. The capture theatre answers that
by carrying `LivePrompter` inside it; this one does not carry anything
equivalent yet.

### The Transcript Has Two Sides

Speakers alternate left and right rather than sharing one left edge, in both the
live pane and the settled transcript.

- **Two caps, because this pane is rendered at two very different widths.**
  62% once the column clears `@lg`, and 88% below it. Full width on the 880px
  capture column runs about 105 characters, well past the 68ch this document
  sets for prose; but 62% of the 380px review column is a 235px bubble that
  breaks a line every three words. The split itself holds at both widths, only
  the cap moves.
- **It is a container query, not a media query.** The thing that varies is the
  column's width, not the viewport's, and the same component renders in a
  380px rail and a fluid 880px column on the same 1440px screen.
- **The right speaker takes `accent-soft`. The left takes whichever neutral
  contrasts with the ground**: `sunken` in the live pane, which sits on
  `surface`, and `surface` in the settled transcript, which sits on `sunken`.
- **The chip and its bubble always agree.** One turn never carries two answers
  to whose it is.
- **Consecutive turns from one speaker drop the chip and the timestamp**, and
  tighten by 8px. That grouping is what makes it read as a conversation rather
  than a log with a label on every line.
- **The pane follows the newest turn, but only from the bottom.** A doctor who
  has scrolled up to re-read something said a minute ago is not yanked back down
  by the next word the patient says; following resumes through an explicit
  "Jump to latest", and the pane never claims to be current while it is not.
- **Sides are not roles during capture.** The recogniser numbers speakers and
  roles are assigned after Stop, so an id that swaps mid-consultation moves the
  conversation bodily across the pane. That is louder than a chip changing text,
  and it is the cost this layout accepts for legibility. It is also why the
  diarisation config is a correctness concern rather than a cosmetic one.

### The Footer Reveal

The page is an opaque sheet lying on top of a footer that is fixed to the bottom
of the viewport for the whole session. Scrolling to the end slides the sheet up
and uncovers what was already there, so the reveal costs no scroll listener, no
observer and no JavaScript: nothing animates, the occluder just moves.

- `--footer-h` is **one variable** serving both the footer's height and the reserve below the page. As two literals they drift the first time either changes, and the failure is silent and one-directional: too small a reserve hides the footer's top row behind the page, which nobody sees unless they scroll to the bottom at the width that broke it. Measure the footer and set the variable from that.
- Below `48rem` the reveal is switched off rather than resized. Stacking the content roughly doubles the footer, so holding the effect on a phone would reserve most of a viewport as dead scroll to uncover what a normal footer shows for free.
- **`/consultations/:id` has no footer at all.** It is a working surface with a sticky approve bar, and the reserve is dropped with it so the page ends at its content.
- Footer content is right-aligned against the header's `max-w-6xl px-6` column, not the viewport. Past about 1400px a viewport-flush footer drifts away from everything else on the page and stops reading as part of the same grid.

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
- **Provenance is a visual property, not a legend.** Rule-sourced flags carry a solid marker and the word "Rule"; model-sourced carry an outlined marker and the words "AI Suggested". Clinician-edited note text carries a "You Edited This" badge against the model's "AI Generated". The distinction is _computed_, by comparing the doctor's copy against the AI's original, which the API preserves byte-identical. That is what makes the label truthful rather than a flag someone remembered to set. All of it survives into print.
- **Labels are Title Case; sentences are not.** `AGENTS.md` "Documentation Hygiene" governs UI copy as well as prose: headings, buttons, badges, nav items and table headers take Title Case, while anything that is a sentence, a helper line, an error, or model output stays as written.
- **Citations** are monospace guideline-ID chips that expand in place, echoing the ID-constrained backend contract in the UI.

## Print

A document, not a screenshot. Chrome, navigation, and controls are hidden; the note, the consultation date, and every red flag with its resolution state remain. AI-generated versus clinician-edited stays distinguishable **without colour**, because most clinic printers are monochrome: edited passages carry a dotted underline, not a tint.

Two things paper needs that the screen does not. A capped, scrolling region is a screen affordance; on paper it silently cuts whatever sits below the fold, and the one region it applies to is the safety rail, so `[data-print="expand"]` makes it static and full-height. And gaps hidden behind the "show all" disclosure are restored by `print:block` rather than sliced out of the array, so paper never carries a truncated list with nothing to say it was truncated.

The approving clinician appears on screen and on paper, stated by the server
rather than inferred by the client from the session. Today a consultation is
only visible to the account that owns it, so the viewer and the approver are
provably the same person, but that is an access-control property rather than a
fact about the document: the moment a clinic or admin boundary exists, a note
would start being attributed to whoever opened it.

A name is not an identifier. A production deployment needs an MMC registration
number, which the schema does not carry.
