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

## The Share Card

`frontend/public/og.jpg` is what a link to the app unfurls into, referenced from
the `og:image` and `twitter:image` tags in `frontend/index.html`.

**The type is composited, not generated.** `og-bg.png` is the generated ground
only: a woven teal canvas carrying no text at all. Image models mangle
lettering, and an approximated wordmark on a share card is the one place the
brand is seen by people who have not opened the product. `og-card.html` lays the
real lockup over that ground, using the same Outfit face as the interface and
the same Mafins `MD` outlines as `Wordmark.tsx`, so the card and the app are
provably the same artwork.

To regenerate after a copy or brand change:

```bash
# 1. Render the card at exactly the card size.
cd docs/brand
cp ../../frontend/dist/assets/outfit-latin-wght-normal-*.woff2 outfit.woff2
google-chrome --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=og.png "file://$PWD/og-card.html"

# 2. JPEG, because the ground is a photographic weave: 1.4 MB as PNG, 300 KB here.
python3 -c "from PIL import Image; Image.open('og.png').convert('RGB').save('../../frontend/public/og.jpg','JPEG',quality=88,optimize=True,progressive=True,subsampling=0)"
```

`og-card.html` expects `outfit.woff2` and `og-bg.png` beside it. Neither the
card nor the ground ships in the bundle; only the flattened `og.jpg` does.
