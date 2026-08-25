import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width":1200,"height":900})
    # Same guard as shoot_frames/render_promo: a dev server that isn't running is
    # the commonest failure, and Playwright's own traceback doesn't say so.
    try:
        page.goto(url, timeout=15000)
    except Exception as e:
        b.close()
        sys.exit(f"sample_outlines: couldn't open {url} — is the local dev server running?\n  {e}")
    # `name` comes from the <use href="#glyph-X"> inside each group, so gen_pen.py
    # can check that this file's letter ORDER matches geometry.json's instead of
    # trusting that two separately-produced lists happen to line up. Null when the
    # page's markup doesn't name it (a hand-written sample), which gen_pen treats
    # as "unnamed, count-checked only" rather than an error.
    data = page.evaluate("""() => {
      const groups = [...document.querySelectorAll('.wm-alise-svg g')];
      return groups.map(g => {
        const o = g.querySelector('.wm-letter');
        const href = o.getAttribute('href') || o.getAttribute('xlink:href') || '';
        const m = href.match(/^#glyph-(.+)$/);
        const L = o.getTotalLength();
        const N = 6000;
        const pts = [];
        for (let i=0;i<N;i++){ const q=o.getPointAtLength(L*i/N); pts.push([+q.x.toFixed(2), +q.y.toFixed(2)]); }
        return {name: m ? m[1] : null, outline: pts};
      });
    }""")
    json.dump(data, open(out,"w"))
    b.close()
print("sampled")
