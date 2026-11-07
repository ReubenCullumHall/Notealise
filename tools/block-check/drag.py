import sys, random, re
from playwright.sync_api import sync_playwright
S = sys.argv[1]; seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
random.seed(seed)
VIEW = "document.querySelector('.cm-content').cmTile.view"
BLOCKS = {'A': 'Para A first words', 'B': 'Para B middle words', 'C': 'Para C last words',
          'V1': 'data-name="Voice one"', 'V2': 'data-name="Voice two"', 'T': '| a | b |', 'M': '$$\nx^2\n$$'}
fails = []
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp('http://127.0.0.1:9471')
    pg = br.contexts[0].pages[0]
    errors = []
    pg.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') and 'crash' in m.text.lower() else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.set_viewport_size({'width': 1100, 'height': 1300}); pg.reload(); pg.wait_for_timeout(2500)
    pg.get_by_text('Drag', exact=True).first.click()
    pg.wait_for_selector('.cm-voice', timeout=15000); pg.wait_for_timeout(1500)
    doc = lambda: pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    def order(d):
        return sorted(BLOCKS, key=lambda k: d.index(BLOCKS[k]))
    def grip_for(k):
        """Hover the block and return the centre of the dots that belong to it."""
        if k in ('V1', 'V2'):
            v = pg.locator('.cm-voice', has_text='Voice one' if k == 'V1' else 'Voice two').first
            v.scroll_into_view_if_needed(timeout=4000); b = v.bounding_box()
            pg.mouse.move(b['x'] + 60, b['y'] + b['height'] / 2); pg.wait_for_timeout(120)
            g = v.locator('.cm-attach-grip').bounding_box()
            return (g['x'] + g['width'] / 2, g['y'] + g['height'] / 2)
        if k == 'T':
            el = pg.locator('.cm-table table').first
        elif k == 'M':
            el = pg.locator('.cm-math-display').first
        else:
            el = pg.locator('.cm-line', has_text=BLOCKS[k]).first
        el.scroll_into_view_if_needed(); b = el.bounding_box()
        pg.mouse.move(b['x'] + 40, b['y'] + min(10, b['height'] / 2)); pg.wait_for_timeout(150)
        g = pg.locator('.cm-line-grip').bounding_box()
        return (g['x'] + g['width'] / 2, g['y'] + g['height'] / 2) if g else None
    def top_of(k):
        d = doc()
        if k in ('V1', 'V2'):
            return pg.locator('.cm-voice', has_text='Voice one' if k == 'V1' else 'Voice two').first.bounding_box()['y']
        if k == 'T': return pg.locator('.cm-table').first.bounding_box()['y']
        if k == 'M': return pg.locator('.cm-math-display').first.bounding_box()['y']
        return pg.locator('.cm-line', has_text=BLOCKS[k]).first.bounding_box()['y']
    for step in range(int(sys.argv[3]) if len(sys.argv) > 3 else 20):
        before = doc(); o = order(before)
        k = random.choice(o)
        dest = random.choice([x for x in o if x != k and o.index(x) != o.index(k) + 1])  # drop just above this block (not where it already is)
        try:
            g = grip_for(k)
        except Exception as ex:
            print('STUCK at step', step, 'grabbing', k); print(repr(doc())); print(pg.evaluate("() => [...document.querySelectorAll('.cm-voice-name')].map(e => e.textContent)")); pg.screenshot(path=S + '/ui/stuck.png'); break
        if not g:
            fails.append(f'{step}: no dots for {k}'); continue
        y_to = top_of(dest) - 2
        drift = pg.evaluate(f"""() => {{ const v = {VIEW}; let n = 0; for (const el of v.contentDOM.children) {{ const r = el.getBoundingClientRect(); if (!r.height) continue; let p; try {{ p = v.posAtDOM(el) }} catch {{ continue }} if (Math.abs(v.lineBlockAt(p).top + v.documentTop - r.top) > 1.5) n++ }} return n }}""")
        gripLine = pg.evaluate(f"""([x, y]) => {{ const v = {VIEW}; const b = v.lineBlockAtHeight(y - v.documentTop); return v.state.sliceDoc(b.from, b.from + 18) }}""", [g[0], g[1]])
        pg.mouse.move(*g); pg.mouse.down()
        picked = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) }}")
        n = 12
        for i in range(1, n + 1):
            pg.mouse.move(g[0], g[1] + (y_to - g[1]) * i / n); pg.wait_for_timeout(25)
        # the gap and the closed-up place move things: re-aim at dest as drawn now, like a person would
        for _ in range(2):
            pg.wait_for_timeout(750)  # past the glide (dragGhost.ts SLIDE_MS), as a person waits to see
            y2 = top_of(dest) - 2
            pg.mouse.move(g[0], y2, steps=4)
        pg.mouse.up(); pg.wait_for_timeout(350)
        after = doc(); oa = order(after)
        ok_picked = BLOCKS[k].split('\n')[0] in picked
        intact = all(after.count(BLOCKS[x]) == 1 for x in BLOCKS) and '\n\n\n' not in after and pg.locator('.cm-voice').count() == 2 and pg.locator('.cm-table').count() == 1 and pg.locator('.cm-math-display').count() == 1
        moved = oa != o
        line = f'{step}: drag {k} above {dest}: picked-on-press={ok_picked} intact={intact} moved={moved} {" ".join(o)} -> {" ".join(oa)}'
        print(line)
        if __import__('os').environ.get('SHOWDOC'): print('    ', repr(after))
        if not (ok_picked and intact and moved): fails.append(line + f' | drift={drift} grip-beside={gripLine!r} picked={picked[:18]!r}')
    print('ERRORS:', errors[:5])
    br.close()
print(f'\n{len(fails)} problem(s)')
for f in fails: print('  ', f)
