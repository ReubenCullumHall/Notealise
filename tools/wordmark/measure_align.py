"""Is alise sitting on Note's line? Measures the residual and says what to do about it.

Run against the served site. Reports, in em:
  * how far Note's round letters fall below its flat N/t feet   -> gen_pen.NOTE_OVERSHOOT
  * how far alise's lowest ink sits from Note's lowest ink       -> the residual
  * the INK_DROP that would zero the residual at this ALISE_SCALE

Measured with the mask REMOVED, so it reads the whole letterform rather than whatever
the animation happens to have revealed.

    python3 tools/wordmark/measure_align.py http://localhost:8787/index.html
"""
import io
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787/index.html"
ALISE_SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 0.93
OVERSHOOT = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0   # keep in step with gen_pen
DSF = 3

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=DSF)
    pg.emulate_media(reduced_motion="reduce")
    pg.goto(URL)
    pg.add_style_tag(content=".scroll-cue,img.mark{display:none!important}"
                             ".wm-caret{display:none!important}")
    pg.evaluate("()=>document.querySelectorAll('.wm-letter').forEach(p=>p.removeAttribute('mask'))")
    pg.wait_for_timeout(250)
    info = pg.evaluate("""() => {
        const h1 = document.querySelector('.wordmark');
        const svgEl = document.querySelector('.wm-alise-svg');
        const svg = svgEl.getBoundingClientRect();
        const note = document.querySelector('.wm-note').getBoundingClientRect();
        return {fs: parseFloat(getComputedStyle(h1).fontSize),
                top: getComputedStyle(svgEl).top,
                svg: {x: svg.x, y: svg.y, w: svg.width, h: svg.height},
                note: {x: note.x, y: note.y, w: note.width, h: note.height}};
    }""")
    clip = {"x": info["note"]["x"] - 40, "y": info["note"]["y"] - 90,
            "width": (info["svg"]["x"] + info["svg"]["w"]) - info["note"]["x"] + 130,
            "height": info["note"]["h"] + 240}
    png = pg.screenshot(clip=clip)
    b.close()

dark = np.asarray(Image.open(io.BytesIO(png)).convert("L")) < 128
H, W = dark.shape
fs = info["fs"]


def em(px):
    return px / DSF / fs


bots = np.full(W, -1)
for x in range(W):
    ys = np.nonzero(dark[:, x])[0]
    if len(ys):
        bots[x] = ys[-1]

svg_left = (info["svg"]["x"] - clip["x"]) * DSF
note_right = (info["note"]["x"] + info["note"]["w"] - clip["x"]) * DSF
nc = [x for x in range(W) if x < note_right and bots[x] >= 0]
ac = [x for x in range(W) if x >= svg_left and bots[x] >= 0]
vals, counts = np.unique(bots[nc], return_counts=True)
note_flat = int(vals[np.argmax(counts)])
note_low = int(bots[nc].max())
alise_low = int(bots[ac].max())

note_overshoot = em(note_low - note_flat)
# The target is gen_pen.OVERSHOOT: how far alise's lowest ink may fall below Note's flat
# N/t feet. It is 0 - flush - by Reuben's call; see the comment on that constant.
residual = em(alise_low - note_flat) - OVERSHOOT
top_px = float(info["top"].replace("px", "")) if info["top"].endswith("px") else 0.0
nudge_now = -top_px / fs

print(f"font-size {fs:.0f}px   .wm-alise-svg top = {info['top']} "
      f"(= {nudge_now:+.5f}em raise)   ALISE_SCALE {ALISE_SCALE}   target OVERSHOOT {OVERSHOOT}")
print()
print(f"Note flat foot (N, t)      y={note_flat}   <- alise is aligned to THIS")
print(f"Note lowest ink (o, e)     y={note_low}   (Note's own overshoot {note_overshoot:.5f}em)")
print(f"alise lowest ink           y={alise_low}")
print()
print(f"residual: alise sits {residual:+.5f}em "
      f"({'LOW' if residual > 0 else 'high' if residual < 0 else 'level'}) "
      f"= {residual*fs:+.2f}px at this size")
# Tolerance is 4 device px, not 1. Both edges being compared are ANTIALIASED CURVES, and
# where their coverage crosses the 128 threshold moves with sub-pixel position - stepping
# `top` by a known 4 device px has been seen to move the measured bottom by 6. Tightening
# this makes the tool chase its own noise and walk the alignment away from the render that
# was actually looked at and approved.
TOL = 4
if abs(residual * fs * DSF) <= TOL:
    print(f"  within {TOL} device px - measurement noise on an antialiased curve. Leave it.")
else:
    ink_drop = (nudge_now + residual + OVERSHOOT) / ALISE_SCALE
    print(f"  set gen_pen.py INK_DROP = {ink_drop:.6f}, then re-run gen_pen.py")
    print("  (then LOOK at it - this measures an edge, it does not have taste)")
