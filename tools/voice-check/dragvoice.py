"""Carrying VOICE NOTES by their six dots on a dark Lined page (Reuben, 2026-10-16: "it doesn't always
land where it shows, and sometimes skips up or down the page"). Records, for each drag, where the gap
showed at the moment of release, where the voice note actually landed, and how far the note scrolled
on its own — during the carry and after the drop.

    WORK=/some/scratch/dir python3 dragvoice.py [--verbose]

Prints one line per drag and a FAIL for any that landed somewhere the gap didn't show, or scrolled
by itself. First run, 2026-10-16 (Mac): 26 ok, 0 failed."""
import json, shutil, sys, time
from common import WORK, app, connect, reset_vault
from playwright.sync_api import sync_playwright

VERBOSE = '--verbose' in sys.argv
oks = fails = 0


def check(name, ok, saw=None):
    global oks, fails
    ok = bool(ok)
    oks += ok
    fails += not ok
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


vault = reset_vault()
for i in (2, 3):
    shutil.copy(WORK / 'memo.m4a', vault / 'Voice' / f'memo{i}.m4a')
note = vault / 'Voice' / 'Voices.md'
body = ['# Voices', '']
for i in range(1, 25):
    body.append(f'Paragraph {i} with a few words in it.')
    if i in (4, 10, 16):
        n = {4: '', 10: '2', 16: '3'}[i]
        body.append(f'<audio controls src="memo{n}.m4a" data-name="Voice {n or 1}"></audio>')
    body.append('')
note.write_text('\n'.join(body) + '\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps(
    {'spaces': [{'folder': 'Voice', 'pageLook': 'lined', 'theme': 'dark'}, {'folder': 'Other'}], 'activeSpaceFolder': 'Voice'}))

STATE = """() => { const g = document.querySelector('.cm-drag-ghost'); const sc = document.querySelector('.cm-scroller');
  return {scroll: Math.round(sc.scrollTop), ghost: g ? {before: (g.nextElementSibling ? g.nextElementSibling.textContent : '(end)').slice(0, 22), top: Math.round(g.getBoundingClientRect().top), h: Math.round(g.getBoundingClientRect().height)} : null} }"""
# where a voice note's whole line sits on screen now
LINE_TOP = """(n) => { const e = [...document.querySelectorAll('.cm-voice-name')].find(x => x.textContent === n);
  return e ? Math.round(e.closest('.cm-line').getBoundingClientRect().top) : null }"""


def order(text):
    """The note as a list: paragraph numbers and voice names, in order."""
    out = []
    for l in text.splitlines():
        if l.startswith('Paragraph '):
            out.append(l.split()[1])
        elif l.startswith('<audio'):
            out.append('V' + l.split('data-name="Voice ')[1][0])
        elif l.strip() == '':
            out.append('_')
    return out


with sync_playwright() as p, app(9349):
    b, page = connect(p, 9349)
    page.emulate_media(color_scheme='dark')
    page.locator('.tree-title', has_text='Voices').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
    time.sleep(1.0)

    def drag(name, dy, step=5):
        """Carry voice note `name` by dy px (real pointer, small steps), release, report."""
        page.evaluate('() => document.activeElement.blur()')
        v = page.locator('.cm-voice', has=page.locator('.cm-voice-name', has_text=name)).first
        # Off screen it isn't drawn at all: scroll the note until it is, then bring it to the middle.
        page.evaluate('() => { document.querySelector(".cm-scroller").scrollTop = 0 }')
        for _ in range(40):
            if v.count():
                break
            page.evaluate('() => { document.querySelector(".cm-scroller").scrollTop += 300 }')
            time.sleep(0.15)
        page.evaluate("""(n) => { const e = [...document.querySelectorAll('.cm-voice-name')].find(x => x.textContent === n);
          const sc = document.querySelector('.cm-scroller'); const r = e.getBoundingClientRect(), q = sc.getBoundingClientRect();
          sc.scrollTop += (r.top - q.top) - q.height / 2 }""", name)
        time.sleep(0.6)
        v.hover()
        time.sleep(0.3)
        g = v.locator('.cm-attach-grip').bounding_box()
        x, y0 = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2
        before_text = note.read_text()
        s0 = page.evaluate(STATE)['scroll']
        q = page.evaluate("() => { const r = document.querySelector('.cm-scroller').getBoundingClientRect(); return {top: r.top, bottom: r.bottom} }")
        zone = (q['bottom'] - q['top']) / 6
        # stay out of the edge-scroll zones unless asked: this drag is about where it lands
        dy = max(min(dy, q['bottom'] - zone - 12 - y0), q['top'] + zone + 12 - y0)
        page.mouse.move(x, y0)
        page.mouse.down()
        trail = []
        y = y0
        sign = 1 if dy > 0 else -1
        while abs(y - y0) < abs(dy):
            y += sign * step
            page.mouse.move(x, y)
            time.sleep(0.025)
            st = page.evaluate(STATE)
            trail.append((round(y - y0), st['scroll'], st['ghost']['before'] if st['ghost'] else None, st['ghost']['top'] if st['ghost'] else None))
        time.sleep(0.3)
        st = page.evaluate(STATE)
        shown = st['ghost']['before'] if st['ghost'] else None
        ghost_top = st['ghost']['top'] if st['ghost'] else None
        s_release = st['scroll']
        page.mouse.up()
        time.sleep(0.05)
        landed_top_now = page.evaluate(LINE_TOP, name)
        time.sleep(1.35)
        landed_top = page.evaluate(LINE_TOP, name)
        s_after = page.evaluate(STATE)['scroll']
        after = order(note.read_text())
        # where it landed: the item after it in the new order
        i = after.index('V' + name[-1])
        landed_before = after[i + 1] if i + 1 < len(after) else '(end)'
        if shown is None:
            want = None
        elif shown.startswith('Paragraph'):
            want = shown.split()[1]
        elif shown.startswith('Voice '):
            want = 'V' + shown[6]
        elif shown.strip() == '':
            want = '_'
        else:
            want = shown
        if VERBOSE:
            for t in trail:
                print('   ', t)
        scroll_carry = max(abs(t[1] - s0) for t in trail) if trail else 0
        print(f'  {name} by {dy:+.0f}: gap showed before {shown!r} at y={ghost_top}, landed before {landed_before!r} at y={landed_top}; '
              f'scroll {s0} → {s_release} (max drift while carrying {scroll_carry}) → {s_after} after drop')
        check(f'{name} by {dy:+.0f}: lands where the gap showed', shown is None and after == order(before_text) or landed_before == want, (shown, landed_before))
        check(f'{name} by {dy:+.0f}: the page didn\'t scroll on its own while carrying', scroll_carry <= 1, scroll_carry)
        check(f'{name} by {dy:+.0f}: …or after the drop', abs(s_after - s_release) <= 1, (s_release, s_after))
        if ghost_top is not None:
            check(f'{name} by {dy:+.0f}: it sits exactly where its greyed copy was (straight away, and after)',
                  landed_top_now is not None and abs(landed_top_now - ghost_top) <= 2 and abs(landed_top - ghost_top) <= 2,
                  (ghost_top, landed_top_now, landed_top))
        return after

    def via_edge(name, sign):
        """Carry it into the edge zone (the note scrolls), hold, come back to the middle, release."""
        page.evaluate('() => document.activeElement.blur()')
        page.evaluate("""(n) => { const e = [...document.querySelectorAll('.cm-voice-name')].find(x => x.textContent === n);
          const sc = document.querySelector('.cm-scroller'); const r = e.getBoundingClientRect(), q = sc.getBoundingClientRect();
          sc.scrollTop += (r.top - q.top) - q.height / 2 }""", name)
        time.sleep(0.6)
        v = page.locator('.cm-voice', has=page.locator('.cm-voice-name', has_text=name)).first
        v.hover()
        time.sleep(0.3)
        g = v.locator('.cm-attach-grip').bounding_box()
        q = page.evaluate("() => { const r = document.querySelector('.cm-scroller').getBoundingClientRect(); return {top: r.top, bottom: r.bottom} }")
        x, y0 = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2
        page.mouse.move(x, y0)
        page.mouse.down()
        page.mouse.move(x, (q['top'] + 15) if sign < 0 else (q['bottom'] - 15), steps=12)
        time.sleep(0.35)
        page.mouse.move(x, (q['top'] + q['bottom']) / 2, steps=10)
        time.sleep(0.3)
        st = page.evaluate(STATE)
        page.mouse.up()
        time.sleep(1.2)
        after = order(note.read_text())
        i = after.index('V' + name[-1])
        nxt = after[i + 1] if i + 1 < len(after) else '(end)'
        shown = st['ghost']['before'] if st['ghost'] else None
        want = shown.split()[1] if shown and shown.startswith('Paragraph') else ('_' if shown is not None and shown.strip() == '' else shown)
        top = page.evaluate(LINE_TOP, name)
        print(f'  {name} via the {"top" if sign < 0 else "bottom"} edge: gap before {shown!r} at y={st["ghost"]["top"] if st["ghost"] else None}, landed before {nxt!r} at y={top}')
        check(f'{name} via the {"top" if sign < 0 else "bottom"} edge: lands where the gap showed, at the same spot',
              st['ghost'] and nxt == want and abs(top - st['ghost']['top']) <= 2, (shown, nxt, st['ghost'], top))

    drag('Voice 1', +160)
    drag('Voice 1', -160)
    drag('Voice 2', +300)
    drag('Voice 2', -250)
    drag('Voice 3', -120)
    drag('Voice 3', +90)
    via_edge('Voice 2', +1)
    via_edge('Voice 2', -1)
    b.close()

print(f'\n{oks} ok, {fails} failed')
