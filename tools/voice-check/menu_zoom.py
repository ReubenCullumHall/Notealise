"""The skip buttons' right-click menu (a tick on the choice in use, each button on its own, the
setting saved) and Cmd-click zoom (in, closer, then back to the whole recording). Real input.
Expected on the Mac (2026-10-15, a 22.6 s recording, clicks at the waveform's middle):
  menu ticks "10 seconds"; after choosing 30, the back button reads "Back 30 seconds", its menu
  ticks 30, the forward menu still ticks 10, settings.json voiceSkip = {back: 30, forward: 10};
  zoom: 0–22.76 → 8.53–14.22 → 9.88–12.88 (3 s; the pointer is the zoom-OUT magnifier) → 0–22.76."""
import json, re, time
from playwright.sync_api import sync_playwright
from common import WORK, app, connect, open_zoom_note, reset_vault, MOD

PORT = 9461
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
print(json.dumps(R, indent=1))
