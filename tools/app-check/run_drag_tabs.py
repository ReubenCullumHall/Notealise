"""Tab strip: what the drop marker says at every x pixel, then releases each side of every edge.
usage: WORK=<build> python3 run_drag_tabs.py <port> <dragged tab title> [release [x,x...]]"""
import json, os, sys, time, shutil
from pathlib import Path
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1]); who = sys.argv[2]; mode = sys.argv[3] if len(sys.argv) > 3 else 'map'
NAMES = ['One', 'Two', 'Three', 'Four']


def seed():
    v = lab.WORK / 'tabs-vault'
    if v.exists(): shutil.rmtree(v)
    (v / 'Space').mkdir(parents=True)
    for n in NAMES: (v / 'Space' / f'{n}.md').write_text(f'# {n}\n\nText of {n}.\n')
    (v / '.mdnotes').mkdir()
    tabs = [f'Space/{n}.md' for n in NAMES]
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False,
         'session': {'tabs': tabs, 'panes': [tabs[0]], 'focus': 0}}))
    return v


STATE = """() => {
  const strip = document.querySelector('.tab-strip'); const out = [];
  const isl = strip.querySelector('[data-island]');
  for (const m of strip.querySelectorAll('span.bg-brand-400')) { if (!/w-0\\.5/.test(m.className)) continue;
    const inIsl = isl && isl.contains(m); const end = /right-0|-right-/.test(m.className);
    if (inIsl) { const chip = m.parentElement.querySelector('[role=tab]'); out.push('island-bar:' + (end ? 'END' : (chip ? chip.dataset.tip.replace(/^Space\\/|\\.md$/g,'') : '?'))) }
    else { const it = m.closest('[data-strip-item]'); out.push('bar-before:' + (end || !it ? 'END' : it.dataset.stripItem.replace(/^Space\\/|\\.md$/g,''))) } }
  if (isl && [isl, ...isl.querySelectorAll('*')].some(e => typeof e.className === 'string' && /(^| )(ring-brand-400|border-brand-400\\/60)( |$)/.test(e.className))) out.push('island-armed');
  for (const s of strip.querySelectorAll('span.border-brand-400')) { const k = s.closest('[data-tab-key]'); if (!/w-0\\.5/.test(s.className)) out.push((/w-1\\/2/.test(s.className) ? 'split-on:' : 'swap-on:') + (k ? k.dataset.tabKey.replace(/^Space\\/|\\.md$/g,'') : '?')) }
  return out.join(' ') || '-' }"""
ORDER = "() => [...document.querySelectorAll('.tab-strip [data-tab-key]')].map(e => e.dataset.tabKey.replace(/^Space\\/|\\.md$/g,''))"
PANES = "() => document.querySelectorAll('.pane-body').length"


def tabbox(page, name):
    return page.locator(f'.tab-strip [data-tab-key="Space/{name}.md"]').first.bounding_box()


def start(page):
    s = tabbox(page, who)
    x0, y = s['x'] + s['width'] / 2, s['y'] + s['height'] / 2
    page.mouse.move(x0, y); page.mouse.down(); page.mouse.move(x0 - 4, y); time.sleep(0.05)
    return x0, y


def at(page, x, y):
    page.mouse.move(x, y + 1); time.sleep(0.03); page.mouse.move(x, y); time.sleep(0.05)
    return page.evaluate(STATE)


with sync_playwright() as p:
    def launch():
        v = seed(); ud = lab.WORK / 'ud-tabs'; lab.profile(ud, v)
        proc, _ = lab.launch(ud, port, lab.WORK / 'tabs.log')
        b, page = lab.connect(p, port); time.sleep(3)
        return v, proc, b, page
    if mode == 'map':
        v, proc, b, page = launch()
        try:
            print('tabs', page.evaluate(ORDER))
            for n in NAMES:
                bb = tabbox(page, n); print(f'  tab {n:<6} x {bb["x"]:.0f}-{bb["x"] + bb["width"]:.0f}')
            strip = page.locator('.tab-strip').bounding_box()
            x0, y = start(page)
            runs, last = [], None
            for x in range(int(strip['x']), int(strip['x'] + strip['width'])):
                h = at(page, x, y)
                under = page.evaluate(f"() => {{ const e = document.elementFromPoint({x}, {y}); const k = e && e.closest('[data-tab-key]'); return k ? k.dataset.tabKey.replace(/^Space\\//,'') : (e ? e.tagName + '.' + String(e.className).split(' ')[0] : null) }}")
                if (h, under) != last: runs.append([x, x, h, under]); last = (h, under)
                else: runs[-1][1] = x
            page.mouse.up()
            for a, z, h, u in runs: print(f'x {a:>4}-{z:<4} shows: {h:<28} pointer over: {u}')
            json.dump(runs, open(lab.WORK / f'tabruns-{who}.json', 'w'))
            b.close()
        finally:
            lab.stop(proc)
    else:
        runs = json.load(open(lab.WORK / f'tabruns-{who}.json'))
        xs = [int(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else sorted({r[0] for r in runs[1:]} | {r[0] - 1 for r in runs[1:]})
        bad = 0
        for x in xs:
            v, proc, b, page = launch()
            try:
                before = page.evaluate(ORDER); panes0 = page.evaluate(PANES)
                x0, y = start(page)
                for i in range(1, 12): page.mouse.move(x0 + (x - x0) * i / 11, y); time.sleep(0.02)
                h = at(page, x, y); time.sleep(0.12); h = at(page, x, y); time.sleep(0.15)
                page.mouse.up(); time.sleep(1.2)
                after = page.evaluate(ORDER); panes1 = page.evaluate(PANES)
                if h.startswith('bar-before:'):
                    tgt = h.split(':', 1)[1].split(' ')[0]
                    exp = [t for t in before if t != who]
                    exp.insert(len(exp) if tgt == 'END' else exp.index(tgt) if tgt in exp else before.index(who), who)
                    ok = after == exp
                elif h.startswith('island'):
                    ok = who not in after
                elif h.startswith('split-on:'):
                    ok = panes1 == panes0 + 1 or panes1 == 2
                elif h == '-':
                    ok = after == before and panes1 == panes0
                else:
                    ok = None
                bad += 0 if ok else 1
                print(f'x {x:>4} shows {h:<28} -> tabs {after} panes {panes1}  {"ok" if ok else "MISMATCH"}')
                b.close()
            finally:
                lab.stop(proc)
        print('mismatches:', bad, 'of', len(xs))
