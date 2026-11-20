"""Sidebar drop targets: what each shows just before release vs where the note lands.
usage: WORK=<build> python3 run_drag_targets.py <port>"""
import json, os, sys, time, shutil
from pathlib import Path
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1])


def seed():
    v = lab.WORK / 'targets-vault'
    if v.exists(): shutil.rmtree(v)
    for d in ['Space/Alpha', 'Space/PinFolder', 'Other/Inbox']:
        (v / d).mkdir(parents=True)
    for f in ['Space/Alpha/a1.md', 'Space/Alpha/a2.md', 'Space/Beta.md', 'Space/Pinned.md', 'Space/Gamma.md',
              'Space/PinFolder/p1.md', 'Other/o1.md', 'Other/Inbox/i1.md']:
        (v / f).write_text('# ' + Path(f).stem + '\n')
    order = ['Alpha', 'Beta.md', 'Pinned.md', 'PinFolder', 'Gamma.md']
    ents = {f'Space/{n}': {'order': i} for i, n in enumerate(order)}
    ents['Space/Pinned.md']['pinned'] = True
    ents['Space/PinFolder']['pinned'] = True
    ents['Other/o1.md'] = {'order': 0}; ents['Other/Inbox'] = {'order': 1}
    (v / '.mdnotes').mkdir()
    (v / '.mdnotes' / 'workspace.json').write_text(json.dumps({'entries': ents}))
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Space', 'freeArrange': True}, {'folder': 'Other', 'freeArrange': True}],
         'activeSpaceFolder': 'Space', 'playStartupAnimation': False}))
    return v


def files(v):
    out = []
    for p in sorted((v).rglob('*')):
        rel = p.relative_to(v).as_posix()
        if rel.startswith('.mdnotes'): continue
        out.append(rel + ('/' if p.is_dir() else ''))
    return out


def trashed(v):
    ws = json.loads((v / '.mdnotes' / 'workspace.json').read_text())
    return [t.get('name') or t.get('path') for t in ws.get('trash', [])]


SHOW = """() => {
  const out = [];
  for (const e of document.querySelectorAll('.drop-before,.drop-after,.drop-into')) out.push((e.className.match(/drop-\\w+/)||[''])[0] + ':' + (e.dataset.rowPath||'?').replace(/^Space\\//,''));
  if (document.querySelector('.tree-drop-end')) out.push('END-LINE');
  for (const b of document.querySelectorAll('aside button[aria-pressed]')) if (/(^| )scale-105( |$)/.test(b.className)) out.push('space-button-lit:' + (b.dataset.tip||'').replace(/^Hold to open | · drop to move here$/g,''));
  for (const b of document.querySelectorAll('aside button')) { const t = b.dataset.tip || ''; if ((t.startsWith('Bin') || t.startsWith('Archive') || t.startsWith('The archive')) && /bg-accent-500\\/15/.test(b.className)) out.push('lit:' + t.split(' ')[0]) }
  return out }"""


def drag(page, src_sel, to_xy, hold=0.35):
    s = page.locator(src_sel).first.bounding_box()
    x0, y0 = s['x'] + 60, s['y'] + s['height'] / 2
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0, y0 + 4); time.sleep(0.05)
    tx, ty = to_xy
    for i in range(1, 14):
        page.mouse.move(x0 + (tx - x0) * i / 13, y0 + (ty - y0) * i / 13); time.sleep(0.02)
    time.sleep(0.12); page.mouse.move(tx + 1, ty); time.sleep(0.08); page.mouse.move(tx, ty); time.sleep(hold)
    shown = page.evaluate(SHOW)
    page.mouse.up(); time.sleep(1.6)
    return shown


def centre(page, sel, fy=0.5):
    b = page.locator(sel).first.bounding_box()
    return (b['x'] + b['width'] / 2, b['y'] + b['height'] * fy)


CASES = [
    ('note onto a PINNED FOLDER', '[data-row-path="Space/Beta.md"]', lambda pg: centre(pg, '[data-row-path="Space/PinFolder"]')),
    ('note onto a PINNED NOTE', '[data-row-path="Space/Beta.md"]', lambda pg: centre(pg, '[data-row-path="Space/Pinned.md"]')),
    ('nested note onto THIS space button', '[data-row-path="Space/Alpha/a1.md"]', lambda pg: centre(pg, 'aside button[aria-pressed="true"]')),
    ('note onto the OTHER space button (quick)', '[data-row-path="Space/Gamma.md"]', lambda pg: centre(pg, 'aside button[aria-pressed="false"][data-tip="Other"]')),
    ('note onto Bin', '[data-row-path="Space/Gamma.md"]', lambda pg: centre(pg, 'aside button[data-tip^="Bin"]')),
    ('note onto Archive', '[data-row-path="Space/Beta.md"]', lambda pg: centre(pg, 'aside button[data-tip*="rchive"]')),
    ('PINNED note into the main list (above Beta)', '[data-row-path="Space/Pinned.md"]', lambda pg: centre(pg, '[data-row-path="Space/Beta.md"]', 0.1)),
]

only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
with sync_playwright() as p:
    for i, (name, src, to) in enumerate(CASES):
        if only and str(i) not in only: continue
        v = seed(); ud = lab.WORK / 'ud-targets'; lab.profile(ud, v)
        proc, _ = lab.launch(ud, port, lab.WORK / 'targets.log')
        try:
            b, page = lab.connect(p, port); time.sleep(2.5)
            page.locator('aside .tree-title', has_text='Alpha').first.click(); time.sleep(0.6)
            before = files(v)
            shown = drag(page, src, to(page))
            after = files(v)
            gone = [f for f in before if f not in after]; new = [f for f in after if f not in before]
            rows = page.evaluate("() => [...document.querySelectorAll('aside .tree-row[data-row-path]')].filter(e => e.offsetParent).map(e => e.dataset.rowPath)")
            order = {k[6:]: m.get('order') for k, m in json.loads((v / '.mdnotes' / 'workspace.json').read_text())['entries'].items() if k.startswith('Space/') and k.count('/') == 1}
            print(f"[{i}] {name}  order now: {sorted(order, key=lambda k: order[k] if order[k] is not None else 99)}")
            print(f"    {name}\n    showing at release: {shown or 'NOTHING'}\n    files moved: {list(zip(gone, new)) or 'none'}  trash: {trashed(v)}\n    sidebar now: {rows}")
            b.close()
        finally:
            lab.stop(proc)
