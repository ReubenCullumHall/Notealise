from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
DOC = 'Top words\n\n$$\nx^2\n$$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd words\n'
res = []
def check(n, ok, d=''): res.append(ok); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + d if d else ''))
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click(); pg.wait_for_selector('.cm-voice'); pg.wait_for_timeout(1000)
    pg.evaluate("() => document.documentElement.setAttribute('data-page-look', 'lined')")
    def setdoc():
        pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: t}}, selection: {{anchor: 0}}}}) }}", DOC); pg.wait_for_timeout(900)
    doc = lambda: pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    head = lambda: pg.evaluate(f"() => {{ const v = {VIEW}; const h = v.state.selection.main.head; const l = v.state.doc.lineAt(h); return [h, l.number, l.text] }}")
    blank_rows = lambda: pg.evaluate(f"() => [...{VIEW}.contentDOM.children].filter(e => e.classList.contains('cm-line') && e.textContent === '').map(e => e.getBoundingClientRect())")
    setdoc()
    m = pg.locator('.cm-math-display').first.bounding_box(); t = pg.locator('.cm-table').first.bounding_box()
    # 1 click in the gap under the maths, type
    pg.mouse.click(m['x'] + 100, (m['y'] + m['height'] + t['y']) / 2); pg.wait_for_timeout(200)
    h = head(); check('1 a click between the maths and the table lands on the blank line', h[1] == 6 and h[2] == '', str(h))
    pg.keyboard.type('between'); pg.wait_for_timeout(200)
    check('1b typing goes there', '$$\nbetween\n|' in doc(), repr(doc()[:60]))
    setdoc()
    # 2 Backspace on the blank line under the maths removes that line only
    pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{selection: {{anchor: v.state.doc.line(6).from}}}}); v.focus() }}")
    pg.keyboard.press('Backspace'); pg.wait_for_timeout(200)
    check('2 Backspace under the maths removes just the blank line', doc() == DOC.replace('$$\n\n|', '$$\n|'), repr(doc()[:50]))
    setdoc()
    # 3 ArrowUp from the blank line under the maths steps over it
    pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{selection: {{anchor: v.state.doc.line(6).from}}}}); v.focus() }}")
    pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(150)
    h = head(); check('3 Up from under the maths lands above it', h[1] == 2, str(h))
    pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(150)
    h = head(); check('3b Down again lands under it', h[1] == 6, str(h))
    # 4 Backspace on the line under the maths with words in it picks/deletes the block
    setdoc()
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: 'A\\n$$\\nx\\n$$\\nB'}}, selection: {{anchor: 'A\\n$$\\nx\\n$$\\n'.length}}}}); v.focus() }}", 0); pg.wait_for_timeout(500)
    pg.keyboard.press('Backspace'); pg.wait_for_timeout(200)
    check('4 Backspace at the start of words under the maths takes the maths, never joins lines', doc() in ('A\nB', 'A\n\nB'), repr(doc()))
    # 5 a click in the gap under the table lands on the blank line
    setdoc()
    t = pg.locator('.cm-table').first.bounding_box(); e = pg.locator('.cm-line', has_text='End words').first.bounding_box()
    pg.mouse.click(t['x'] + 100, (t['y'] + t['height'] + e['y']) / 2); pg.wait_for_timeout(200)
    h = head(); check('5 a click under the table lands on the blank line', h[1] == 10 and h[2] == '', str(h))
    # 6 typing at the end of a note that ends with maths
    pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: 'A\\n\\n$$\\nx\\n$$'}}, selection: {{anchor: 'A\\n\\n$$\\nx\\n$$'.length}}}}); v.focus() }}"); pg.wait_for_timeout(500)
    pg.keyboard.type('z'); pg.wait_for_timeout(200)
    check('6 typing at the end of a note ending in maths goes onto its own line', doc() == 'A\n\n$$\nx\n$$\nz', repr(doc()))
    print(f'{sum(res)} of {len(res)} passed')
    br.close()
