"""The skip buttons' right-click menu (a tick on the choice in use, each button on its own, the
setting saved) and Cmd-click zoom (in, closer, then back to the whole recording). Real input.
Prints one line per check; a FAIL line says what it saw.

    WORK=/some/scratch/dir python3 menu_zoom.py

The zoom checks follow the rule in editor/voiceMixer.ts (each click shows a quarter as much, the moment
under the pointer stays under it, 3 s is the closest, a Cmd-click there goes back to the whole), so they
hold for any test recording, not only the Mac's spoken one.
Expected on the Mac (2026-10-15, a 22.6 s recording, clicks at the waveform's middle):
  menu ticks "10 seconds"; after choosing 30, the back button reads "Back 30 seconds", its menu
  ticks 30, the forward menu still ticks 10, settings.json voiceSkip = {back: 30, forward: 10};
  zoom: 0–22.76 → 8.53–14.22 → 9.88–12.88 (3 s; the pointer is the zoom-OUT magnifier) → 0–22.76.
2026-11-14 (Mac, a build of deff34f, Python 3.9.6): 11 ok, 0 failed — the same numbers. Until this
date the script printed those values as a block of JSON and judged nothing (that was the "settings
dump"); it now checks them itself."""
import json, re, time
from playwright.sync_api import sync_playwright
from common import WORK, app, connect, open_zoom_note, reset_vault, MOD

PORT = 9461
ZOOM_MIN_SECONDS, ZOOM_STEP = 3, 4  # editor/voiceMixer.ts
fails = 0
oks = 0


def check(name: str, ok: bool, saw=None) -> None:
    global fails, oks
    if ok:
        oks += 1
    else:
        fails += 1
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


def ticked(items: list) -> list:
    return [i.rstrip('✓') for i in items if i.endswith('✓')]


def near(a: float, b: float) -> bool:
    return abs(a - b) <= 0.02  # the page rounds to 0.01 s


def expect_in(cur: dict, at: float, duration: float):
    """editor/voiceMixer.ts zoomAt, zooming in: (min, max), or None for the whole recording."""
    span_now = cur['max'] - cur['min']
    span = max(ZOOM_MIN_SECONDS, span_now / ZOOM_STEP)
    if span >= duration or span >= span_now - 1e-6:
        return None
    start = min(max(0, duration - span), max(0, at - (at - cur['min']) * (span / span_now)))
    return start, start + span


vault = reset_vault()
R = {}
with app(PORT), sync_playwright() as p:
    b, page = connect(p, PORT)
    open_zoom_note(page)
    v = page.locator('.cm-voice')
    menu = lambda: page.evaluate("() => [...document.querySelectorAll('.menu .menu-heading, .menu .menu-item')].map(e => e.textContent)")
    v.get_by_role('button', name=re.compile('^Back')).click(button='right')
    time.sleep(0.3)
    R['back_menu'] = menu()
    page.locator('.menu-item', has_text='30 seconds').click()
    time.sleep(0.5)
    back = v.get_by_role('button', name=re.compile('^Back'))
    R['back_label'] = back.get_attribute('aria-label')
    back.click(button='right')
    time.sleep(0.3)
    R['back_menu_after'] = menu()
    page.keyboard.press('Escape')
    time.sleep(0.3)
    v.get_by_role('button', name=re.compile('^Forward')).click(button='right')
    time.sleep(0.3)
    R['forward_menu'] = menu()
    page.keyboard.press('Escape')
    time.sleep(0.3)
    box = v.locator('.cm-voice-seek').bounding_box()
    x, y = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2
    state = lambda: page.evaluate("""() => { const s = document.querySelector('.cm-voice-seek');
      return {min: +(+s.min).toFixed(2), max: +(+s.max).toFixed(2), cls: document.querySelector('.cm-voice-wavebox').className} }""")
    page.mouse.move(x, y)
    R['zoom'] = [state()]
    for _ in range(4):
        page.keyboard.down(MOD)
        page.mouse.move(x, y + 1)
        time.sleep(0.1)
        page.mouse.click(x, y)
        time.sleep(0.35)
        R['zoom'].append(state())
        page.keyboard.up(MOD)
        time.sleep(0.1)
    R['settings_voiceSkip'] = json.loads((vault / '.mdnotes/settings.json').read_text()).get('voiceSkip')
    b.close()

# --- the skip menus -------------------------------------------------------------------
m = R['back_menu']
check('Back\'s right-click menu: "Skip back by", ticking 10 seconds', m[:1] == ['Skip back by'] and ticked(m) == ['10 seconds'], m)
check('choosing 30: the back button reads "Back 30 seconds"', R['back_label'] == 'Back 30 seconds', R['back_label'])
check('…and its menu now ticks 30 seconds', ticked(R['back_menu_after']) == ['30 seconds'], R['back_menu_after'])
m = R['forward_menu']
check('Forward\'s menu is its own: "Skip forward by", still ticking 10 seconds', m[:1] == ['Skip forward by'] and ticked(m) == ['10 seconds'], m)
check('saved: settings.json voiceSkip = {back: 30, forward: 10}', R['settings_voiceSkip'] == {'back': 30, 'forward': 10}, R['settings_voiceSkip'])

# --- Cmd-click zoom ---------------------------------------------------------------------
z = R['zoom']
whole = z[0]
duration = whole['max']
zoomed = lambda s: 'is-zoomed' in s['cls'].split()
check(f'before: the whole recording (0–{duration})', whole['min'] == 0 and duration > ZOOM_MIN_SECONDS * ZOOM_STEP and not zoomed(whole), whole)
prev = whole
for i, s in enumerate(z[1:3], 1):
    e = expect_in(prev, (prev['min'] + prev['max']) / 2, duration)
    check(f'Cmd-click {i}: zooms in to a quarter, the middle staying put ({e and "%.2f–%.2f" % e})',
          e is not None and near(s['min'], e[0]) and near(s['max'], e[1]) and zoomed(s), s)
    prev = s
closest = near(z[2]['max'] - z[2]['min'], ZOOM_MIN_SECONDS)
check('…the second is the closest view (3 s), and the pointer turns to the zoom-OUT magnifier',
      closest and 'zoom-out' in z[2]['cls'].split() and 'zoom-in' not in z[2]['cls'].split(), z[2])
check('Cmd-click 3, on the closest view: back to the whole recording', z[3]['min'] == 0 and z[3]['max'] == duration and not zoomed(z[3]), z[3])
check('Cmd-click 4: zooms in again, as the first did', z[4]['min'] == z[1]['min'] and z[4]['max'] == z[1]['max'] and zoomed(z[4]), z[4])

print(f'\n{oks} ok, {fails} failed')
