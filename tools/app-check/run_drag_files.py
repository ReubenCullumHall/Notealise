"""A picture dragged in from outside onto a note: where the drop line shows vs where it lands.
ONE window for the whole run (hidden — lab.launch is quiet); the note is put back between drops.
usage: WORK=<build> python3 run_drag_files.py <port>"""
import base64, json, sys, time, shutil
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import lab
from playwright.sync_api import sync_playwright

port = int(sys.argv[1])
NOTE = '# Drop here\n\nSome words in a line\nA second line\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nLast line'
PNG = base64.b64encode(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).decode()
# (what the pointer is over, as SHOWN — a table is drawn, a heading's # is hidden; x as a share of its
# width) → what the note should read after. Under a table an empty line goes in first, so the picture sits one
# line (~27px) below the marker there — the marker is the edge everything new goes in at.
CASES = [
    ('.cm-line', 'Some words in a line', 0.3, 'Some words in a line\n![](pic.png)\nA second line'),
    ('.cm-line', 'A second line', 0.9, 'A second line\n![](pic.png)\n\n| a'),
    ('.cm-content td', '1', 0.5, '| 1 | 2 |\n\n![](pic.png)\n\nLast'),
    ('.cm-line', 'Last line', 0.5, 'Last line\n![](pic.png)'),
    ('.cm-line', 'Drop here', 0.2, '# Drop here\n![](pic.png)\n\nSome'),
]


def seed():
    v = lab.WORK / 'files-vault'
    if v.exists(): shutil.rmtree(v)
    (v / 'Space').mkdir(parents=True)
    (v / 'Space' / 'Drop.md').write_text(NOTE)
    (v / '.mdnotes').mkdir()
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False,
         'session': {'tabs': ['Space/Drop.md'], 'panes': ['Space/Drop.md'], 'focus': 0}}))
    return v


DRAG = """async ([x, y, png, drop]) => {
  const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'pic.png', { type: 'image/png' }))
  const at = document.elementFromPoint(x, y)
  for (const type of ['dragenter', 'dragover']) at.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const bar = document.querySelector('.cm-fileDropLine'); const caret = document.querySelector('.cm-dropCursor')
  const b = bar && bar.style.display !== 'none' ? bar.getBoundingClientRect() : null
  const shown = { bar: b && { y: b.top + b.height / 2, left: b.left, width: b.width }, caret: !!(caret && caret.offsetParent) }
  if (drop) at.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  return shown }"""
EMBED_TOP = """() => { const im = [...document.querySelectorAll('.cm-content img')].find(e => /pic(%20|-|\\d)*\\.png|pic\\.png/.test(e.getAttribute('src') || ''));
  const l = im && (im.closest('.cm-line') || im); return l ? l.getBoundingClientRect().top : null }"""

with sync_playwright() as p:
    v = seed(); ud = lab.WORK / 'ud-files'; lab.profile(ud, v)
    proc, _ = lab.launch(ud, port, lab.WORK / 'files.log')
    bad = 0
    try:
        b, page = lab.connect(p, port); time.sleep(3)
        for sel, line, fx, expect in CASES:
            (v / 'Space' / 'Drop.md').write_text(NOTE)  # put the note back (the window picks up the outside change)
            for f in v.joinpath('Space').glob('pic*.png'): f.unlink()
            time.sleep(1.2)
            box = page.locator(sel, has_text=line).first.bounding_box()
            x, y = box['x'] + box['width'] * fx, box['y'] + box['height'] / 2
            shown = page.evaluate(DRAG, [x, y, PNG, True])
            time.sleep(1.8)
            text = (v / 'Space' / 'Drop.md').read_text()
            top = page.evaluate(EMBED_TOP)
            gap = None if (top is None or not shown['bar']) else round(top - shown['bar']['y'], 1)
            want = 27 if line == '1' else 0
            ok = expect in text and shown['bar'] is not None and not shown['caret'] and gap is not None and abs(gap - want) <= 6
            bad += 0 if ok else 1
            print(f"over {line!r:<24} line at y {shown['bar'] and round(shown['bar']['y'])}  caret {shown['caret']}  "
                  f"picture's top {top and round(top)} (gap {gap})  {'ok' if ok else 'MISMATCH'}")
            if not ok: print('   note now:', repr(text))
        # Off the note: the line goes.
        page.evaluate(DRAG, [box['x'] + 30, box['y'] + 10, PNG, False])
        page.mouse.move(5, 5)
        page.evaluate("() => document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))")
        gone = page.evaluate("() => { const b = document.querySelector('.cm-fileDropLine'); return !b || b.style.display === 'none' }")
        print('line gone after leaving the note:', gone); bad += 0 if gone else 1
        b.close()
    finally:
        lab.stop(proc)
    print('mismatches:', bad, 'of', len(CASES) + 1)
