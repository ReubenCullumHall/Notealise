import os
from playwright.sync_api import sync_playwright
VIEW = "document.querySelector('.cm-content').cmTile.view"
import sys
V = sys.argv[1] if len(sys.argv) > 1 else 'vault'
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471'); pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('BinTest', exact=True).first.click(); pg.wait_for_selector('.cm-voice'); pg.wait_for_timeout(1500)
    for i in range(2):
        v = pg.locator('.cm-voice').nth(i); v.hover(); pg.wait_for_timeout(150)
        pg.keyboard.down('Meta'); v.locator('.cm-attach-grip').click(); pg.keyboard.up('Meta'); pg.wait_for_timeout(200)
    print('picked', pg.evaluate(f"() => {VIEW}.state.selection.ranges.length"))
    pg.keyboard.press('Backspace'); pg.wait_for_timeout(1500)
    print('doc after delete', repr(pg.evaluate(f"() => {VIEW}.state.doc.toString()")))
    print('files in vault', [f for f in os.listdir(V) if f.startswith('binv')])
    trash = os.path.join(V, '.mdnotes', 'trash'); print('in bin', [f for f in os.listdir(trash) if 'binv' in f] if os.path.isdir(trash) else 'no trash dir')
    notice = pg.evaluate("() => [...document.querySelectorAll('[role=status], .notice, [class*=notice], [class*=toast]')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 3)")
    print('notice', notice)
    pg.get_by_text('Undo', exact=True).first.click(); pg.wait_for_timeout(1500)
    print('doc after undo', repr(pg.evaluate(f"() => {VIEW}.state.doc.toString()")))
    print('files in vault after undo', [f for f in os.listdir(V) if f.startswith('binv')])
    print('voice notes drawn', pg.locator('.cm-voice').count())
    br.close()
