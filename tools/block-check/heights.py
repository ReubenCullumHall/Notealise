import sys
from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
note = sys.argv[1]
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471')
    pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1600}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text(note, exact=True).first.click(); pg.wait_for_timeout(int(__import__('os').environ.get('WAIT', '2500')))
    for look in sys.argv[2:]:
        pg.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look)
        pg.wait_for_timeout(800)
        bad = pg.evaluate(f"""() => {{ const v = {VIEW}; const out = [];
          for (const el of v.contentDOM.children) {{ const r = el.getBoundingClientRect(); if (!r.height) continue;
            let pos; try {{ pos = v.posAtDOM(el) }} catch {{ continue }}
            const b = v.lineBlockAt(pos); const top = b.top + v.documentTop;
            if (Math.abs(top - r.top) > 1.5) out.push([el.className.slice(0, 30), Math.round(r.top), Math.round(top), v.state.sliceDoc(b.from, b.from + 15)]) }}
          return out }}""")
        print(look, 'misplaced blocks:', len(bad))
        for b in bad[:6]: print('   ', b)
    br.close()
