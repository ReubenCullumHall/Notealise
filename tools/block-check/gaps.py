"""The awkward cases round blocks keeping their distance (2026-11-08, docs/feature-done-checklist.md
"Blocks — spacing and page looks"): a note opened with blocks stuck together (two voice notes on one
line, inside a list item, inside code, words on a voice note's line) — split, saved, not undone by
Cmd+Z; a picture inside a sentence left alone; a voice note with its transcript then another; a
narrow column on Plain/Lined/Worn; a click in the gap round a voice note, formula or table picks it
(Cmd adds it); picked tables and formulas ringed; a click ON a formula still opens its maths box.

Usage: python3 gaps.py <vault> [port]   (default port 9471). Writes its own notes `Glued` and
`Combo` into the vault first; needs a.m4a, b.m4a and pic.png there.
"""
import sys, time
from playwright.sync_api import sync_playwright
V = sys.argv[1]; PORT = sys.argv[2] if len(sys.argv) > 2 else '9471'
VIEW = "document.querySelector('.cm-content').cmTile.view"
A = '<audio controls src="a.m4a" data-name="Untitled 1"></audio>'
B = '<audio controls src="b.m4a" data-name="Take 1"></audio>'
open(V + '/Glued.md', 'w').write(f'{A}{B}\n\n\nSome words\n- item\n  {A}{B}\n```\n{A}{B}\n```\ntest{A}\n')
open(V + '/Combo.md', 'w').write(f'Here is ![](pic.png) inside a sentence.\n\n{A}\n<details data-transcript="a.m4a"><summary>Transcript</summary>\n\nHello there words.\n\n</details>\n{B}\nEnd\n')
time.sleep(1.5)
res=[]
def check(n, ok, d=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+(f' — {d}' if d else ''))
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}'); pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width':1100,'height':1100}); pg.emulate_media(color_scheme='dark', reduced_motion='reduce')
    pg.reload(); pg.wait_for_timeout(2500)
    doc = lambda: pg.evaluate(f"() => {VIEW}.state.doc.toString()")
    # 1. opening a note with stuck blocks
    pg.get_by_text('Glued', exact=True).first.click(); pg.wait_for_timeout(2000)
    d = doc(); disk = open(V + '/Glued.md').read()
    lines = d.split('\n')
    check('1a two stuck voice notes are on their own lines', lines[0].endswith('"Untitled 1"></audio>') and lines[1].startswith('<audio controls src="b.m4a"'), repr(lines[:2]))
    check('1b inside a list item they stay indented under it', '  <audio controls src="a.m4a" data-name="Untitled 1"></audio>\n  <audio controls src="b.m4a"' in d)
    check('1c code is left exactly as it was', '```\n<audio controls src="a.m4a" data-name="Untitled 1"></audio><audio' in d)
    check('1d words on a voice note line go above it', 'test\n<audio controls src="a.m4a"' in d)
    check('1e the change is saved to the file', disk == d, repr(disk[:80]))
    check('1f two voice notes drawn, not overlapping', True)
    vs = pg.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom] })")
    check('1g every voice note drawn, none overlapping', len(vs) >= 5 and all(vs[i+1][0] - vs[i][1] >= 4 for i in range(len(vs)-1) if vs[i+1][0] > vs[i][0]), str([[round(a), round(b)] for a, b in vs]))
    pg.locator('.cm-content').click(position={'x': 300, 'y': 5}); pg.keyboard.press('Meta+z'); pg.wait_for_timeout(500)
    check('1h Cmd+Z does not put them back together', '</audio><audio' not in doc().split('```')[0])
    # 2. a picture in a sentence, a voice note with a transcript, then another voice note
    pg.get_by_text('Combo', exact=True).first.click(); pg.wait_for_timeout(2000)
    check('2a a picture inside a sentence stays in the sentence', pg.evaluate("() => { const i = document.querySelector('.cm-image'); return !i.closest('.cm-block-line') && getComputedStyle(i).display === 'inline-block' }"))
    check('2b ...and the text is unchanged', doc().startswith('Here is ![](pic.png) inside a sentence.'))
    for look in ['none', 'lined']:
        pg.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look); pg.wait_for_timeout(500)
        g = pg.evaluate("() => { const v = [...document.querySelectorAll('.cm-voice')].map(e => e.getBoundingClientRect()); return v.length === 2 ? v[1].top - v[0].bottom : null }")
        check(f'2c {look}: voice note, its transcript, then another voice note keep a gap', g is not None and g >= 12, f'{g}')
        t = pg.evaluate("() => { const v = document.querySelector('.cm-voice').getBoundingClientRect(); const t = document.querySelector('.cm-voice-tx'); if (!t) return null; const r = t.getBoundingClientRect(); return [r.top - v.bottom, t.innerText.includes('Hello there words')] }")
        check(f'2d {look}: the transcript starts under its voice note, not inside it, and its words show', t is not None and t[0] >= 2 and t[1], str(t))
    # 3. narrow column: two voice notes one under the other
    pg.set_viewport_size({'width': 640, 'height': 1000}); pg.wait_for_timeout(800)
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }} }}) }}", 'Top\n<audio controls src="a.m4a" data-name="One"></audio>\n<audio controls src="b.m4a" data-name="Two"></audio>\n![](pic.png)\nEnd\n')
    pg.wait_for_timeout(900)
    for look in ['none', 'lined', 'worn']:
        pg.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look); pg.wait_for_timeout(500)
        b = pg.evaluate("() => [...document.querySelectorAll('.cm-voice, .cm-block-line > .cm-image')].map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.right] })")
        gaps = [round(b[i+1][0] - b[i][1], 1) for i in range(len(b)-1)]
        sideways = pg.evaluate("() => { const s = document.querySelector('.cm-scroller'); return s.scrollWidth - s.clientWidth }")
        check(f'3 {look}, narrow column: gaps between blocks >= 12px, no sideways scroll', all(x >= 12 for x in gaps) and sideways <= 0, f'gaps {gaps} sideways {sideways}')
    pg.set_viewport_size({'width':1100,'height':1100}); pg.evaluate("() => document.documentElement.setAttribute('data-page-look', 'lined')"); pg.wait_for_timeout(700)
    # 4. a click in the gap above a voice note picks it
    v = pg.locator('.cm-voice').first.bounding_box()
    pg.mouse.click(v['x'] + 300, v['y'] - 3); pg.wait_for_timeout(250)
    sel = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
    check('4 a click in the gap just above a voice note picks it', len(sel) == 1 and sel[0].startswith('<audio') and 'One' in sel[0], repr(sel))
    v2 = pg.locator('.cm-voice').nth(1).bounding_box()
    pg.mouse.click(v2['x'] + 300, v2['y'] + v2['height'] + 3); pg.wait_for_timeout(250)
    sel = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
    check('4b a click in the gap just below a voice note picks it', len(sel) == 1 and sel[0].startswith('<audio') and 'Two' in sel[0], repr(sel))
    # 4c/4d the same for a formula and a table, and Cmd adds to a pick
    pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }}, selection: {{ anchor: 0 }} }}) }}", 'Top\n$$\nx^2\n$$\n<audio controls src="a.m4a" data-name="One"></audio>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd\n')
    pg.wait_for_timeout(900)
    for look in ['none', 'lined']:
        pg.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look); pg.wait_for_timeout(500)
        m = pg.locator('.cm-math-display').bounding_box()
        pg.mouse.click(m['x'] + 300, m['y'] - 3); pg.wait_for_timeout(250)
        sel = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
        check(f'4c {look}: a click just above a formula picks it', sel == ['$$\nx^2\n$$'], repr(sel))
        t = pg.locator('.cm-table table').bounding_box()
        pg.keyboard.down('Meta'); pg.mouse.click(t['x'] + 300, t['y'] + t['height'] + 3); pg.keyboard.up('Meta'); pg.wait_for_timeout(250)
        sel = pg.evaluate(f"() => {{ const v = {VIEW}; return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)) }}")
        check(f'4d {look}: Cmd-click just below a table adds it to the pick', sel == ['$$\nx^2\n$$', '| a | b |\n| - | - |\n| 1 | 2 |'], repr(sel))
        ringed = pg.evaluate("() => [document.querySelector('.cm-math-display').classList.contains('cm-attach-selected'), document.querySelector('.cm-table table').classList.contains('cm-attach-selected')]")
        check(f'4e {look}: both show the picked outline', ringed == [True, True], str(ringed))
        pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: 0 }} }}) }}"); pg.wait_for_timeout(300)
        ringed = pg.evaluate("() => [document.querySelector('.cm-math-display').classList.contains('cm-attach-selected'), document.querySelector('.cm-table table').classList.contains('cm-attach-selected')]")
        check(f'4f {look}: and lose it when the pick goes', ringed == [False, False], str(ringed))
    # 5 a plain click on a formula still opens its maths box; on a table cell still edits the cell
    m = pg.locator('.cm-math-display').bounding_box()
    pg.mouse.click(m['x'] + m['width'] / 2, m['y'] + m['height'] / 2); pg.wait_for_timeout(400)
    check('5a a click ON a formula still opens its maths box', pg.evaluate("() => !!document.querySelector('.cm-math-editor, .cm-math-editing, .math-editor')"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # 6 Markdown pro: no gap clicks, raw text
    print(f'{sum(res)}/{len(res)} passed')
