"""Render the Notealise wordmark animation as transparent frames.

Seeks the real page frame by frame rather than screen-recording it, so every frame is an
exact composite at that instant and the alpha channel is genuine (no matte, no fringing).
"""
import os
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8788/index.html"
FPS = 60
END_MS = 4000            # animation finishes at 2998ms; the rest is a hold on the finished word
SCALE = 4                # device pixels per CSS px -> ~2450px wide master
PAD_X, PAD_Y = 40, 50    # CSS px of margin around the h1, so nothing is clipped

OUT_ROOT = sys.argv[1]

# Strip everything that would paint behind the wordmark, and force the page transparent.
# Walks the ancestor chain rather than guessing which wrapper carries the background.
STRIP = """() => {
  const h = document.querySelector('h1.wordmark');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  for (let el = h; el; el = el.parentElement) {
    el.style.background = 'transparent';
    el.style.backdropFilter = 'none';
    el.style.boxShadow = 'none';
  }
  const b = h.getBoundingClientRect();
  return {x: b.x, y: b.y, w: b.width, h: b.height};
}"""
PAUSE = "() => { document.getAnimations().forEach(a => { try { a.pause(); } catch (e) {} }); }"
SEEK = "(t) => document.getAnimations().forEach(a => { try { a.currentTime = t; } catch (e) {} })"
INK = "(c) => { document.documentElement.style.setProperty('--ink', c); }"

VARIANTS = {"ink": None, "white": "#ffffff"}


def main():
    frames = int(END_MS / 1000 * FPS) + 1
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for name, colour in VARIANTS.items():
            outdir = os.path.join(OUT_ROOT, f"frames-{name}")
            os.makedirs(outdir, exist_ok=True)
            pg = b.new_page(viewport={"width": 1600, "height": 900},
                            device_scale_factor=SCALE)
            # A dev server that isn't up is by far the commonest failure here, and
            # a raw Playwright connection traceback never says so.
            try:
                pg.goto(URL, timeout=15000)
            except Exception as e:
                b.close()
                sys.exit(f"render_promo: couldn't open {URL} — is the local dev server running?\n  {e}")
            pg.wait_for_timeout(500)
            box = pg.evaluate(STRIP)
            if colour:
                pg.evaluate(INK, colour)
            pg.evaluate(PAUSE)
            clip = {"x": box["x"] - PAD_X, "y": box["y"] - PAD_Y,
                    "width": box["w"] + 2 * PAD_X, "height": box["h"] + 2 * PAD_Y}
            for i in range(frames):
                t = i * 1000.0 / FPS
                pg.evaluate(SEEK, t)
                pg.screenshot(path=os.path.join(outdir, f"{i:04d}.png"),
                              clip=clip, omit_background=True)
            pg.close()
            print(f"{name}: {frames} frames -> {outdir}")
        b.close()

    # Did anything touch the edge of the clip? A transparent render makes this checkable
    # exactly, unlike a screen recording where the background hides it.
    for name in VARIANTS:
        d = os.path.join(OUT_ROOT, f"frames-{name}")
        worst = None
        for f in sorted(os.listdir(d))[::10]:
            a = Image.open(os.path.join(d, f)).getchannel("A")
            bb = a.getbbox()
            if not bb:
                continue
            W, H = a.size
            m = min(bb[0], bb[1], W - bb[2], H - bb[3])
            if worst is None or m < worst[0]:
                worst = (m, f, W, H)
        print(f"{name}: smallest margin to the clip edge {worst[0]}px  (frame {worst[1]}, "
              f"{worst[2]}x{worst[3]})" + ("   <-- CLIPPED" if worst[0] <= 0 else ""))


if __name__ == "__main__":
    main()
