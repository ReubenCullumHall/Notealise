"""The drag extras of 2026-11-19, all in ONE hidden window (no relaunch between cases):
hold a folder open, drop on Pinned, one undo for a dropped picture, the band over the block,
"Moved · Undo", hold a file over a tab, "3 notes" beside the pointer, Option-drag a link,
a block onto a sidebar note (and its Undo), Finder files onto a folder.
usage: WORK=<build> LAB_SIZE=1280x900 [SHOTS=<folder>] python3 run_drag_extras.py <port>
SHOTS: also saves a picture of each one mid-drag, to look at."""
import base64, json, os, sys, time, shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1])
os.environ.setdefault('LAB_SIZE', '1280x900')
DOC = '# Doc\n\nFirst paragraph here.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nCarry this paragraph.\n\nLast line'
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
ORDER = ['Pinned One.md', 'Folder A', 'Folder B', 'Folder C', 'Doc.md', 'Other.md', 'Pin Me.md', 'Move Me.md',
         'Hold Me.md', 'Sel 1.md', 'Sel 2.md', 'Link Target.md']


def seed():
    v = lab.WORK / 'extras-vault'
    if v.exists(): shutil.rmtree(v)
    for d in ['Folder A', 'Folder B', 'Folder C']: (v / 'Space' / d).mkdir(parents=True)
    for n in ORDER:
        if n.endswith('.md'): (v / 'Space' / n).write_text(f'# {n[:-3]}\n\nText of {n[:-3]}.\n')
    (v / 'Space' / 'Doc.md').write_text(DOC)
    (v / 'Space' / 'Other.md').write_text('# Other\n\nOther text.\n')
    for f in ['Folder A/Inside.md', 'Folder B/B1.md', 'Folder C/C1.md']: (v / 'Space' / f).write_text('# x\n')
    ents = {f'Space/{n}': {'order': i} for i, n in enumerate(ORDER)}
    ents['Space/Pinned One.md']['pinned'] = True
    (v / '.mdnotes').mkdir()
    (v / '.mdnotes' / 'workspace.json').write_text(json.dumps({'entries': ents}))
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Space', 'freeArrange': True}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False,
         'session': {'tabs': ['Space/Doc.md', 'Space/Other.md'], 'panes': ['Space/Doc.md'], 'focus': 0}}))
    return v


results = []
SHOTS = Path(os.environ['SHOTS']) if os.environ.get('SHOTS') else None
if SHOTS: SHOTS.mkdir(parents=True, exist_ok=True)


def shot(page, name, clip=None):
    if SHOTS: page.screenshot(path=str(SHOTS / f'{name}.png'), clip=clip)


SIDEBAR = None  # set once the window is up


def check(name, ok, detail=''):
    results.append((name, ok))
    print(f"{'ok      ' if ok else 'PROBLEM '} {name}" + (f'   — {detail}' if detail else ''))


def row(page, path):
    return page.locator(f'[data-row-path="Space/{path}"]').first


def box(page, path):
    # A long list scrolls: a row below the bottom edge can't be grabbed (the first run "failed"
    # three cases that way — the press landed on the bin bar).
    row(page, path).scroll_into_view_if_needed(); time.sleep(0.15)
    return row(page, path).bounding_box()


def press_drag(page, path, dx=60):
    b = box(page, path)
    x0, y0 = b['x'] + dx, b['y'] + b['height'] / 2
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0, y0 + 4); time.sleep(0.05)
    return x0, y0


def glide(page, frm, to, steps=12):
    for i in range(1, steps + 1):
        page.mouse.move(frm[0] + (to[0] - frm[0]) * i / steps, frm[1] + (to[1] - frm[1]) * i / steps); time.sleep(0.02)


def wiggle(page, at, secs):
    end = time.time() + secs
    k = 0
    while time.time() < end:
        k ^= 1
        page.mouse.move(at[0] + k, at[1]); time.sleep(0.06)


def notice(page):
    return page.evaluate("() => { const n = document.querySelector('.notice'); return n ? n.textContent : '' }")


def ws(v):
    return json.loads((v / '.mdnotes' / 'workspace.json').read_text())['entries']


FILE_DRAG = """async ([sel, files, fy, drop]) => {
  const dt = new DataTransfer()
  for (const [name, type, b64] of files) dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type }))
  const el = document.querySelector(sel); const r = el.getBoundingClientRect()
  const x = r.left + Math.min(60, r.width / 2), y = r.top + r.height * fy
  const at = document.elementFromPoint(x, y)
  for (const t of ['dragenter', 'dragover']) at.dispatchEvent(new DragEvent(t, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const lit = [...document.querySelectorAll('.drop-into,.drop-before,.drop-after')].map(e => e.dataset.rowPath)
  if (drop) at.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  return lit }"""

with sync_playwright() as p:
    v = seed(); ud = lab.WORK / 'ud-extras'; lab.profile(ud, v)
    proc, _ = lab.launch(ud, port, lab.WORK / 'extras.log')
    try:
        b, page = lab.connect(p, port); time.sleep(3)
        page.emulate_media(color_scheme='light', reduced_motion='no-preference'); time.sleep(0.6)
        print('window', page.evaluate('() => [innerWidth, innerHeight]'))
        aside = page.locator('aside').first.bounding_box()
        SIDEBAR = {'x': 0, 'y': 0, 'width': aside['width'] + 10, 'height': aside['height']}
        # Record what a drag's picture was (item 7) — the element is gone a moment later.
        page.evaluate("""() => { const o = DataTransfer.prototype.setDragImage; window.__dragImg = [];
          DataTransfer.prototype.setDragImage = function (el, x, y) { window.__dragImg.push(el.textContent); return o.call(this, el, x, y) } }""")

        # 1 — hold a note over a closed folder: it opens; let go inside it → moved in
        x0, y0 = press_drag(page, 'Hold Me.md')
        fa = box(page, 'Folder A'); tgt = (fa['x'] + 80, fa['y'] + fa['height'] / 2)
        glide(page, (x0, y0), tgt); wiggle(page, tgt, 1.1)
        shot(page, '1-folder-opened-while-held', SIDEBAR)
        opened = page.locator('[data-row-path="Space/Folder A/Inside.md"]').count() > 0
        check('1  a closed folder opens while a note is held over it', opened)
        ib = box(page, 'Folder A/Inside.md') if opened else None
        if ib:
            glide(page, tgt, (ib['x'] + 80, ib['y'] + ib['height'] * 0.75), 6); wiggle(page, (ib['x'] + 80, ib['y'] + ib['height'] * 0.75), 0.3)
        page.mouse.up(); time.sleep(1.6)
        check('1  …and the note can be dropped inside it', (v / 'Space/Folder A/Hold Me.md').exists())
        # The move's notice (5) comes up here too.
        n = notice(page)
        check('5  a move into a folder says so with Undo', 'Moved “Hold Me” to Folder A' in n and 'Undo' in n, repr(n))
        time.sleep(0.3)

        # 2 — a note dropped on Pinned (its heading) is pinned
        x0, y0 = press_drag(page, 'Pin Me.md')
        head = page.locator('.pin-zone p').first.bounding_box(); tgt = (head['x'] + 80, head['y'] + head['height'] / 2)
        glide(page, (x0, y0), tgt); wiggle(page, tgt, 0.3)
        lit = page.evaluate("() => !!document.querySelector('.pin-zone.pin-lit')")
        shot(page, '2-pinned-lit', SIDEBAR)
        page.mouse.up(); time.sleep(1.4)
        check('2  Pinned lights while a note is over it', lit)
        check('2  …and the note dropped there is pinned', ws(v).get('Space/Pin Me.md', {}).get('pinned') is True)
        # and onto a pinned NOTE row too
        x0, y0 = press_drag(page, 'Link Target.md')
        pr = box(page, 'Pinned One.md'); tgt = (pr['x'] + 80, pr['y'] + pr['height'] / 2)
        glide(page, (x0, y0), tgt); wiggle(page, tgt, 0.3); page.mouse.up(); time.sleep(1.4)
        check('2  …dropped on a pinned note it is pinned as well', ws(v).get('Space/Link Target.md', {}).get('pinned') is True)
        # unpin it again for later cases (it is the link target)
        page.evaluate("() => 0")

        # 5 — move then Undo puts it back where it was
        x0, y0 = press_drag(page, 'Move Me.md')
        fb = box(page, 'Folder B'); tgt = (fb['x'] + 80, fb['y'] + fb['height'] / 2)
        glide(page, (x0, y0), tgt); wiggle(page, tgt, 0.25); page.mouse.up(); time.sleep(1.6)
        moved = (v / 'Space/Folder B/Move Me.md').exists()
        page.locator('.notice-action').first.click(); time.sleep(1.8)
        back = (v / 'Space/Move Me.md').exists() and not (v / 'Space/Folder B/Move Me.md').exists()
        order = ws(v).get('Space/Move Me.md', {}).get('order')
        check('5  Undo puts the moved note back in its folder, in its old place', moved and back and order == ORDER.index('Move Me.md'), f'moved {moved} back {back} order {order}')

        # 7 — several rows: "2 notes" beside the pointer
        page.keyboard.press('Escape')
        g1 = row(page, 'Sel 1.md').locator('[data-row-grip], .row-grip, button').first
        page.evaluate("""() => { const pick = (p) => { const r = document.querySelector(`[data-row-path="${p}"]`); return r } }""")
        # select both through the grip (first click enters selecting), then a plain click adds
        grip = page.evaluate("""() => { const r = document.querySelector('[data-row-path="Space/Sel 1.md"]'); const g = r && r.querySelector('[data-tip*="select"], [aria-label*="elect"]'); if (!g) return null; const b = g.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }""")
        if grip:
            page.mouse.click(grip[0], grip[1]); time.sleep(0.3)
            s2 = box(page, 'Sel 2.md'); page.mouse.click(s2['x'] + 90, s2['y'] + s2['height'] / 2); time.sleep(0.3)
        # what the label looks like: the same element, put on screen for a moment
        page.evaluate("""() => { const t = document.createElement('div'); t.className = 'drag-count'; t.id = 'shot-count'; const s = document.createElement('span'); s.textContent = '2 notes'; t.appendChild(s); t.style.top = '120px'; t.style.left = '420px'; document.body.appendChild(t) }""")
        time.sleep(0.2); shot(page, '7-two-notes-label', {'x': 400, 'y': 110, 'width': 200, 'height': 70})
        page.evaluate("() => document.getElementById('shot-count').remove()")
        page.evaluate('() => { window.__dragImg = [] }')
        x0, y0 = press_drag(page, 'Sel 1.md', 90)
        glide(page, (x0, y0), (x0 + 30, y0 - 60), 5); time.sleep(0.2)
        page.keyboard.press('Escape'); page.mouse.up(); time.sleep(0.6)
        imgs = page.evaluate('() => window.__dragImg')
        check('7  dragging two picked notes shows "2 notes" beside the pointer', imgs == ['2 notes'], f'grip {bool(grip)}, picture {imgs}')
        page.keyboard.press('Escape'); time.sleep(0.3)

        # 10 — Finder files onto a folder: a .md becomes a note in it, a picture is copied in
        lit = page.evaluate(FILE_DRAG, ['[data-row-path="Space/Folder C"]', [['Dropped Note.md', 'text/markdown', base64.b64encode(b'# Dropped\n\nHello.\n').decode()], ['pic.png', 'image/png', PNG], ['tool.exe', 'application/octet-stream', base64.b64encode(b'MZ').decode()]], 0.5, True])
        time.sleep(1.8)
        n = notice(page)
        made = (v / 'Space/Folder C/Dropped Note.md')
        check('10 files dragged from Finder light the folder', 'Space/Folder C' in lit, str(lit))
        check('10 …a Markdown file becomes a note in it, word for word', made.exists() and made.read_text() == '# Dropped\n\nHello.\n')
        check('10 …a picture is copied in beside it', (v / 'Space/Folder C/pic.png').exists())
        check('10 …a program is left out, and the notice says so', not (v / 'Space/Folder C/tool.exe').exists() and 'left out' in n and 'Copied 2 files into Folder C' in n, repr(n))
        # at the line, between two notes
        page.evaluate(FILE_DRAG, ['[data-row-path="Space/Other.md"]', [['Lined Up.md', 'text/markdown', base64.b64encode(b'x').decode()]], 0.9, True])
        time.sleep(1.8)
        e = ws(v)
        o_other, o_new, o_pin = e.get('Space/Other.md', {}).get('order'), e.get('Space/Lined Up.md', {}).get('order'), e.get('Space/Pin Me.md', {}).get('order')
        rows = page.evaluate("() => [...document.querySelectorAll('[data-tree-mode=\"tree\"] [data-row-path]')].filter(e => e.offsetParent).map(e => e.dataset.rowPath.replace('Space/',''))")
        check('10 a note dropped under "Other" lands right under it', 'Lined Up.md' in rows and rows.index('Lined Up.md') == rows.index('Other.md') + 1, str(rows))

        # 6 — a file held over the other tab brings that note to the front
        page.evaluate("""async (png) => {
          const tab = [...document.querySelectorAll('[role=tab]')].find(t => (t.dataset.tip || '') === 'Space/Other.md' || t.textContent.includes('Other'))
          const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'p.png', { type: 'image/png' }))
          const r = tab.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2
          tab.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
          for (let i = 0; i < 5; i++) { tab.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 50)) }
          window.__tabDrag = [tab, dt, x, y]
        }""", PNG)
        tb = page.locator('[role=tablist]').first.bounding_box()
        shot(page, '6-tab-about-to-open', {'x': tb['x'], 'y': tb['y'], 'width': min(700, tb['width']), 'height': tb['height']})
        page.evaluate("""async () => { const [tab, dt, x, y] = window.__tabDrag
          for (let i = 0; i < 11; i++) { tab.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 50)) } }""")
        time.sleep(0.6)
        active = page.evaluate("() => { const t = document.querySelector('[role=tab][aria-selected=true]'); return t ? t.textContent : '' }")
        check('6  a file held over a tab brings that note to the front', 'Other' in active, repr(active))
        # back to Doc
        page.locator('[role=tab]', has_text='Doc').first.click(); time.sleep(1.0)

        # 4 + 3 — a picture over the table (first just held, for the picture)
        page.evaluate("""(png) => {
          const td = [...document.querySelectorAll('.cm-content td')].find(e => e.textContent.trim() === '1')
          const r = td.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2
          const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'pic.png', { type: 'image/png' }))
          const at = document.elementFromPoint(x, y)
          for (const t of ['dragenter', 'dragover']) at.dispatchEvent(new DragEvent(t, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })) }""", PNG)
        time.sleep(0.3)
        ed = page.locator('.cm-content').first.bounding_box()
        shot(page, '4-band-over-table', {'x': ed['x'] - 20, 'y': ed['y'], 'width': min(760, ed['width'] + 40), 'height': 420})
        # …and dropped: a band over the whole table; ONE Cmd+Z takes it all away
        shown = page.evaluate("""async (png) => {
          const td = [...document.querySelectorAll('.cm-content td')].find(e => e.textContent.trim() === '1')
          const r = td.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2
          const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'pic.png', { type: 'image/png' }))
          const at = document.elementFromPoint(x, y)
          for (const t of ['dragenter', 'dragover']) at.dispatchEvent(new DragEvent(t, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          const band = document.querySelector('.cm-fileDropBand'), bar = document.querySelector('.cm-fileDropLine')
          const table = td.closest('table').getBoundingClientRect()
          const B = band && band.style.display !== 'none' ? band.getBoundingClientRect() : null
          const L = bar && bar.style.display !== 'none' ? bar.getBoundingClientRect() : null
          at.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
          return { band: B && [B.top, B.bottom], line: L && L.top + L.height / 2, table: [table.top, table.bottom] }
        }""", PNG)
        b4 = shown['band']
        check('4  a faint band covers the whole table while a picture is held over it',
              bool(b4) and abs(b4[0] - shown['table'][0]) <= 8 and abs(b4[1] - shown['line']) <= 2, json.dumps(shown))
        time.sleep(2.0)
        txt = (v / 'Space/Doc.md').read_text()
        added = '| 1 | 2 |\n\n![](pic.png)\n\nCarry' in txt
        page.locator('.cm-content').first.click(position={'x': 40, 'y': 10}); time.sleep(0.2)
        page.keyboard.press('Meta+z'); time.sleep(1.4)
        check('3  the picture goes in under the table with its empty line', added, repr(txt[:120]))
        check('3  …and ONE Cmd+Z takes both away', (v / 'Space/Doc.md').read_text() == DOC, repr((v / 'Space/Doc.md').read_text()[:140]))

        # 8 — Option-drag a sidebar note into the note: a link goes in at the line
        x0, y0 = press_drag(page, 'Sel 2.md')
        line = page.evaluate("""() => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith('First paragraph')); const r = l.getBoundingClientRect(); return [r.left + 80, r.top + r.height / 2] }""")
        page.keyboard.down('Alt')
        glide(page, (x0, y0), tuple(line), 14); wiggle(page, tuple(line), 0.3)
        lit = page.evaluate("() => { const b = document.querySelector('.cm-fileDropLine'); return !!b && b.style.display !== 'none' }")
        shot(page, '8-option-link-line', {'x': ed['x'] - 20, 'y': ed['y'], 'width': min(760, ed['width'] + 40), 'height': 420})
        page.mouse.up(); page.keyboard.up('Alt'); time.sleep(1.4)
        txt = (v / 'Space/Doc.md').read_text()
        check('8  with Option held, the drop line shows in the note', lit)
        check('8  …and a link to the note goes in on its own line under that paragraph', 'First paragraph here.\n[[Sel 2]]\n' in txt and (v / 'Space/Sel 2.md').exists(), repr(txt[:80]))
        page.keyboard.press('Meta+z'); time.sleep(1.2)
        check('8  …one Cmd+Z takes it out', (v / 'Space/Doc.md').read_text() == DOC)
        # without Option it still opens beside (the drop boxes), never a link
        x0, y0 = press_drag(page, 'Sel 2.md')
        glide(page, (x0, y0), tuple(line), 14); wiggle(page, tuple(line), 0.3)
        zone = page.evaluate("() => !!document.querySelector('.pane-col div.border-brand-400')")
        # Escape doesn't cancel a robot drag: carry it back to its own row before letting go, or it
        # opens a second column (the first version of this check did).
        glide(page, tuple(line), (x0, y0), 14); wiggle(page, (x0, y0), 0.2)
        page.mouse.up(); time.sleep(0.8)
        cols = page.evaluate("() => document.querySelectorAll('.pane-col').length")
        check('8  without Option the drop boxes show as before (no link)', zone and (v / 'Space/Doc.md').read_text() == DOC and cols == 1, f'columns {cols}')

        # 9 — a block carried by its six dots onto "Other" in the sidebar → to the end of Other
        first = page.evaluate("""() => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith('Carry this')); const r = document.createRange(); r.selectNodeContents(l); const q = r.getClientRects()[0]; return {x: q.left, y: q.top + q.height / 2} }""")
        page.mouse.move(first['x'] + 120, first['y'], steps=4); time.sleep(0.5)
        grips = page.evaluate("""(y) => [...document.querySelectorAll('.cm-line-grip')].map(g => g.getBoundingClientRect()).filter(r => r.width && Math.abs(r.top + r.height / 2 - y) < 14).map(r => [r.x + r.width / 2, r.y + r.height / 2])""", first['y'])
        if grips:
            gx, gy = grips[0]
            page.mouse.move(gx, gy, steps=3); page.mouse.down(); page.mouse.move(gx + 4, gy + 12, steps=3)
            ob = box(page, 'Other.md'); tgt = (ob['x'] + 90, ob['y'] + ob['height'] / 2)
            glide(page, (gx + 4, gy + 12), tgt, 16); time.sleep(0.3)
            lit = page.evaluate("() => { const r = document.querySelector('[data-row-path=\"Space/Other.md\"]'); return !!r && r.classList.contains('drop-into') }")
            shot(page, '9-block-over-sidebar-note', {'x': 0, 'y': 0, 'width': 1100, 'height': 700})
            page.mouse.up(); time.sleep(1.8)
            doc_now, other_now = (v / 'Space/Doc.md').read_text(), (v / 'Space/Other.md').read_text()
            n = notice(page)
            check('9  the sidebar note lights while a block is carried over it', lit)
            check('9  …let go: the block leaves this note and goes on the end of that one',
                  'Carry this paragraph.' not in doc_now and other_now == '# Other\n\nOther text.\n\nCarry this paragraph.\n', repr(other_now))
            check('9  …with a "Moved to" notice', 'Moved to “Other”' in n, repr(n))
            page.locator('.notice-action').first.click(); time.sleep(1.8)
            check('9  Undo puts it back in both notes', (v / 'Space/Doc.md').read_text() == DOC and (v / 'Space/Other.md').read_text() == '# Other\n\nOther text.\n',
                  repr((v / 'Space/Doc.md').read_text()[-60:]) + ' / ' + repr((v / 'Space/Other.md').read_text()))
        else:
            check('9  found the six dots of the paragraph', False)

        alive = page.evaluate("() => !!document.querySelector('.cm-line-grip') && !!document.querySelector('.cm-fileDropLine')")
        check('the note\'s drop helpers are still running after all that', alive)
        b.close()
    finally:
        lab.stop(proc)
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)} of {len(results)} ok')
