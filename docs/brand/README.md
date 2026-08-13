# Brand Assets

The shipped logo is **code**, not an image: `frontend/src/ui/Mark.tsx` and
`frontend/src/ui/Wordmark.tsx`. Nothing here is loaded at runtime. This folder
is the source material those two files were generated from, kept so they can be
regenerated rather than hand-edited.

## Files

| File                       | What It Is                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| `generate-lockup.py`       | Emits the mark geometry and the Mafins outlines used by the two components  |
| `generate-icons.py`        | Rasterizes the mark into `frontend/public/favicon-*.png` and the touch icon |
| `Mafins-logo.woff2`        | The logotype face, subsetted to the seven glyphs of "CatatMD"               |
| `mark.svg`, `wordmark.svg` | Generator output, for handing the lockup to something that wants a file     |
| `mark-*.png`               | The two rejected mark directions, kept as the record of why                 |

Both scripts need `fonttools`; `generate-icons.py` also needs `pillow`.

```bash
cd docs/brand && python3 generate-lockup.py && python3 generate-icons.py
```

`generate-lockup.py` prints the numbers worth checking before accepting a
change: stroke width at 16px and 24px, and the aperture clearance that keeps the
chestpiece a separate object from the C.

## Why The Wordmark Is Outlines

It was live text set in Mafins, composed with CSS. That version kept landing
wrong. Its proportions were re-derived from `em` arithmetic on every render
against a display face whose metrics were drawn for 48px and up, so the badge
sat low against the caps and the letters read cramped, and each fix moved the
problem somewhere else.

As outlines the relationships are settled once. It also takes the face off the
logo's critical path, so the wordmark cannot flash a fallback serif while a
woff2 loads, and it removes the `@font-face` from the bundle entirely.

## Why The Mark Is Vector

The mark was a 1024px PNG with asymmetric padding baked in, so every box it was
dropped into rendered it small and off-centre. A second colour was only
reachable through a `brightness-0 invert` filter chain, which can produce white
and nothing else. On the accent panel it collapsed to a broken hairline.

It now takes `currentColor`, so one file serves the light ground, the dark
ground, and the accent panel, and the geometry is tuned for the 16px to 32px it
actually renders at.

## Rejected Directions

Both were rejected on legibility, not taste.

- **`mark-a-stethoscope-tail.png`**: a C whose tail became a stethoscope tube.
  It read as a question mark, which is a bad thing for a clinical tool to imply.
- **`mark-c-checked-note.png`**: it read as a generic task-list icon.
