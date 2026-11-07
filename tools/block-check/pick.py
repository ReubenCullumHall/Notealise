import sys, json
from playwright.sync_api import sync_playwright
S = sys.argv[1]
VIEW = "document.querySelector('.cm-content').cmTile.view"
res = []
def check(name, ok, detail=''):
    res.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471')
    pg = br.contexts[0].pages[0]
    pg.emulate_media(color_scheme='dark', reduced_motion='reduce')
    pg.set_viewport_size({'width': 1100, 'height': 1050})
    pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Select', exact=True).first.click()
    pg.wait_for_selector('.cm-voice', timeout=15000)
    pg.wait_for_timeout(1200)
    # start from the same text every run (other checks move things in it)
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }} }}) }}", 'Your goal is marketing, all day, every day\n\n<audio controls src="Lecture%203.m4a" data-name="Untitled 2"></audio>\n\n<audio controls src="Lecture%203%20take%201.m4a" data-name="Take 1"></audio>\n\nThe line after the voice notes.\n\nAnother paragraph at the end.\n'); pg.wait_for_timeout(1200)
    sel = lambda: pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
    rings = lambda: pg.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.classList.contains('cm-attach-selected'))")
    line = lambda t: pg.evaluate("(t) => { const l = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.startsWith(t)); const r = l.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }", t)

    # 1. drag-select from the first line to the line after the voice notes (no edge scroll)
    a = line('Your goal'); b = line('The line after')
    pg.mouse.move(a[0] + 40, a[1] + a[3] / 2); pg.mouse.down()
    for i in range(1, 16):
        pg.mouse.move(a[0] + 40 + i * 8, a[1] + (b[1] - a[1]) * i / 15 + a[3] / 2); pg.wait_for_timeout(25)
    pg.mouse.up(); pg.wait_for_timeout(300)
    s = sel()
    check('1a drag-select across the voice notes takes them in', len(s) == 1 and 'Untitled 2' in s[0] and 'Take 1' in s[0], repr(s[0][:60]))
    check('1b both voice notes show the selected ring', rings() == [True, True], str(rings()))
    pg.screenshot(path=S + '/ui/pick-1-drag.png')

    # 2. plain click on text clears; Cmd+click on the first voice note's dots picks it, Cmd+click the take's dots adds it
    pg.mouse.click(b[0] + 100, b[1] + b[3] / 2); pg.wait_for_timeout(200)
    grips = pg.locator('.cm-voice .cm-attach-grip')
    pg.locator('.cm-voice').nth(0).hover(); grips.nth(0).click(modifiers=['Meta']); pg.wait_for_timeout(200)
    pg.locator('.cm-voice').nth(1).hover(); grips.nth(1).click(modifiers=['Meta']); pg.wait_for_timeout(200)
    s = sel()
    check('2a Cmd+click on two voice notes’ dots picks both', len(s) == 2 and 'Untitled 2' in s[0] and 'Take 1' in s[1], json.dumps([x[-30:] for x in s]))
    check('2b both ringed', rings() == [True, True], str(rings()))
    # 3. Cmd+click on a paragraph's words adds the paragraph
    c = line('Another paragraph')
    pg.keyboard.down('Meta'); pg.mouse.click(c[0] + 60, c[1] + c[3] / 2); pg.keyboard.up('Meta'); pg.wait_for_timeout(200)
    s = sel()
    check('3 Cmd+click on a paragraph adds the whole paragraph', len(s) == 3 and s[2] == 'Another paragraph at the end.', json.dumps(s[2:] ))
    pg.screenshot(path=S + '/ui/pick-3-three.png')
    # 4. Cmd+click a picked one again takes it out
    pg.locator('.cm-voice').nth(1).hover(); grips.nth(1).click(modifiers=['Meta']); pg.wait_for_timeout(200)
    s = sel()
    check('4 Cmd+click a picked voice note again takes it back out', len(s) == 2 and 'Take 1' not in ''.join(s), str(len(s)))
    check('4b and its ring goes', rings() == [True, False], str(rings()))
    # 5. copy (a copy event with its own clipboard, so the Mac's clipboard is left alone)
    copied = pg.evaluate("""() => { const dt = new DataTransfer(); const e = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('.cm-content').dispatchEvent(e); return dt.getData('text/plain') }""")
    check('5 copy holds both blocks with a blank line between', copied == '<audio controls src="Lecture%203.m4a" data-name="Untitled 2"></audio>\n\nAnother paragraph at the end.', repr(copied))
    # 6. Backspace removes them; Cmd+Z puts them back
    before = pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    pg.keyboard.press('Backspace'); pg.wait_for_timeout(300)
    after = pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    check('6a Backspace takes both picked blocks out', 'Untitled 2' not in after and 'Another paragraph' not in after and 'Take 1' in after, repr(after))
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(300)
    back = pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    check('6b one Cmd+Z puts them back', back == before)
    # 7. plain click on a voice note's dots still picks just it; a second plain click opens its name menu
    pg.mouse.click(b[0] + 100, b[1] + b[3] / 2); pg.wait_for_timeout(200)
    pg.locator('.cm-voice').nth(0).hover(); grips.nth(0).click(); pg.wait_for_timeout(200)
    check('7a a plain click on the dots picks just that voice note', len(sel()) == 1 and 'Untitled 2' in sel()[0])
    grips.nth(0).click(); pg.wait_for_timeout(300)
    menu = pg.evaluate("() => [...document.querySelectorAll('.menu .menu-item')].map(b => b.innerText.trim())")
    check('7b a second plain click opens its menu, as before', len(menu) > 0, ' · '.join(menu[:4]))
    pg.keyboard.press('Escape')
    # 8. Cmd+click on the voice note's own body
    pg.mouse.click(b[0] + 100, b[1] + b[3] / 2); pg.wait_for_timeout(200)
    vb = pg.locator('.cm-voice').nth(1).bounding_box()
    pg.keyboard.down('Meta'); pg.mouse.click(vb['x'] + 8, vb['y'] + vb['height'] - 6); pg.keyboard.up('Meta'); pg.wait_for_timeout(200)
    check('8 Cmd+click on a voice note’s own edge picks it', len(sel()) == 1 and 'Take 1' in sel()[0], repr(sel()))
    # 9. Cmd+click in plain text no longer leaves a second cursor
    pg.mouse.click(b[0] + 100, b[1] + b[3] / 2); pg.wait_for_timeout(100)
    check('9 a plain click leaves one cursor', len(sel()) == 1 and sel()[0] == '')
    br.close()
print(f"\n{sum(res)} of {len(res)} passed")
