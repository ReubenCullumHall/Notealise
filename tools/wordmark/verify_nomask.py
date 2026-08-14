"""The true letterform: what the reveal has to end up painting.

Strips the reveal so the glyph is rendered plainly, and is the reference half of the
coverage check (the other half is verify_shoot_static.py; diff the two ink masks).

WITH OWNERSHIP BANDS this cannot just remove the mask attribute. A letter is now drawn as
several clipped <use> copies of one glyph, so removing masks leaves all of them stacked -
and their antialiased edges composite DARKER than a single copy. That inflates the
reference by ~1140px and invents holes that do not exist: it read 1199px of "unpainted"
where the honest figure was 77px. So: keep the first copy, unmask and unclip it, and
delete the rest. One glyph, once.
"""
import sys

from playwright.sync_api import sync_playwright

url = sys.argv[1]
out = sys.argv[2]

ONE_COPY = """() => {
  document.querySelectorAll('.wm-alise-svg > g').forEach(letter => {
    const copies = letter.querySelectorAll('use.wm-letter, path.wm-letter');
    copies.forEach((el, i) => {
      const holder = el.parentElement;
      if (i === 0) {
        el.removeAttribute('mask');
        if (holder.hasAttribute('clip-path')) holder.removeAttribute('clip-path');
      } else {
        (holder.tagName === 'g' && holder !== letter ? holder : el).remove();
      }
    });
  });
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=2)
    page.emulate_media(reduced_motion="reduce")
    page.goto(url)
    page.evaluate(ONE_COPY)
    page.wait_for_timeout(200)
    page.locator(".hero").screenshot(path=out)
    b.close()
