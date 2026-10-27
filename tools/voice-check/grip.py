"""The six-dot handle on a plain paragraph, beside a voice note, on a dark Lined page — where Reuben
couldn't see it on hover (2026-10-16). Checks it shows as strongly as the voice note's own grip,
focused or not, and that dragging it moves the whole paragraph.

    WORK=/some/scratch/dir python3 grip.py [shots-dir]

First run, 2026-10-16 (Mac): 6 ok, 0 failed (the old build fails the two hover lines)."""
import json, sys, time
from pathlib import Path
from common import WORK, app, connect, reset_vault
from playwright.sync_api import sync_playwright

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
PARA = 'testing around other things that might make noise, testing this thing to see if the casette works well and keeps going so it wraps'
fails = 0


def check(name: str, ok: bool, saw=None) -> None:
    global fails
    if not ok:
        fails += 1
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


GRIP = """() => { const g = document.querySelector('.cm-line-grip'); const cs = getComputedStyle(g);
  return {shown: g.style.display !== 'none', hover: g.classList.contains('is-hover'), opacity: cs.opacity, color: cs.color} }"""

vault = reset_vault()
note = vault / 'Voice' / 'Wrap.md'
note.write_text(f'# Wrap\n\n<audio controls src="memo.m4a"></audio>\n\n{PARA}\n\nAnother paragraph.\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps(
    {'spaces': [{'folder': 'Voice', 'pageLook': 'lined', 'theme': 'dark'}, {'folder': 'Other'}], 'activeSpaceFolder': 'Voice'}))

with sync_playwright() as p, app(9345):
    b, page = connect(p, 9345)
    page.emulate_media(color_scheme='dark')
    page.locator('.tree-title', has_text='Wrap').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
    time.sleep(0.8)

    # The voice note's own grip, hovered, is the yardstick.
    v = page.locator('.cm-voice').first.bounding_box()
    page.mouse.move(v['x'] + 300, v['y'] + v['height'] / 2)
    time.sleep(0.4)
    voice = page.evaluate("() => { const cs = getComputedStyle(document.querySelector('.cm-voice .cm-attach-grip')); return {opacity: cs.opacity, color: cs.color} }")

    first = page.evaluate("""(t) => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t));
      const r = document.createRange(); r.selectNodeContents(l); const q = r.getClientRects()[0]; return {x: q.left, y: q.top + q.height / 2} }""", PARA[:20])

    for focused in (False, True):
        if focused:
            page.locator('.cm-line', has_text='Another paragraph').click()
        else:
            page.evaluate('() => document.activeElement.blur()')
        time.sleep(0.3)
        page.mouse.move(first['x'] + 120, first['y'], steps=6)
        time.sleep(0.4)
        g = page.evaluate(GRIP)
        label = 'editor focused' if focused else 'editor not focused'
        check(f'hovering the paragraph ({label}): handle shows as strongly as the voice note grip',
              g['shown'] and g['hover'] and g['opacity'] == voice['opacity'] and g['color'] == voice['color'], (g, voice))
        if not focused:
            # the grab area: 24×26 around the 20×14 dots, never reaching the text
            hb = page.evaluate("""(t) => { const g = document.querySelector('.cm-line-grip').getBoundingClientRect();
              const cx = g.left + g.width / 2, cy = g.top + g.height / 2;
              const hit = (x, y) => document.elementFromPoint(x, y)?.classList.contains('cm-line-grip') ?? false;
              const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t));
              const r = document.createRange(); r.selectNodeContents(l); const q = r.getClientRects()[0];
              return {up: hit(cx, cy - 11), down: hit(cx, cy + 11), left: hit(cx - 11, cy), right: hit(cx + 11, cy),
                      textStart: hit(q.left + 1, cy), farUp: hit(cx, cy - 15)} }""", PARA[:20])
            check('the six dots take a click a little way above, below and either side of them',
                  hb['up'] and hb['down'] and hb['left'] and hb['right'], hb)
            check('…but never at the start of the text, nor far off', not hb['textStart'] and not hb['farUp'], hb)
        page.screenshot(path=str(SHOTS / f'grip-{"focused" if focused else "unfocused"}.png'),
                        clip={'x': first['x'] - 90, 'y': first['y'] - 40, 'width': 640, 'height': 120})

    # Drag the handle above the voice note: the whole paragraph moves, both rows of it.
    page.evaluate('() => document.activeElement.blur()')
    page.mouse.move(first['x'] + 120, first['y'], steps=4)
    time.sleep(0.4)
    gb = page.locator('.cm-line-grip').bounding_box()
    page.mouse.move(gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2, steps=4)
    page.mouse.down()
    page.mouse.move(gb['x'] + 10, v['y'] - 30, steps=12)
    time.sleep(0.2)
    page.mouse.move(gb['x'] + 10, v['y'] + 2, steps=6)
    time.sleep(0.3)
    page.mouse.up()
    time.sleep(1.5)
    text = note.read_text()
    check('dragging the handle moves the whole paragraph above the voice note',
          text.index(PARA) < text.index('<audio') and text.count(PARA) == 1, text[:160])
    check('…and nothing else moved with it', 'Another paragraph.' in text and text.index('<audio') < text.index('Another paragraph.'), text)
    b.close()

print(f'\n{fails} failed')
