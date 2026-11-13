"""A long note of pictures: scroll down and back up. How long does each picture take to appear when it is
re-created, and does the page jump? usage: WORK=.. python3 run_pictures_scroll.py <port>"""
import json, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); FIX = lab.WORK / 'fix'  # made by make_media.sh
WORK = lab.WORK / 'work'; vault = WORK / 'vault-scroll'
if vault.exists(): shutil.rmtree(vault)
(vault / 'Media').mkdir(parents=True); (vault / '.mdnotes').mkdir()
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Media'}], 'activeSpaceFolder': 'Media', 'playStartupAnimation': False}))
lines = ['# Album', '']
for i in range(24):
    shutil.copy(FIX / ('photo.jpg' if i % 2 else 'photo.png'), vault / 'Media' / f'pic {i + 1}.{"jpg" if i % 2 else "png"}')
    lines += [f'![](pic%20{i + 1}.{"jpg" if i % 2 else "png"})', '', 'Some words under the picture, then more words to give the note a little text between each one.', '']
(vault / 'Media' / 'Album.md').write_text('\n'.join(lines))
ud = WORK / 'ud-scroll'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'scroll.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        page.locator('.tree-title', has_text='Album').first.click()
        page.wait_for_selector('.cm-image img'); time.sleep(2)
        page.evaluate("""() => { window.__t = []; window.__miss = 0
          const watch = (img) => { const t0 = performance.now()
            if (img.complete && img.naturalWidth) { window.__t.push(0); return }
            img.addEventListener('load', () => window.__t.push(performance.now() - t0), { once: true })
            img.addEventListener('error', () => window.__miss++, { once: true }) }
          new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.querySelectorAll) for (const i of n.querySelectorAll('img.cm-image-img')) watch(i) })
            .observe(document.querySelector('.cm-content'), { childList: true, subtree: true }) }""")
        box = page.locator('.cm-scroller').first.bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        def sweep(dy, n):
            for _ in range(n):
                page.mouse.wheel(0, dy); time.sleep(0.06)
        for _ in range(2):
            sweep(600, 40); time.sleep(0.5); sweep(-600, 40); time.sleep(0.5)
        time.sleep(1.5)
        r = page.evaluate("""() => { const t = window.__t.slice().sort((a, b) => a - b); const q = (f) => t.length ? +t[Math.floor((t.length - 1) * f)].toFixed(1) : null
          return { pictures_recreated: t.length, median_ms: q(0.5), p90_ms: q(0.9), slowest_ms: q(1), failed: window.__miss,
                   missing_now: document.querySelectorAll('.cm-image-missing').length, scrollTop: Math.round(document.querySelector('.cm-scroller').scrollTop) } }""")
        print(' ', r)
        b.close()
finally:
    lab.stop(proc)
