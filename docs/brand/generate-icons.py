"""Rasterize the mark into the favicon set.

The mark is drawn here rather than traced from a rendered SVG so the icons and
Mark.tsx stay provably the same shape: the constants below are the ones in the
component, and nothing is resampled from a screenshot.

Pillow has no round line caps, so the arc is drawn with square ends and the
caps are added as circles at the two endpoints. Everything is drawn at 32x and
downsampled with LANCZOS, which is what keeps a 2.3px stroke clean at 32px.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / 'frontend' / 'public'

# Mark geometry, in the component's 32-unit viewBox.
VB = 32
C_CX, C_CY, C_R, C_SW = 14.95, 16.0, 11.2, 4.6
DOT_CX, DOT_CY, DOT_R = 27.15, 16.0, 3.4
GAP_DEG = 46
SS = 32                     # supersample factor

ACCENT = (19, 106, 81)      # oklch(0.47 0.089 168), the light-theme accent
WHITE = (255, 255, 255)


def draw_mark(size, colour, pad=0.0, bg=None):
    """Render the mark into a `size` square. `pad` insets it as a fraction."""
    n = size * SS
    img = Image.new('RGBA', (n, n), (*bg, 255) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    inset = pad * n
    s = (n - 2 * inset) / VB          # viewBox units to supersampled pixels

    def pt(x, y):
        return inset + x * s, inset + y * s

    r, sw = C_R * s, C_SW * s
    cx, cy = pt(C_CX, C_CY)
    fill = (*colour, 255)

    # Pillow measures clockwise from 3 o'clock in screen coords, so the long
    # way round from +46 to -46 is exactly the arc that leaves the aperture.
    #
    # The width is drawn inward from the bounding box, so the box has to be the
    # stroke's outer edge for the centreline to land on r. Getting this wrong
    # puts the centreline at r - sw/2 and the caps, which sit on r, then bulge
    # past the stroke.
    outer = r + sw / 2
    d.arc([cx - outer, cy - outer, cx + outer, cy + outer], GAP_DEG, 360 - GAP_DEG,
          fill=fill, width=int(round(sw)))

    # Round caps.
    import math
    for a in (GAP_DEG, -GAP_DEG):
        ex = cx + r * math.cos(math.radians(a))
        ey = cy + r * math.sin(math.radians(a))
        d.ellipse([ex - sw / 2, ey - sw / 2, ex + sw / 2, ey + sw / 2], fill=fill)

    dx, dy = pt(DOT_CX, DOT_CY)
    dr = DOT_R * s
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=fill)

    return img.resize((size, size), Image.LANCZOS)


def main():
    written = []
    for size in (32, 64):
        p = OUT / f'favicon-{size}.png'
        draw_mark(size, ACCENT).save(p)
        written.append(p)

    # iOS composites a transparent icon onto black, so this one is full-bleed
    # accent with the mark knocked out, inset to clear the system corner mask.
    p = OUT / 'apple-touch-icon.png'
    draw_mark(180, WHITE, pad=0.20, bg=ACCENT).save(p)
    written.append(p)

    for p in written:
        print(f'{p.relative_to(OUT.parents[1])}  {p.stat().st_size}B')


if __name__ == '__main__':
    main()
