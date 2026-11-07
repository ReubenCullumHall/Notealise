import sys
from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
S = sys.argv[1]
ORIG = open(S + '/drag-original.md').read()
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471')
    pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click()
    pg.wait_for_selector('.cm-voice', timeout=15000); pg.wait_for_timeout(1500)
    def setdoc(t):
        pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{changes: {{from: 0, to: v.state.doc.length, insert: t}}}}) }}", t); pg.wait_for_timeout(900)
    doc = lambda: pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    def grip_voice(name):
        v = pg.locator('.cm-voice', has_text=name).first; b = v.bounding_box()
        pg.mouse.move(b['x'] + 60, b['y'] + b['height'] / 2); pg.wait_for_timeout(150)
        g = v.locator('.cm-attach-grip').bounding_box(); return (g['x'] + g['width']/2, g['y'] + g['height']/2)
    def grip_line(text):
        el = pg.locator('.cm-line', has_text=text).first; b = el.bounding_box()
        pg.mouse.move(b['x'] + 40, b['y'] + 8); pg.wait_for_timeout(150)
        g = pg.locator('.cm-line-grip').bounding_box(); return (g['x'] + g['width']/2, g['y'] + g['height']/2)
    def ytext(text):
        return pg.locator('.cm-line', has_text=text).first.bounding_box()
    def drag(g, y, label):
        pg.mouse.move(*g); pg.mouse.down()
        for i in range(1, 16):
            pg.mouse.move(g[0], g[1] + (y - g[1]) * i / 15); pg.wait_for_timeout(30)
        pg.wait_for_timeout(200)
        gh = pg.evaluate("() => { const g = document.querySelector('.cm-drag-ghost'); if (!g) return null; const r = g.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)] }")
        pg.mouse.up(); pg.wait_for_timeout(400)
        print(f'{label}: pointer y={round(y)} ghost gap={gh}')
        print('   ', repr(doc()[:300]))
    # 1: Para A down below Para C (aim at the blank between C and the table, as drawn at rest)
    setdoc(ORIG); bC = ytext('Para C'); g = grip_line('Para A'); drag(g, bC['y'] + bC['height'] + 10, 'Para A below C')
    # 2: Voice two down below Voice one
    setdoc(ORIG); v1 = pg.locator('.cm-voice', has_text='Voice one').first.bounding_box(); g = grip_voice('Voice two'); drag(g, v1['y'] + v1['height'] + 10, 'Voice two below Voice one')
    # 3: Para A down to the very end
    setdoc(ORIG); bB = ytext('Para B'); g = grip_line('Para A'); drag(g, bB['y'] + bB['height'] + 20, 'Para A to the end')
    # 4: Voice two to the end
    setdoc(ORIG); g = grip_voice('Voice two'); drag(g, bB['y'] + bB['height'] + 20, 'Voice two to the end')
    # 5: Para A up? control: Para C above Para A
    setdoc(ORIG); bA = ytext('Para A'); g = grip_line('Para C'); drag(g, bA['y'] - 10, 'control: Para C above A (up)')
    setdoc(ORIG)
    br.close()
