from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click(); pg.wait_for_selector('.cm-content'); pg.wait_for_timeout(1500)
    for d in ['A\n\n<audio controls src="Lecture%203.m4a" data-name="Voice one"></audio>', 'A\n\n| a | b |\n| - | - |\n| 1 | 2 |', 'A\n\n![pic](pic.png)']:
        pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: t}}, selection: {{anchor: t.length}}}}); v.focus() }}", d); pg.wait_for_timeout(800)
        pg.keyboard.type('z'); pg.wait_for_timeout(200)
        out = pg.evaluate(f"() => {VIEW}.state.doc.toString()")
        print('PASS' if out == d + '\nz' else 'FAIL', repr(out[:12]), pg.evaluate(f'() => {VIEW}.state.selection.main.head'), len(d))
    br.close()
