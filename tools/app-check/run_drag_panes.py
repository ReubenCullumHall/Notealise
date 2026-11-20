"""Panes: the drop box (left / replace / right) at every x, then releases each side of every edge.
usage: WORK=<build> python3 run_drag_panes.py <port> [release [x,x...]]"""
import json, os, sys, time, shutil
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1]); mode = sys.argv[2] if len(sys.argv) > 2 else 'map'


def seed():
    v = lab.WORK / 'panes-vault'
    if v.exists(): shutil.rmtree(v)
    (v / 'Space').mkdir(parents=True)
    for n in ['Open', 'Dragged', 'Other']: (v / 'Space' / f'{n}.md').write_text(f'# {n}\n\nText of {n}.\n')
    (v / '.mdnotes').mkdir()
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False,
         'session': {'tabs': ['Space/Open.md'], 'panes': ['Space/Open.md'], 'focus': 0}}))
    return v


ZONE = """() => { const z = [...document.querySelectorAll('.pane-col div.border-brand-400')].find(e => /rounded-xl/.test(e.className));
  if (!z) return '-'; return /left-2/.test(z.className) ? 'box:left' : /right-2/.test(z.className) ? 'box:right' : 'box:replace' }"""
PANES = "() => [...document.querySelectorAll('.pane-col')].map(c => (c.querySelector('[data-pane-title], h1, .cm-content') || c).textContent.trim().split(/\\s+/).slice(0,2).join(' '))"
TITLES = "() => [...document.querySelectorAll('.pane-col')].map(c => { const t = c.querySelector('input'); return t ? t.value : '?' })"

with sync_playwright() as p:
    def launch():
        v = seed(); ud = lab.WORK / 'ud-panes'; lab.profile(ud, v)
        proc, _ = lab.launch(ud, port, lab.WORK / 'panes.log')
        b, page = lab.connect(p, port); time.sleep(3)
        return v, proc, b, page

    def start(page):
        s = page.locator('[data-row-path="Space/Dragged.md"]').first.bounding_box()
        x0, y0 = s['x'] + 60, s['y'] + s['height'] / 2
        page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 + 4, y0); time.sleep(0.05)
        return x0, y0

    def at(page, x, y):
        page.mouse.move(x, y + 1); time.sleep(0.03); page.mouse.move(x, y); time.sleep(0.05)
        return page.evaluate(ZONE)

    if mode == 'map':
        v, proc, b, page = launch()
        try:
            col = page.locator('.pane-col').first.bounding_box(); print('pane', col)
            y = col['y'] + col['height'] / 2
            x0, y0 = start(page)
            for i in range(1, 12): page.mouse.move(x0 + (col['x'] + 20 - x0) * i / 11, y0 + (y - y0) * i / 11); time.sleep(0.02)
            runs, last = [], None
            for x in range(int(col['x']) - 5, int(col['x'] + col['width']) + 3):
                h = at(page, x, y)
                if h != last: runs.append([x, x, h]); last = h
                else: runs[-1][1] = x
            page.mouse.up()
            for a, z, h in runs: print(f'x {a:>5}-{z:<5} shows {h}')
            json.dump(runs, open(lab.WORK / 'paneruns.json', 'w'))
            b.close()
        finally:
            lab.stop(proc)
    else:
        runs = json.load(open(lab.WORK / 'paneruns.json'))
        xs = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else sorted({r[0] for r in runs[1:]} | {r[0] - 1 for r in runs[1:]})
        bad = 0
        for x in xs:
            v, proc, b, page = launch()
            try:
                col = page.locator('.pane-col').first.bounding_box(); y = col['y'] + col['height'] / 2
                x0, y0 = start(page)
                for i in range(1, 12): page.mouse.move(x0 + (x - x0) * i / 11, y0 + (y - y0) * i / 11); time.sleep(0.02)
                h = at(page, x, y); time.sleep(0.12); h = at(page, x, y); time.sleep(0.15)
                page.mouse.up(); time.sleep(1.3)
                t = page.evaluate(TITLES)
                exp = {'box:left': ['Dragged', 'Open'], 'box:right': ['Open', 'Dragged'], 'box:replace': ['Dragged'], '-': ['Open']}.get(h)
                ok = t == exp
                bad += 0 if ok else 1
                print(f'x {x:>5} shows {h:<12} -> panes {t}  {"ok" if ok else "MISMATCH"}')
                b.close()
            finally:
                lab.stop(proc)
        print('mismatches:', bad, 'of', len(xs))
