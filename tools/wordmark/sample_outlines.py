import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width":1200,"height":900})
    page.goto(url)
    data = page.evaluate("""() => {
      const groups = [...document.querySelectorAll('.wm-alise-svg g')];
      return groups.map(g => {
        const o = g.querySelector('.wm-letter');
        const L = o.getTotalLength();
        const N = 6000;
        const pts = [];
        for (let i=0;i<N;i++){ const q=o.getPointAtLength(L*i/N); pts.push([+q.x.toFixed(2), +q.y.toFixed(2)]); }
        return {outline: pts};
      });
    }""")
    json.dump(data, open(out,"w"))
    b.close()
print("sampled")
