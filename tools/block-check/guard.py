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
    pg.set_viewport_size({'width': 1100, 'height': 1050})
    pg.emulate_media(color_scheme='dark', reduced_motion='reduce')
    pg.reload(); pg.wait_for_timeout(2500)
    head = lambda: pg.evaluate(f"() => {{ const v = {VIEW}; const h = v.state.selection.main.head; const l = v.state.doc.lineAt(h); return [h, l.number, l.text.slice(0, 30), h - l.from] }}")
    doc = lambda: pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    line = lambda t: pg.evaluate("(t) => { const l = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.startsWith(t)); const r = l.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }", t)

    # --- the cursor rule ---
    pg.get_by_text('Guard', exact=True).first.click()
    pg.wait_for_selector('.cm-voice', timeout=15000); pg.wait_for_timeout(1500)
    # start from the same text every run (the checks below type into it)
    GUARD = 'Above\n\ntest<audio controls src="Lecture%203.m4a" data-name="Old line"></audio>\n\n<audio controls src="Lecture%203%20take%201.m4a" data-name="Take 1"></audio>\nBelow\n'
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }} }}) }}", GUARD); pg.wait_for_timeout(1200)
    # 1. click just right of "test" (the old line): the cursor goes after the word, not past the player
    t = pg.evaluate("() => { const l = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.startsWith('test')); const r = document.createRange(); r.setStart(l.firstChild, 0); r.setEnd(l.firstChild, 4); const b = r.getBoundingClientRect(); return [b.right, b.top, b.height] }")
    pg.mouse.click(t[0] + 12, t[1] + t[2] / 2); pg.wait_for_timeout(200)
    h = head()
    check('1 a click just after "test" puts the cursor after the word', h[2].startswith('test') and h[3] == 4, str(h))
    pg.keyboard.type('ing'); pg.wait_for_timeout(200)
    check('1b and typing goes there', 'testing<audio' in doc())
    # 2. click to the right of the Take 1 player (its own line): the cursor is not left on that line
    vb = pg.locator('.cm-voice').nth(1).bounding_box()
    pg.mouse.click(vb['x'] + vb['width'] + 20, vb['y'] + vb['height'] / 2); pg.wait_for_timeout(200)
    h = head()
    check('2 a click beside a voice note never leaves the cursor on its line', not h[2].startswith('<audio'), str(h))
    # 3. arrow down from the blank line above Take 1 jumps past it
    d = doc(); blank_above = d.index('\n\n<audio controls src="Lecture%203%20take') + 1
    pg.evaluate(f"(p) => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: p }} }}); v.focus() }}", blank_above)
    pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(150)
    h = head()
    check('3 Down from the line above a voice note lands below it', not h[2].startswith('<audio') and h[0] > blank_above + 10, str(h))
    # 4. Enter on the empty line above makes a new line there; everything below moves down (2026-11-07)
    pg.evaluate(f"(p) => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: p }} }}); v.focus() }}", blank_above)
    before = doc()
    pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    h = head()
    check('4 Enter on the empty line above a voice note makes a new line above it', doc() == before[:blank_above] + '\n' + before[blank_above:] and h[0] == blank_above + 1, str(h))
    pg.keyboard.type('typed above'); pg.wait_for_timeout(200)
    check('4b typing there sits straight above the voice note', 'typed above\n<audio controls src="Lecture%203%20take' in doc(), repr(doc()[-140:]))

    # --- dragging two picked voice notes together ---
    pg.get_by_text('Select', exact=True).first.click()
    pg.wait_for_selector('.cm-voice', timeout=15000); pg.wait_for_timeout(1500)
    # start from the same text every run (other checks move things in it)
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }} }}) }}", 'Your goal is marketing, all day, every day\n\n<audio controls src="Lecture%203.m4a" data-name="Untitled 2"></audio>\n\n<audio controls src="Lecture%203%20take%201.m4a" data-name="Take 1"></audio>\n\nThe line after the voice notes.\n\nAnother paragraph at the end.\n'); pg.wait_for_timeout(1200)
    grips = pg.locator('.cm-voice .cm-attach-grip')
    pg.locator('.cm-voice').nth(0).hover(); grips.nth(0).click(modifiers=['Meta']); pg.wait_for_timeout(150)
    pg.locator('.cm-voice').nth(1).hover(); grips.nth(1).click(modifiers=['Meta']); pg.wait_for_timeout(150)
    g = grips.nth(1).bounding_box()
    end = line('Another paragraph')
    pg.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2); pg.mouse.down()
    steps = 20
    for i in range(1, steps + 1):
        pg.mouse.move(g['x'] + g['width'] / 2, g['y'] + (end[1] + end[3] + 300 - g['y']) * i / steps); pg.wait_for_timeout(30)
    pg.wait_for_timeout(200)
    ghost = pg.evaluate("() => { const g = document.querySelector('.cm-drag-ghost'); return g ? [g.getBoundingClientRect().height, g.querySelectorAll('.cm-voice').length] : null }")
    check('5a mid-drag the preview shows both voice notes', bool(ghost) and ghost[1] == 2, str(ghost))
    pg.screenshot(path=S + '/ui/group-drag.png')
    pg.mouse.up(); pg.wait_for_timeout(400)
    d = doc()
    order = [d.index(x) for x in ['The line after', 'Another paragraph', 'Untitled 2', 'Take 1']]
    check('5b dropping moves both to the end, in order', order == sorted(order), repr(d))
    sel = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.length }}")
    check('5c and both stay picked', sel == 2, str(sel))
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(300)
    d2 = doc()
    check('5d one Cmd+Z puts them back', d2.index('Untitled 2') < d2.index('The line after'))
    br.close()
print(f"\n{sum(res)} of {len(res)} passed")
