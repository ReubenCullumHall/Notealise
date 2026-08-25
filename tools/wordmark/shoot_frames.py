"""Contact sheet of the wordmark reveal: every letter at 0/25/50/75/99/100% of its own window.

WHY THIS EXISTS. A green coverage number proves nothing about this animation. Every defect it
has ever had lived in the INTERMEDIATE frames and vanished at 100%, because each artefact is an
interior boundary that stops being on the silhouette once both sides are painted. The only way
to see them is to stop the clock and look.

So: pause `document.getAnimations()`, set `currentTime`, screenshot. Not a screen recording -
seeking gives an exact composite at a chosen instant, repeatably, at whatever device scale you
want. 6x is enough to see a seam; 12-14x to judge one.

Each letter's draw window is READ OFF THE GENERATED PAGE rather than hardcoded, because the
windows move whenever the geometry changes length - the writing-order rebuild shifted every one
of them - and a stale table silently shoots the wrong moments.

    python3 tools/wordmark/shoot_frames.py http://localhost:8788/index.html out/ [scale]
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788/index.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "frames"
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
LETTERS = ["a", "l", "i", "s", "e"]
PCTS = [0, 25, 50, 75, 99, 100]

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "..", "..", "site", "index.html")

PAUSE = "() => { const A = document.getAnimations(); A.forEach(a => { try { a.pause(); } " \
        "catch (e) {} }); return A.length; }"
SEEK = "(t) => document.getAnimations().forEach(a => { try { a.currentTime = t; } catch (e) {} })"


def windows():
    """Each letter's first and last slice time, straight out of the generated markup.

    Every lookup below is checked rather than `.group(0)`'d straight through: this
    reads a file gen_pen.py owns, so a markup change shows up here as a missing
    match, and a bare "NoneType has no attribute group" says nothing about which
    letter or which change caused it."""
    html = open(HTML, encoding="utf-8").read()
    m = re.search(r"<!-- wordmark:begin.*?<!-- wordmark:end -->", html, re.S)
    if not m:
        sys.exit(f"shoot_frames: no wordmark:begin/end block in {HTML} — run gen_pen.py first")
    block = m.group(0)
    out = {}
    for L in LETTERS:
        g = re.search(rf'<path id="glyph-{L}".*?(?=<path id="glyph-|<circle class="wm-pen-dot")',
                      block, re.S)
        if not g:
            sys.exit(f"shoot_frames: no <path id=\"glyph-{L}\"> in the wordmark block — "
                     "the generated markup has changed shape")
        ts = [float(x) for x in re.findall(r"--sliceAt:(\d+)ms", g.group(0))]
        if not ts:
            sys.exit(f"shoot_frames: {L!r} has no --sliceAt times — it was generated with "
                     "no reveal slices at all")
        out[L] = (min(ts), max(ts))
    return out


def main():
    win = windows()
    shots = [(f"{L}-{p:03d}", t0 + (t1 - t0) * p / 100)
             for L, (t0, t1) in win.items() for p in PCTS]
    end = max(t1 for _, t1 in win.values())
    shots += [(f"word-{int(t)}", t) for t in
              list(range(1000, int(end), 300)) + [end, end + 200]]

    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=SCALE)
        # The local dev server not being up is the single most common way these
        # scripts fail, and a raw Playwright connection traceback doesn't say so.
        try:
            page.goto(URL, timeout=15000)
        except Exception as e:
            b.close()
            sys.exit(f"shoot_frames: couldn't open {URL} — is the local dev server running?\n  {e}")
        page.wait_for_timeout(300)
        print("paused", page.evaluate(PAUSE), "animations")
        for L, (t0, t1) in win.items():
            print(f"  {L}: {t0:.0f}-{t1:.0f}ms")
        el = page.locator(".wm-alise-svg")
        for name, t in shots:
            page.evaluate(SEEK, t)
            page.wait_for_timeout(30)
            el.screenshot(path=os.path.join(OUT, f"{name}.png"))
        b.close()
    print(f"wrote {len(shots)} frames to {OUT} at {SCALE}x")


if __name__ == "__main__":
    main()
