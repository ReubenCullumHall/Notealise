"""A sideways scroll over a voice note — and everything around it that must still work. Real
wheel input (CDP mouseWheel). Each check prints the waveform's visible stretch (min/max), the
note's scroll and which space shows, plus how many wheel events were cancelable / taken.
Expected on the Mac (2026-10-15, a 22.6 s recording): 1, 8, 11b and 13 change space ("Elsewhere");
3/3b/6/6b/7/9 move min/max and stay in "Zoom" with every event taken; 4 and 5 scroll the note
(scroll 200) and leave min/max alone; 6 stops at 17.07–22.76 and 0–5.69; 10 keeps the panned
stretch a second later, then follows again with the playhead in the middle; 12 is about 17 s.
After a press elsewhere (8) NO event is cancelable: an unpressed voice note has no wheel listener."""
import json, time
from playwright.sync_api import sync_playwright
from common import app, connect, open_zoom_note, reset_vault, window_state

PORT = 9462
reset_vault()
R = {}
with app(PORT), sync_playwright() as p:
    b, page = connect(p, PORT)
    cdp = page.context.new_cdp_session(page)
    page.evaluate("""() => { window.__w = []; window.addEventListener('wheel', e => window.__w.push([e.cancelable, e.defaultPrevented]), { passive: true }) }""")
    def swipe(x, y, dx, dy, n=20, mods=0, gap=0.016):
        page.evaluate('() => { window.__w = [] }')
        for _ in range(n):
            cdp.send('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': x, 'y': y, 'deltaX': dx, 'deltaY': dy, 'modifiers': mods})
            time.sleep(gap)
        time.sleep(0.7)  # let any space slide finish and the gesture go idle
        w = page.evaluate('() => window.__w')
        return {'events': len(w), 'cancelable': sum(1 for c, _ in w if c), 'prevented': sum(1 for _, d in w if d)}
    def back_to_voice():
        if 'Zoom' not in window_state(page)['space']:
            page.locator('aside button[data-tip]', has_text='1').first.click()
            time.sleep(1.0)
        open_zoom_note(page)

    open_zoom_note(page)
    R['start'] = window_state(page)
    v = page.locator('.cm-voice')
    seek = v.locator('.cm-voice-seek')
    box = seek.bounding_box()
    cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2
    text = page.locator('.cm-line', has_text='The line under it').first.bounding_box()

    # 1 control: a sideways swipe over the note text changes space
    r = swipe(text['x'] + 40, text['y'] + 5, 15, 0)
    R['1_text_swipe_changes_space'] = {**window_state(page), **r}
    back_to_voice()

    # 2 zoom in with Cmd-click (this also presses on the block)
    page.keyboard.down('Meta'); page.mouse.click(cx, cy); page.keyboard.up('Meta')
    time.sleep(0.4)
    R['2_zoomed'] = window_state(page)

    # 3 engaged + zoomed: sideways swipe over the block moves the waveform, space stays
    r = swipe(cx, cy, 15, 0)
    R['3_pan_right'] = {**window_state(page), **r}
    r = swipe(cx, cy, -10, 0)
    R['3b_pan_left'] = {**window_state(page), **r}

    # 4 engaged + zoomed: up/down over the block scrolls the note, waveform stays
    r = swipe(cx, cy, 0, 20, n=10)
    R['4_vertical_over_block'] = {**window_state(page), **r}
    page.evaluate("() => { document.querySelector('.cm-scroller').scrollTop = 0 }")
    time.sleep(0.3)
    box = seek.bounding_box(); cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2

    # 5 a scroll down that drifts sideways stays a scroll down
    r = swipe(cx, cy, 6, 20, n=10)
    R['5_vertical_with_drift'] = {**window_state(page), **r}
    page.evaluate("() => { document.querySelector('.cm-scroller').scrollTop = 0 }")
    time.sleep(0.3)
    box = seek.bounding_box(); cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2

    # 6 pushing past the end: stops at the end, never changes space
    r = swipe(cx, cy, 40, 0, n=40)
    R['6_past_the_end'] = {**window_state(page), **r}
    r = swipe(cx, cy, -40, 0, n=40)
    R['6b_past_the_start'] = {**window_state(page), **r}

    # 7 Shift + mouse wheel (up/down) over the block pans too, no space change
    r = swipe(cx, cy, 0, 30, n=6, mods=8)
    R['7_shift_wheel'] = {**window_state(page), **r}

    # 8 press elsewhere (the note text) lets go: a sideways swipe over the block changes space again
    page.mouse.click(text['x'] + 60, text['y'] + 5)
    time.sleep(0.3)
    r = swipe(cx, cy, 15, 0)
    R['8_after_press_elsewhere'] = {**window_state(page), **r}
    back_to_voice()

    # 9 press on the block again (the time readout), zoomed: takes the swipe again
    box = seek.bounding_box(); cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2
    page.keyboard.down('Meta'); page.mouse.click(cx, cy); page.keyboard.up('Meta')  # zoom in again (also a press)
    time.sleep(0.3)
    page.mouse.click(text['x'] + 60, text['y'] + 5)  # let go...
    time.sleep(0.2)
    v.locator('.cm-voice-time').click()  # ...and press on the block's time readout
    time.sleep(0.2)
    before = window_state(page)
    r = swipe(cx, cy, 10, 0)
    R['9_reengaged'] = {'before': before, **window_state(page), **r}

    # 10 playing (muted) and panned away: stays where it was put
    page.evaluate("() => { document.querySelector('.cm-voice-seek').value = 0 }")
    v.locator('.cm-voice-play').click()
    time.sleep(0.8)
    a = window_state(page)
    r = swipe(cx, cy, 20, 0, n=10)
    pos = lambda: round(float(page.evaluate("() => document.querySelector('.cm-voice-seek').value")), 2)
    b1 = {**window_state(page), 'pos': pos()}; time.sleep(1.0); b2 = {**window_state(page), 'pos': pos()}
    time.sleep(4.0); b3 = {**window_state(page), 'pos': pos()}
    time.sleep(1.0); b4 = {**window_state(page), 'pos': pos()}
    R['10_pan_while_playing'] = {'playing_before': a, 'just_after': b1, 'a_second_later': b2, 'five_later': b3, 'six_later': b4, **r}
    v.locator('.cm-voice-play').click()  # pause
    time.sleep(0.3)

    # 11 zoomed back out (Cmd+Shift-click twice): swipe over the block changes space as before
    box = seek.bounding_box(); cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2
    for _ in range(3):
        page.keyboard.down('Meta'); page.keyboard.down('Shift'); page.mouse.click(cx, cy); page.keyboard.up('Shift'); page.keyboard.up('Meta')
        time.sleep(0.3)
    R['11_unzoomed'] = window_state(page)
    r = swipe(cx, cy, 15, 0)
    R['11b_swipe_unzoomed'] = {**window_state(page), **r}
    back_to_voice()
    # 12 a plain click on the waveform still moves the playhead
    box = seek.bounding_box(); cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2
    page.mouse.click(box['x'] + box['width'] * 0.75, cy)
    time.sleep(0.3)
    R['12_plain_click_seeks'] = round(float(page.evaluate("() => document.querySelector('.cm-voice-seek').value")), 2)
    # 13 control for Shift+wheel: over the note text it still changes space
    r = swipe(text['x'] + 40, text['y'] + 5, 0, 30, n=6, mods=8)
    R['13_shift_wheel_over_text'] = {**window_state(page), **r}
    b.close()
for k, v in R.items():
    print(k, json.dumps(v))
