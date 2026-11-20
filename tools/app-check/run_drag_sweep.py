"""Sidebar drag (2026-11-18). NEEDS a build whose TreeView setHint also sets window.__hint = h (see README).
Pixel sweep of the sidebar drag line, plus releases on both sides of every edge.
usage: WORK=<build> python3 run_drag_sweep.py <port> <dragged title> [release]
  without 'release': one launch, sweep every pixel, print the line map.
  with 'release': for each edge in the map, relaunch, release 1px each side, compare landing."""
import json, sys, time, shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1]); who = sys.argv[2]; mode = sys.argv[3] if len(sys.argv) > 3 else 'map'
SP = 'Space'


def seed():
    v = lab.WORK / 'sweep-vault'
    if v.exists(): shutil.rmtree(v)
    (v / SP / 'Alpha').mkdir(parents=True)
    (v / SP / 'Alpha' / 'a1.md').write_text('# a1\n'); (v / SP / 'Alpha' / 'a2.md').write_text('# a2\n')
    (v / SP / 'Gamma').mkdir(); (v / SP / 'Gamma' / 'g1.md').write_text('# g1\n')
    (v / SP / 'Echo').mkdir()
    for n in ['Moved', 'Beta', 'Delta', 'Foxtrot']:
        (v / SP / f'{n}.md').write_text(f'# {n}\n')
    order = ['Moved.md', 'Alpha', 'Beta.md', 'Gamma', 'Delta.md', 'Echo', 'Foxtrot.md']
    ents = {f'{SP}/{n}': {'order': i} for i, n in enumerate(order)}
    ents[f'{SP}/Moved.md']['movedAt'] = 1790000000000
    ents[f'{SP}/Alpha/a1.md'] = {'order': 0}; ents[f'{SP}/Alpha/a2.md'] = {'order': 1}
    (v / '.mdnotes').mkdir()
    (v / '.mdnotes' / 'workspace.json').write_text(json.dumps({'entries': ents}))
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': SP, 'freeArrange': True}], 'activeSpaceFolder': SP, 'playStartupAnimation': False}))
    return v


ROWS = """() => [...document.querySelectorAll('aside .tree-row[data-row-path]')].filter(e => e.offsetParent).map(e => {
  const r = e.getBoundingClientRect(); return {p: e.dataset.rowPath.slice(6), y: r.top, b: r.bottom, x: r.left} })"""
HINT = "() => { if (document.querySelector('.tree-drop-end')) return 'END'; const h = window.__hint; return h ? (h.kind === 'into' ? 'into ' + h.path.slice(6) : (h.after ? 'after ' : 'before ') + h.path.slice(6)) : '-' }"


def open_app():
    v = seed(); ud = lab.WORK / 'ud-sweep'; lab.profile(ud, v)
    proc, _ = lab.launch(ud, port, lab.WORK / 'sweep.log')
    return v, proc


def ready(p):
    b, page = lab.connect(p, port); time.sleep(2.5)
    page.locator('aside .tree-title', has_text='Alpha').first.click(); time.sleep(0.8)  # open Alpha
    return b, page


def start_drag(page, rows):
    s = next(r for r in rows if r['p'] == who)
    page.mouse.move(s['x'] + 60, (s['y'] + s['b']) / 2); page.mouse.down()
    page.mouse.move(s['x'] + 60, (s['y'] + s['b']) / 2 + 4); time.sleep(0.1)
    return s


def at(page, x, y):
    page.mouse.move(x + 1, y); time.sleep(0.03); page.mouse.move(x, y); time.sleep(0.05)
    return page.evaluate(HINT)


def visible_order(page):
    return [r['p'] for r in page.evaluate(ROWS)]


def saved(v):
    e = json.loads((v / '.mdnotes' / 'workspace.json').read_text())['entries']
    return e


with sync_playwright() as p:
    if mode == 'map':
        v, proc = open_app()
        try:
            b, page = ready(p)
            rows = page.evaluate(ROWS)
            for r in rows: print(f"   row {r['p']:<14} {r['y']:.0f}-{r['b']:.0f}")
            s = start_drag(page, rows)
            top, bot = int(rows[0]['y']) - 30, int(rows[-1]['b']) + 40
            runs, last = [], None
            for y in range(top, bot):
                h = at(page, s['x'] + 60, y)
                under = page.evaluate(f"() => {{ const e = document.elementFromPoint({s['x'] + 60}, {y}); const r = e && e.closest('[data-row-path]'); return r ? r.dataset.rowPath.slice(6) : (e ? e.tagName + '.' + String(e.className).split(' ')[0] : null) }}")
                key = (h, under)
                if key != last:
                    runs.append([y, y, h, under]); last = key
                else:
                    runs[-1][1] = y
            page.mouse.up(); time.sleep(0.3)
            for a, z, h, u in runs: print(f"y {a:>4}-{z:<4} line: {h:<18} pointer over: {u}")
            json.dump(runs, open(lab.WORK / f'runs-{who.replace("/", "_")}.json', 'w'))
            b.close()
        finally:
            lab.stop(proc)
    else:
        runs = json.load(open(lab.WORK / f'runs-{who.replace("/", "_")}.json'))
        ys = sorted({r[0] for r in runs[1:]} | {r[0] - 1 for r in runs[1:]})
        if len(sys.argv) > 4: ys = [int(x) for x in sys.argv[4].split(',')]
        bad = 0
        for y in ys:
            v, proc = open_app()
            try:
                b, page = ready(p)
                rows = page.evaluate(ROWS); before = [r['p'] for r in rows]
                s = start_drag(page, rows)
                y0 = (s['y'] + s['b']) / 2
                for i in range(1, 13):
                    page.mouse.move(s['x'] + 60, y0 + (y - y0) * i / 12); time.sleep(0.02)
                h = at(page, s['x'] + 60, y); time.sleep(0.15); h = at(page, s['x'] + 60, y); time.sleep(0.2)
                page.mouse.up(); time.sleep(1.5)
                after = visible_order(page)
                # expected from the line alone
                if h == '-':
                    exp = before
                elif h == 'END':
                    exp = [q for q in before if q != who] + [who]
                elif h.startswith('into '):
                    tgt = h[5:]
                    exp = 'into'
                else:
                    side, anchor = h.split(' ', 1)
                    if anchor == who:
                        exp = before
                    else:
                        # moving within the same parent only (top level / Alpha)
                        lst = [q for q in before if q != who and not q.startswith(who + '/')]
                        par = anchor.rsplit('/', 1)[0] if '/' in anchor else ''
                        name = who.rsplit('/', 1)[-1]
                        newp = f'{par}/{name}' if par else name
                        i = lst.index(anchor) + (1 if side == 'after' else 0)
                        if side == 'after' and anchor in ('Alpha',) and any(q.startswith('Alpha/') for q in lst):
                            i = lst.index(anchor) + 1 + sum(1 for q in lst if q.startswith('Alpha/'))
                        lst.insert(i, newp); exp = lst
                if exp == 'into':
                    ok = who not in after and any(q.startswith(h[5:] + '/') or q == h[5:] for q in after)
                else:
                    ok = after[:len(exp)] == exp[:len(after)]
                bad += 0 if ok else 1
                print(f"y {y:>4} line {h:<18} {'ok' if ok else 'MISMATCH'}" + ('' if ok else f"\n     expected {exp}\n     got      {after}"))
                b.close()
            finally:
                lab.stop(proc)
        print('mismatches:', bad, 'of', len(ys))
