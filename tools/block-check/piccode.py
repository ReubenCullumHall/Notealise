from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
DOC = 'Top words\n\n![pic](pic.png)\n\nSee ![pic](pic.png) here in a line\n\n<video controls src="clip.mp4"></video>\n\nEnd\n'
res = []
def check(n, ok, d=''): res.append(ok); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + d if d else ''))
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1500}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click(); pg.wait_for_selector('.cm-content'); pg.wait_for_timeout(1500)
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: t}}, selection: {{anchor: 0}}}}) }}", DOC); pg.wait_for_timeout(2000)
    code = lambda: pg.evaluate("() => [...document.querySelectorAll('.cm-line')].some(l => /!\\[pic\\]|<video/.test(l.textContent))")
    sel = lambda: pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
    im = pg.locator('.cm-image').first.bounding_box()
    pg.mouse.click(im['x'] + 150, im['y'] + 100); pg.wait_for_timeout(400)
    check('1 a click on a picture picks it', sel() == ['![pic](pic.png)'], str(sel()))
    check('1b and shows no code', not code())
    check('1c ringed', pg.evaluate("() => document.querySelector('.cm-image').classList.contains('cm-attach-selected')"))
    # arrows through the in-sentence picture
    pg.evaluate(f"() => {{ const v = {VIEW}; const p = v.state.doc.toString().indexOf('See ') + 4; v.dispatch({{selection: {{anchor: p}}}}); v.focus() }}")
    for k in ['ArrowRight', 'ArrowLeft', 'ArrowRight']:
        pg.keyboard.press(k); pg.wait_for_timeout(150)
        check(f'2 {k} past a picture in a sentence shows no code', not code())
    # drag-select across both pictures
    t = pg.locator('.cm-line', has_text='Top words').first.bounding_box(); e = pg.locator('.cm-line', has_text='End').first.bounding_box()
    pg.mouse.move(t['x'] + 30, t['y'] + 10); pg.mouse.down(); pg.mouse.move(e['x'] + 20, e['y'] + 10, steps=10); pg.mouse.up(); pg.wait_for_timeout(400)
    check('3 a drag-select over pictures and a video shows no code', not code())
    # Markdown pro still shows the code
    pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{selection: {{anchor: 0}}}}) }}")
    br.close()
    print(f'{sum(res)} of {len(res)} passed')
