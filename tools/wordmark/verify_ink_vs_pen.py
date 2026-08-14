"""Does the ink appear where the pen is? This is the check that catches the glitch.

Everything else in this directory verifies that the finished letterform is right.
Nothing verified the thing a viewer actually complains about: ink switching on somewhere
the dot isn't. A mask segment is a thick stroke swept along the centerline, so a segment
that is far wider than the pen reveals a patch of letter well ahead of it - and if the
centerline misses a limb entirely, the segment covering that limb has to be wide enough
to reach it, and the whole limb flashes in at once. That is invisible to a coverage
check, because the coverage is perfect: every pixel does get painted, just not when or
where a hand would paint it.

Method: pause every animation, seek frame-exactly, hide the pen dot so it is not counted
as ink while still reading its position from the DOM, and diff consecutive frames. For
each step, measure how far the newly-darkened pixels are from the dot, in units of the
dot's own radius.

Reading it:
    ratio ~1        ink appearing at the pen - correct
    ratio up to ~2  the round cap of a reveal segment, normal
    ratio > 2.2 with a large pixel count   ink appearing away from the pen - the glitch

    python3 tools/wordmark/verify_ink_vs_pen.py http://localhost:8787/index.html
"""
import io
import statistics
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787/index.html"
T0 = int(sys.argv[2]) if len(sys.argv) > 2 else 950
T1 = int(sys.argv[3]) if len(sys.argv) > 3 else 4250
STEP = int(sys.argv[4]) if len(sys.argv) > 4 else 25
DSF = 2
FAR = 2.2               # ratio above which ink counts as detached from the pen
MIN_PX = 40             # ignore specks; antialiasing alone moves a few pixels

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=DSF)
    pg.emulate_media(reduced_motion="no-preference")
    pg.goto(URL)
    pg.add_style_tag(content="""
      .wm-pen-dot { visibility: hidden !important; }
      .wm-note-wrap { visibility: hidden !important; }
      .scroll-cue, img.mark { display: none !important; }
    """)
    pg.evaluate("document.getAnimations().forEach(a => a.pause())")
    box = pg.evaluate("""() => {
        const s = document.querySelector('.wm-alise-svg').getBoundingClientRect();
        return {x: s.x - 60, y: s.y - 90, width: s.width + 120, height: s.height + 180};
    }""")
    clip = {k: float(v) for k, v in box.items()}

    frames, dots = [], []
    for t in range(T0, T1 + 1, STEP):
        pg.evaluate("(t) => document.getAnimations().forEach(a => { a.currentTime = t; })", t)
        dots.append(pg.evaluate("""() => {
            const r = document.querySelector('.wm-pen-dot').getBoundingClientRect();
            return {cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width};
        }"""))
        img = np.asarray(Image.open(io.BytesIO(pg.screenshot(clip=clip))).convert("L"))
        frames.append((t, img < 128))
    b.close()

rows = []
prev = frames[0][1]
for i in range(1, len(frames)):
    t, cur = frames[i]
    d = dots[i]
    cx = (d["cx"] - clip["x"]) * DSF
    cy = (d["cy"] - clip["y"]) * DSF
    r = d["w"] / 2 * DSF
    ys, xs = np.nonzero(cur & ~prev)
    if len(xs):
        dist = np.hypot(xs - cx, ys - cy)
        j = int(np.argmax(dist))
        rows.append((t, len(xs), float(dist.max()) / r, (int(xs[j]), int(ys[j]))))
    else:
        rows.append((t, 0, 0.0, None))
    prev = cur

active = [r for r in rows if r[1] > 0]
flagged = [r for r in active if r[2] > FAR and r[1] >= MIN_PX]
ratios = sorted(r[2] for r in active)

print(f"{'t(ms)':>7} {'new px':>7} {'dist/dot':>9}  farthest new pixel")
for t, n, ratio, loc in rows:
    if n == 0:
        continue
    flag = "   <-- ink away from the pen" if (ratio > FAR and n >= MIN_PX) else ""
    print(f"{t:>7} {n:>7} {ratio:>9.2f}  {loc}{flag}")

# Only count stalls BETWEEN the first and last ink; the quiet frames either side are
# just the sampling window being wider than the draw, not the animation hanging.
live = [i for i, r in enumerate(rows) if r[1] > 0]
run = longest = 0
for t, n, _, _ in rows[live[0]:live[-1] + 1] if live else []:
    run = run + 1 if n == 0 else 0
    longest = max(longest, run)

print()
print(f"frames with new ink   : {len(active)} of {len(rows)}")
print(f"dist/dot ratio        : median {statistics.median(ratios):.2f}  "
      f"p90 {ratios[int(0.9 * len(ratios))]:.2f}  max {max(ratios):.2f}")
print(f"longest stall (no new ink): {longest * STEP}ms")
print(f"FLAGGED (>{FAR}x dot, >={MIN_PX}px): {len(flagged)}")
for t, n, ratio, loc in flagged:
    print(f"    t={t}ms  {n}px at {ratio:.2f}x the dot radius, farthest at {loc}")
if not flagged:
    print("    none - every reveal happened at the pen.")
