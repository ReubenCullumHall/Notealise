"""Go to a note — still frames of its motion, for judging the look (not a pass/fail check).

Opens, grows and closes the pop-up in a real build (same setup as jump_check.py), freezes
each animation with document.getAnimations() and seeks it, and writes one labelled sheet.

Usage:  python3 frames.py <cdp-port> <trigger-file> <out.png> [light|dark]
"""
import io
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

port, trigger, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
scheme = sys.argv[4] if len(sys.argv) > 4 else 'light'
DIALOG = '[role="dialog"][aria-label="Go to a note"]'

FREEZE = """(t) => { for (const a of document.getAnimations()) {
  const el = a.effect && a.effect.target;
  if (!el || !(el.closest('.jump-backdrop'))) continue;
  a.pause(); a.currentTime = t; } }"""


def menu(page):
    trigger.write_text('1')
    for _ in range(40):
        if not trigger.exists():
            break
        time.sleep(0.02)


def shot(page, clip):
    return Image.open(io.BytesIO(page.screenshot(clip=clip)))


rows = []
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = browser.contexts[0].pages[0]
    page.emulate_media(color_scheme=scheme, reduced_motion='no-preference')
    time.sleep(0.8)
    page.wait_for_selector('.tree-row', timeout=20000)
    vw = page.evaluate('() => innerWidth')
    clip = {'x': vw / 2 - 340, 'y': 40, 'width': 680, 'height': 420}

    # opening
    menu(page)
    page.wait_for_selector(DIALOG, state='attached')
    frames = []
    for t in (0, 80, 160, 260, 350, 480):
        page.evaluate(FREEZE, t)
        frames.append((f'open {t} ms', shot(page, clip)))
    page.evaluate("() => document.getAnimations().forEach(a => a.finish())")
    rows.append(frames)

    # the results growing: from no match to many
    page.fill(DIALOG + ' input', 'zzzz')
    time.sleep(0.5)
    page.fill(DIALOG + ' input', 'a')
    frames = []
    for t in (0, 60, 120, 240):
        page.evaluate(
            """(t) => { for (const a of document.getAnimations()) {
                 if (a.transitionProperty === 'height') { a.pause(); a.currentTime = t; } } }""",
            t,
        )
        frames.append((f'grow {t} ms', shot(page, clip)))
    page.evaluate("() => document.getAnimations().forEach(a => a.finish())")
    time.sleep(0.3)
    rows.append(frames)

    # closing (click outside)
    page.mouse.click(12, 12)
    frames = []
    for t in (0, 70, 140, 200):
        page.evaluate(FREEZE, t)
        frames.append((f'close {t} ms', shot(page, clip)))
    page.evaluate("() => document.getAnimations().forEach(a => a.finish())")
    rows.append(frames)
    browser.close()

# one sheet: a row per motion, each frame labelled
scale = 0.5
fw, fh = int(680 * scale * 2), int(420 * scale * 2)  # screenshots are 2x
cols = max(len(r) for r in rows)
sheet = Image.new('RGB', (cols * (fw + 12) + 12, len(rows) * (fh + 40) + 12), 'white')
d = ImageDraw.Draw(sheet)
for ri, r in enumerate(rows):
    for ci, (label, im) in enumerate(r):
        im = im.resize((fw, fh))
        x, y = 12 + ci * (fw + 12), 12 + ri * (fh + 40)
        sheet.paste(im, (x, y + 24))
        d.text((x, y + 4), label, fill='black')
        d.rectangle([x, y + 24, x + fw - 1, y + 24 + fh - 1], outline=(200, 200, 200))
sheet.save(out)
print('wrote', out)
