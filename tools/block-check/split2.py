from playwright.sync_api import sync_playwright
V = '<audio controls src="Lecture%203.m4a" data-name="Voice one"></audio>'
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.emulate_media(color_scheme='dark')
    pg.set_viewport_size({'width': 1600, 'height': 1100}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click(); pg.wait_for_timeout(1200)
    pg.locator('[aria-label="Split the screen"]').first.click(); pg.wait_for_timeout(800)
    pg.get_by_text('Table', exact=True).first.click(); pg.wait_for_timeout(1500)
    n = pg.locator('.cm-content').count(); print('editors', n)
    views = "[...document.querySelectorAll('.cm-content')].map(c => c.cmTile.view)"
    def setdocs(a, b):
        pg.evaluate(f"([a, b]) => {{ const vs = {views}; vs[0].dispatch({{changes: {{from: 0, to: vs[0].state.doc.length, insert: a}}}}); vs[1].dispatch({{changes: {{from: 0, to: vs[1].state.doc.length, insert: b}}}}) }}", [a, b]); pg.wait_for_timeout(1500)
    docs = lambda: pg.evaluate(f"() => {views}.map(v => v.state.doc.toString())")
    # 1 the voice note by its dots, into the other column between One and Two
    setdocs('P1\n\n' + V + '\n\nP2\n', 'One\n\nTwo\n')
    vb = pg.locator('.cm-content').nth(0).locator('.cm-voice').first.bounding_box()
    pg.mouse.move(vb['x'] + 60, vb['y'] + vb['height']/2); pg.wait_for_timeout(200)
    g = pg.locator('.cm-content').nth(0).locator('.cm-attach-grip').first.bounding_box(); gx, gy = g['x'] + g['width']/2, g['y'] + g['height']/2
    two = pg.locator('.cm-content').nth(1).locator('.cm-line', has_text='Two').first.bounding_box()
    pg.mouse.move(gx, gy); pg.mouse.down()
    for i in range(1, 21): pg.mouse.move(gx + (two['x'] + 60 - gx) * i / 20, gy + (two['y'] - 4 - gy) * i / 20); pg.wait_for_timeout(30)
    pg.wait_for_timeout(800); two = pg.locator('.cm-content').nth(1).locator('.cm-line', has_text='Two').first.bounding_box(); pg.mouse.move(two['x'] + 60, two['y'] - 4, steps=4); pg.wait_for_timeout(800)
    pg.mouse.up(); pg.wait_for_timeout(600)
    d = docs(); print('voice note across:', repr(d[0]), '||', repr(d[1]))
    print('  OK' if d[1] == 'One\n\n' + V + '\n\nTwo\n' and d[0] == 'P1\n\nP2\n' else '  WRONG')
    # 2 two paragraphs picked with Cmd, dragged across to the end
    setdocs('A1\n\nA2\n\nA3\n', 'One\n\nTwo')
    c0 = pg.locator('.cm-content').nth(0)
    for t in ['A1', 'A3']:
        b = c0.locator('.cm-line', has_text=t).first.bounding_box(); pg.keyboard.down('Meta'); pg.mouse.click(b['x'] + 8, b['y'] + b['height']/2); pg.keyboard.up('Meta'); pg.wait_for_timeout(200)
    b = c0.locator('.cm-line', has_text='A3').first.bounding_box(); pg.mouse.move(b['x'] + 10, b['y'] + 8); pg.wait_for_timeout(250)
    g = pg.locator('.cm-line-grip').first.bounding_box(); gx, gy = g['x'] + g['width']/2, g['y'] + g['height']/2
    tw = pg.locator('.cm-content').nth(1).locator('.cm-line', has_text='Two').first.bounding_box()
    pg.mouse.move(gx, gy); pg.mouse.down()
    for i in range(1, 21): pg.mouse.move(gx + (tw['x'] + 60 - gx) * i / 20, gy + (tw['y'] + tw['height'] + 10 - gy) * i / 20); pg.wait_for_timeout(30)
    pg.wait_for_timeout(800); pg.mouse.up(); pg.wait_for_timeout(600)
    d = docs(); print('two picked across:', repr(d[0]), '||', repr(d[1]))
    print('  OK' if d[1] == 'One\n\nTwo\n\nA1\n\nA3\n' and d[0] == 'A2\n' else '  CHECK')
    # close the split again
    br.close()
