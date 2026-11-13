"""usage: WORK=<build dir> python3 run_media_svg.py <port>
An SVG holding a script, an onload and a remote picture, named as a picture in a note: does anything run or get fetched?"""
import json, os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); WORK = lab.WORK / 'work'; vault = WORK / 'vault-svg'
if vault.exists(): shutil.rmtree(vault)
(vault / 'Media').mkdir(parents=True); (vault / '.mdnotes').mkdir()
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Media'}], 'activeSpaceFolder': 'Media', 'playStartupAnimation': False}))
(vault / 'Media' / 'hostile.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" onload="top.document.title=\'ONLOAD RAN\'">'
  '<script>top.document.title = "SCRIPT RAN"</script><rect width="200" height="100" fill="orange"/>'
  '<image href="https://example.com/tracker.png" width="10" height="10"/></svg>')
(vault / 'Media' / 'Lure.md').write_text('# Lure\n\n![](hostile.svg)\n\nEnd.\n')
ud = WORK / 'ud-svg'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'svg.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        requests = []
        page.on('request', lambda r: requests.append(r.url[:60]))
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        page.locator('.tree-title', has_text='Lure').first.click(); page.wait_for_selector('.cm-image'); time.sleep(3)
        r = page.evaluate("() => { const i = document.querySelector('.cm-image img'); return { shown: i.naturalWidth, missing: i.closest('.cm-image').classList.contains('cm-image-missing'), title: document.title } }")
        print('  the svg is shown:', r['shown'], 'px wide, missing:', r['missing'], '| window title:', r['title'], '| outside requests:', [u for u in requests if u.startswith('http')])
        b.close()
finally:
    lab.stop(proc)
