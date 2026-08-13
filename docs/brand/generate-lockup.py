"""Build the CatatMD lockup from the real Mafins outlines.

Everything is laid out in font units (1000 upem, cap height 700) with the
baseline at y=0 and y flipped for SVG, so the type needs no scaling and the
geometry is exact rather than negotiated by CSS em math at render time.
"""

import math
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

FONT = Path(__file__).with_name('Mafins-logo.woff2')
CAP = 700

f = TTFont(FONT)
gs = f.getGlyphSet()
cmap = f.getBestCmap()
hmtx = f['hmtx']


def run(text, tracking, scale=1.0, dx=0.0, dy=0.0):
    parts, x = [], 0.0
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.1f}')
        t = Transform(scale, 0, 0, -scale, dx + x * scale, dy)
        gs[g].draw(TransformPen(pen, t))
        if pen.getCommands():
            parts.append(pen.getCommands())
        x += hmtx[g][0] + tracking
    return ' '.join(parts)


def ink(text, tracking, scale=1.0):
    x, box = 0.0, None
    for ch in text:
        g = cmap[ord(ch)]
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        if bp.bounds:
            x0, y0, x1, y1 = bp.bounds
            b = ((x0 + x) * scale, y0 * scale, (x1 + x) * scale, y1 * scale)
            box = b if box is None else (
                min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])
            )
        x += hmtx[g][0] + tracking
    return box


# ── The mark ──────────────────────────────────────────────────────────────
# A closed geometric C with the chestpiece resting in its aperture, drawn in a
# 32-unit square and tuned so the stroke survives a 24px render: the aperture
# is wide enough that the chestpiece stays a separate object at that size.
M = 32
C_CX, C_CY, C_R, C_SW = 14.95, 16.0, 11.2, 4.6
DOT_CX, DOT_R = 27.15, 3.4
GAP_DEG = 46


def mark_paths(cx=C_CX):
    a = math.radians(GAP_DEG)
    sx, sy = cx + C_R * math.cos(a), C_CY - C_R * math.sin(a)
    ex, ey = cx + C_R * math.cos(-a), C_CY - C_R * math.sin(-a)
    arc = f'M{sx:.2f} {sy:.2f}A{C_R} {C_R} 0 1 0 {ex:.2f} {ey:.2f}'
    return arc, (DOT_CX + (cx - C_CX), C_CY, DOT_R)


arc, (dot_cx, dot_cy, dot_r) = mark_paths()
clearance = math.hypot(
    (C_CX + C_R * math.cos(math.radians(GAP_DEG))) - dot_cx,
    (C_CY - C_R * math.sin(math.radians(GAP_DEG))) - dot_cy,
) - dot_r - C_SW / 2
mark_box = (
    min(C_CX - C_R - C_SW / 2, dot_cx - dot_r),
    C_CY - C_R - C_SW / 2,
    max(C_CX + C_R + C_SW / 2, dot_cx + dot_r),
    C_CY + C_R + C_SW / 2,
)
print(f'mark ink bbox {tuple(round(v, 2) for v in mark_box)}')
print(f'  margins  L{mark_box[0]:.2f} R{M - mark_box[2]:.2f} '
      f'T{mark_box[1]:.2f} B{M - mark_box[3]:.2f}')
print(f'  aperture clearance {clearance:.2f}u = {clearance * 24 / M:.2f}px at 24px')
print(f'  stroke {C_SW}u = {C_SW * 24 / M:.2f}px at 24px, '
      f'{C_SW * 16 / M:.2f}px at 16px')

with open('mark.svg', 'w') as fh:
    fh.write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {M} {M}" fill="none">'
        f'<path d="{arc}" stroke="currentColor" stroke-width="{C_SW}" '
        f'stroke-linecap="round"/>'
        f'<circle cx="{dot_cx}" cy="{dot_cy}" r="{dot_r}" fill="currentColor"/>'
        f'</svg>\n'
    )

# ── The lockup ────────────────────────────────────────────────────────────
TRACK = 30          # 0.03em inside each word
MD_SCALE = 0.80
GAP_BADGE = 170
BADGE_H = 762       # a touch taller than caps, so it frames rather than clips
BADGE_R = 140
PAD_H = 170

catat_box = ink('Catat', TRACK)
catat_dx = -catat_box[0]            # ink starts flush at x=0
catat_right = catat_dx + catat_box[2]

md_box = ink('MD', TRACK, MD_SCALE)
md_w = md_box[2] - md_box[0]
badge_x = catat_right + GAP_BADGE
badge_w = md_w + 2 * PAD_H
badge_y = -CAP / 2 - BADGE_H / 2
md_dx = badge_x + PAD_H - md_box[0]
# run() maps a font point py to SVG y = dy - py, so the ink spans
# [dy - y1, dy - y0] and its midpoint is dy - (y0 + y1)/2. Centre that on the
# cap band and solve for dy.
md_dy = -CAP / 2 + (md_box[1] + md_box[3]) / 2

VB_Y = badge_y
VB_W, VB_H = badge_x + badge_w, BADGE_H

print(f'\nwordmark viewBox "0 {VB_Y:.0f} {VB_W:.0f} {VB_H:.0f}"  '
      f'aspect {VB_W / VB_H:.3f}  height {VB_H / 1000:.3f}em')
print(f'  Catat {catat_box[2] - catat_box[0]:.0f} | gap {GAP_BADGE} '
      f'| badge {badge_w:.0f}x{BADGE_H} (pad {PAD_H}, MD {md_w:.0f} wide)')

catat_d = run('Catat', TRACK, 1.0, catat_dx, 0)
md_d = run('MD', TRACK, MD_SCALE, md_dx, md_dy)

with open('parts.txt', 'w') as fh:
    fh.write(f'WORDMARK_VIEWBOX 0 {VB_Y:.0f} {VB_W:.0f} {VB_H:.0f}\n')
    fh.write(f'WORDMARK_EM {VB_H / 1000:.3f}\n')
    fh.write(f'BADGE_RECT x="{badge_x:.0f}" y="{badge_y:.0f}" '
             f'width="{badge_w:.0f}" height="{BADGE_H}" rx="{BADGE_R}"\n')
    fh.write(f'CATAT_D\n{catat_d}\n')
    fh.write(f'MD_D\n{md_d}\n')
    fh.write(f'MARK_ARC\n{arc}\n')
    fh.write(f'MARK_DOT cx="{dot_cx}" cy="{dot_cy}" r="{dot_r}" '
             f'sw="{C_SW}"\n')

with open('wordmark.svg', 'w') as fh:
    fh.write(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 {VB_Y:.0f} {VB_W:.0f} {VB_H:.0f}" '
        f'style="--md-ink:#fff;color:#1b6b56">'
        f'<path d="{catat_d}" fill="currentColor"/>'
        f'<rect x="{badge_x:.0f}" y="{badge_y:.0f}" width="{badge_w:.0f}" '
        f'height="{BADGE_H}" rx="{BADGE_R}" fill="currentColor"/>'
        f'<path d="{md_d}" fill="var(--md-ink)"/></svg>\n'
    )
print('\nwrote mark.svg, wordmark.svg, parts.txt')
