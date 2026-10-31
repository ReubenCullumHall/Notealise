"""The drag ghost (editor/dragGhost.ts, Reuben 2026-10-16): carrying a block by its six dots opens a
gap at the drop point holding a greyed copy of the block, instead of a line. Checks the gap is the
block's size and holds its copy, that it moves steadily (never jumps back up while the pointer goes
down), that the drop lands where the gap was, that Escape changes nothing, and a voice note's copy.

    WORK=/some/scratch/dir python3 ghost.py [shots-dir]

First run, 2026-10-16 (Mac): 13 ok, 0 failed."""
import json, sys, time
from pathlib import Path
from common import WORK, app, connect, reset_vault, MOD
from playwright.sync_api import sync_playwright

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
PARA = 'testing around other things that might make noise, testing this thing to see if the casette works well and keeps going so it wraps'
oks = fails = 0


def check(name: str, ok: bool, saw=None) -> None:
    global oks, fails
    ok = bool(ok)
    oks += ok
    fails += not ok
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


GHOST = """() => { const g = document.querySelector('.cm-drag-ghost'); if (!g) return null;
  const next = g.nextElementSibling; const r = g.getBoundingClientRect();
  return {h: Math.round(r.height), top: Math.round(r.top), text: g.textContent.slice(0, 40), voice: !!g.querySelector('.cm-voice'),
          before: next ? next.textContent.slice(0, 24) : '(end)',
          gone: document.querySelectorAll('.cm-drag-gone').length,
          marker: !!document.querySelector('.cm-attach-drop-marker')} }"""

vault = reset_vault()
note = vault / 'Voice' / 'Wrap.md'
lines = ['# Wrap', '', '<audio controls src="memo.m4a"></audio>', '', PARA, '']
lines += [f'Line {i} of the rest of the note.' for i in range(1, 13)]
note.write_text('\n'.join(lines) + '\n')
original = note.read_text()
# The voice note straight under the text, no blank line — how a recording goes in (Reuben's case).
tight = vault / 'Voice' / 'Tight.md'
tight.write_text(f'# Tight\n\n{PARA}\n<audio controls src="memo.m4a"></audio>\nNext line.\nAnd the last line.\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps(
    {'spaces': [{'folder': 'Voice', 'pageLook': 'lined', 'theme': 'dark'}, {'folder': 'Other'}], 'activeSpaceFolder': 'Voice'}))

with sync_playwright() as p, app(9347):
    b, page = connect(p, 9347)
    page.emulate_media(color_scheme='dark')
    page.locator('.tree-title', has_text='Wrap').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
    time.sleep(0.8)
    page.evaluate('() => document.activeElement.blur()')

    def grab_paragraph():
        first = page.evaluate("""(t) => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t));
          const r = document.createRange(); r.selectNodeContents(l); const q = r.getClientRects()[0]; const b = l.getBoundingClientRect();
          return {x: q.left, y: q.top + q.height / 2, h: b.height} }""", PARA[:20])
        page.mouse.move(first['x'] + 120, first['y'], steps=4)
        time.sleep(0.4)
        g = page.locator('.cm-line-grip').bounding_box()
        page.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2, steps=3)
        page.mouse.down()
        return first, g

    # --- carry the paragraph down the note ---------------------------------------
    first, g = grab_paragraph()
    x = g['x'] + 10
    page.mouse.move(x, first['y'] + 10, steps=4)  # past the 4px start
    targets, prev = [], None
    y = first['y'] + 10
    while y < first['y'] + 420:
        y += 6
        page.mouse.move(x, y)
        time.sleep(0.03)
        gh = page.evaluate(GHOST)
        if gh and gh['before'] != prev:
            targets.append(gh['before'])
            prev = gh['before']
    gh = page.evaluate(GHOST)
    check('carrying it shows a ghost, not the line', gh is not None and not gh['marker'], gh)
    check('the ghost is the paragraph\'s own size and holds its words', gh and abs(gh['h'] - round(first['h'])) <= 1 and gh['text'].startswith(PARA[:30]), (gh, first['h']))
    check('the paragraph\'s own place closes up while it is carried', gh and gh['gone'] == 1, gh)
    idx = [int(t.split()[1]) for t in targets if t.startswith('Line ')]
    check('moving down, the gap only ever moves down — it never jumps back', idx == sorted(idx) and len(idx) >= 4, targets)
    page.screenshot(path=str(SHOTS / 'ghost-01-carry.png'), clip={'x': x - 60, 'y': first['y'] - 60, 'width': 900, 'height': 560})

    # Held still over the gap, it stays put.
    gh_before = page.evaluate(GHOST)
    for dy in (2, -3, 4, -1):
        page.mouse.move(x, y + dy)
        time.sleep(0.05)
    gh_after = page.evaluate(GHOST)
    check('wiggling over the gap leaves it where it is', gh_before and gh_after and gh_before['before'] == gh_after['before'], (gh_before, gh_after))
    landing = gh_after['before'] if gh_after else ''
    page.mouse.up()
    time.sleep(1.5)
    text = note.read_text()
    rest = text.split(PARA, 1)[1].lstrip('\n') if PARA in text else None
    lands = rest == '' if landing == '(end)' else rest is not None and rest.startswith(landing.strip()[:12])
    check('dropped: it lands where the gap was', lands, (landing, rest[:30] if rest else rest))
    check('…and the ghost is gone, the place open again', page.evaluate(GHOST) is None and page.evaluate("() => document.querySelectorAll('.cm-drag-gone').length") == 0)

    # --- Escape mid-carry changes nothing -------------------------------------------
    page.keyboard.press(f'{MOD}+z')
    time.sleep(1.2)
    check('(undo put it back)', note.read_text() == original, note.read_text()[:200])
    page.evaluate('() => document.activeElement.blur()')
    first, g = grab_paragraph()
    page.mouse.move(g['x'] + 10, first['y'] + 120, steps=10)
    time.sleep(0.2)
    page.keyboard.press('Escape')
    time.sleep(0.3)
    page.mouse.up()
    time.sleep(1.2)
    check('Escape mid-carry: no ghost, nothing moved', page.evaluate(GHOST) is None and note.read_text() == original, page.evaluate(GHOST))

    # --- a voice note's ghost -------------------------------------------------------------
    v = page.locator('.cm-voice').first
    vb = v.bounding_box()
    # the slot it takes in the note: its whole line, rule-snapped padding and all
    slot = page.evaluate("() => Math.round(document.querySelector('.cm-voice').closest('.cm-line').getBoundingClientRect().height)")
    v.hover()
    time.sleep(0.3)
    grip = page.locator('.cm-voice .cm-attach-grip').first.bounding_box()
    page.mouse.move(grip['x'] + grip['width'] / 2, grip['y'] + grip['height'] / 2)
    page.mouse.down()
    y = grip['y'] + 10
    page.mouse.move(grip['x'] + 8, y, steps=3)
    gh = None
    # Down until the gap sits below the paragraph (the gap is under the pointer,
    # so it passes a line once the pointer is past that line's middle).
    while y < grip['y'] + 700:
        y += 6
        page.mouse.move(grip['x'] + 8, y)
        time.sleep(0.03)
        gh = page.evaluate(GHOST)
        if gh and gh['before'].startswith('Line 1 '):
            break
    check('carrying a voice note: its ghost is a greyed copy of the player, its slot\'s size', gh and gh['voice'] and abs(gh['h'] - slot) <= 1, (gh, slot))
    page.screenshot(path=str(SHOTS / 'ghost-02-voice.png'), clip={'x': vb['x'] - 60, 'y': vb['y'] - 40, 'width': vb['width'] + 100, 'height': 460})
    page.mouse.up()
    time.sleep(1.5)
    text = note.read_text()
    check('dropped: the voice note moved below the paragraph', text.index('<audio') > text.index(PARA), text[:200])

    # --- light theme look ------------------------------------------------------------------
    page.emulate_media(color_scheme='light')
    time.sleep(0.6)
    page.evaluate('() => document.activeElement.blur()')
    first, g = grab_paragraph()
    page.mouse.move(g['x'] + 10, first['y'] + 140, steps=12)
    time.sleep(0.4)
    page.screenshot(path=str(SHOTS / 'ghost-03-light.png'), clip={'x': g['x'] - 50, 'y': first['y'] - 60, 'width': 900, 'height': 400})
    page.keyboard.press('Escape')
    page.mouse.up()
    time.sleep(0.5)

    # --- the voice note right under the paragraph stays put -------------------------------
    page.locator('.tree-title', has_text='Tight').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
    time.sleep(0.8)
    page.evaluate('() => document.activeElement.blur()')
    first, g = grab_paragraph()
    y = first['y'] + 10
    page.mouse.move(g['x'] + 10, y, steps=3)
    gh = None
    while y < first['y'] + 600:
        y += 6
        page.mouse.move(g['x'] + 10, y)
        time.sleep(0.03)
        gh = page.evaluate(GHOST)
        if gh and gh['before'] == '(end)':
            break
    check('carrying the paragraph: its ghost holds the words only, not the voice note under it', gh and not gh['voice'] and gh['text'].startswith(PARA[:30]), gh)
    page.mouse.up()
    time.sleep(1.5)
    t = tight.read_text()
    check('dropped at the end: the voice note stayed where it was', t.startswith('# Tight\n\n<audio controls src="memo.m4a"></audio>\nNext line.') and t.rstrip().endswith(PARA), t)
    b.close()

print(f'\n{oks} ok, {fails} failed')
