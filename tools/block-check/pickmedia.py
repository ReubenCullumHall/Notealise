from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
DOC = 'First words here\n\n![pic](pic.png)\n\n<video controls src="clip.mp4"></video>\n\nLast words here\n'
res = []
def check(n, ok, d=''): res.append(ok); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + d if d else ''))
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.emulate_media(color_scheme='dark')
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click(); pg.wait_for_selector('.cm-content'); pg.wait_for_timeout(1500)
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: t}}, selection: {{anchor: 0}}}}) }}", DOC); pg.wait_for_timeout(2000)
    sel = lambda: pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
    bar = lambda: pg.locator('.sel-toolbar').count()
    # 2: the six dots of a paragraph pick it with no bar
    l = pg.locator('.cm-line', has_text='First words').first.bounding_box()
    pg.mouse.move(l['x'] + 40, l['y'] + 8); pg.wait_for_timeout(200)
    g = pg.locator('.cm-line-grip').bounding_box(); pg.mouse.click(g['x'] + g['width']/2, g['y'] + g['height']/2); pg.wait_for_timeout(700)
    check('2a dots pick the paragraph', sel() == ['First words here'], str(sel()))
    check('2b no bold/italic bar over a pick', bar() == 0, str(bar()))
    # 4: Cmd-click the picture and the video add them
    im = pg.locator('.cm-image').first.bounding_box(); pg.keyboard.down('Meta'); pg.mouse.click(im['x'] + 150, im['y'] + 100); pg.keyboard.up('Meta'); pg.wait_for_timeout(300)
    check('4a Cmd-click on the picture adds it', len(sel()) == 2 and '![pic]' in sel()[1], str(sel()))
    vd = pg.locator('.cm-video').first.bounding_box(); pg.keyboard.down('Meta'); pg.mouse.click(vd['x'] + 150, vd['y'] + 60); pg.keyboard.up('Meta'); pg.wait_for_timeout(300)
    s = sel(); check('4b Cmd-click on the video adds it', len(s) == 3 and '<video' in s[2], str(s))
    playing = pg.evaluate("() => !document.querySelector('video').paused")
    check('4c the video did not start playing', not playing)
    rings = pg.evaluate("() => [...document.querySelectorAll('.cm-image, .cm-video')].map(e => e.classList.contains('cm-attach-selected'))")
    check('4d both ringed', rings == [True, True], str(rings))
    check('4e still no bar', bar() == 0)
    pg.keyboard.down('Meta'); pg.mouse.click(im['x'] + 150, im['y'] + 100); pg.keyboard.up('Meta'); pg.wait_for_timeout(300)
    check('4f Cmd-click the picture again takes it out', len(sel()) == 2 and not any('![pic]' in x for x in sel()), str(sel()))
    # selecting words still shows the bar
    w = pg.locator('.cm-line', has_text='Last words').first.bounding_box()
    pg.mouse.move(w['x'] + 40, w['y'] + w['height']/2); pg.mouse.down(); pg.mouse.move(w['x'] + 160, w['y'] + w['height']/2, steps=6); pg.mouse.up(); pg.wait_for_timeout(900)
    check('2c selecting words still shows the bar', bar() == 1, str(bar()) + ' ' + str(sel()))
    print(f'{sum(res)} of {len(res)} passed')
    br.close()
