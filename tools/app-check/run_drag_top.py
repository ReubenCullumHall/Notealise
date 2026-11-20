"""Sidebar drag (2026-11-18): failed before the fix (Elder landed under both folders). Repro: with 'Mix notes and folders freely' on, drag a note to the very top of the sidebar.
usage: WORK=<build dir> python3 run_drag_top.py <port>   (FREE=0 = setting off)"""
import json, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1])
vault = lab.WORK / 'vault'
ud = lab.WORK / 'ud'
import shutil
if vault.exists():
    shutil.rmtree(vault)
(vault / 'Biology' / 'Banana').mkdir(parents=True)
(vault / 'Biology' / 'Banana' / 'Inside.md').write_text('# Inside\n')
(vault / 'Biology' / 'Fig').mkdir(parents=True)
(vault / 'Biology' / 'Fig' / 'Inside2.md').write_text('# Inside2\n')
for n in ['Apple', 'Cherry', 'Damson', 'Elder']:
    (vault / 'Biology' / f'{n}.md').write_text(f'# {n}\n')
(vault / '.mdnotes').mkdir()
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps(
    {'spaces': [{'folder': 'Biology', 'freeArrange': os.environ.get('FREE', '1') == '1'}], 'activeSpaceFolder': 'Biology',
     'playStartupAnimation': False}))
lab.profile(ud, vault)
proc, _ = lab.launch(ud, port, lab.WORK / 'app.log')


def order(page):
    return page.evaluate("""() => [...document.querySelectorAll('aside .tree-title')]
        .filter(e => e.offsetParent).map(e => e.textContent.trim())""")


def drag_to_top(page, name):
    rows = page.locator('aside .tree-row')
    first = rows.first.bounding_box()
    src = page.locator('aside .tree-row', has=page.locator('.tree-title', has_text=name)).first.bounding_box()
    page.mouse.move(src['x'] + 40, src['y'] + src['height'] / 2)
    page.mouse.down()
    for i in range(1, 16):
        y = src['y'] + src['height'] / 2 + (first['y'] + 3 - (src['y'] + src['height'] / 2)) * i / 15
        page.mouse.move(first['x'] + 40, y)
        time.sleep(0.03)
    page.mouse.move(first['x'] + 40, first['y'] + 3)
    time.sleep(0.3)
    hint = page.evaluate("() => [...document.querySelectorAll('.drop-before,.drop-after,.drop-into')].map(e => e.className.match(/drop-\\w+/)[0] + ':' + (e.querySelector('.tree-title')||{}).textContent)")
    page.mouse.up()
    time.sleep(1.2)
    return hint


try:
    with sync_playwright() as p:
        b, page = lab.connect(p, port)
        time.sleep(2.5)
        print('start          ', order(page))
        for name in ['Elder', 'Cherry']:
            hint = drag_to_top(page, name)
            print(f'{name} to top   ', order(page), ' line shown:', hint)
        ws = json.loads((vault / '.mdnotes' / 'workspace.json').read_text())
        print('saved order    ', {k: v.get('order') for k, v in ws.get('entries', {}).items() if 'order' in v})
        b.close()
finally:
    lab.stop(proc)
