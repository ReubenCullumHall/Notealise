"""Blocks keep their distance (Reuben, 2026-11-08 — docs/feature-done-checklist.md "Blocks — spacing
and page looks"). Every pair of block kinds, one on the line straight under the other, on every page
look: both are picked with real Cmd-clicks (on their six dots), and

  - their picked outlines never meet (>= 2px apart; >= 0 against a line of text),
  - on Lined and Worn, the line under them still sits on its rule,
  - every block is drawn where the editor thinks it is (the heights.py check), so the six dots
    and drops land on the right block.

Run against a scratch build with a debug port (README). The vault needs a.m4a, pic.png, clip.mp4
and a note called `Spacing` (any text — this replaces it). Usage:
    python3 spacing.py [port] [looks…]      default port 9471, every look
On Windows: python -X utf8, and change 'Meta' to 'Control'.
"""
import sys, itertools
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else '9471'
LOOKS = sys.argv[2:] or ['none', 'lined', 'worn', 'grid', 'graph', 'dots', 'grain']
VIEW = "document.querySelector('.cm-content').cmTile.view"
SRC = {
    'text': 'A line of writing between blocks.',
    'voice': '<audio controls src="a.m4a" data-name="Spacing voice"></audio>',
    'picture': '![](pic.png)',
    'video': '<video controls src="clip.mp4"></video>',
    'table': '| Topic | Notes |\n| --- | --- |\n| Cells | Hold words |',
    'formula': '$$\nE = mc^2\n$$',
}
KINDS = list(SRC)
BOX = '.cm-voice, .cm-block-line > .cm-image, .cm-block-line > .cm-video, .cm-table table, .cm-math-display'

fails = []
def check(name, ok, detail=''):
    if not ok:
        fails.append(name + (f' — {detail}' if detail else ''))

with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
    pg = br.contexts[0].pages[0]
    pg.set_viewport_size({'width': 1100, 'height': 1100})
    pg.emulate_media(color_scheme='dark', reduced_motion='reduce')
    pg.wait_for_timeout(600)
    pg.get_by_text('Spacing', exact=True).first.click()
    pg.wait_for_timeout(1200)

    def blocks():
        """The drawn blocks between Start and End, top to bottom, with their outline width."""
        return pg.evaluate(f"""() => [...document.querySelectorAll('.cm-content {BOX.replace(', ', ', .cm-content ')}')]
          .map(e => {{ const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            const ring = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) : 0;
            return {{ top: r.top, bottom: r.bottom, x: r.x, w: r.width, ring, picked: e.classList.contains('cm-attach-selected') }} }})
          .sort((a, b) => a.top - b.top)""")

    def line_box(text):
        return pg.evaluate("(t) => { const l = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.startsWith(t)); if (!l) return null; const r = l.getBoundingClientRect(); return {top: r.top, bottom: r.bottom} }", text)

    def pick(b):
        """Cmd-click the block's own six dots (voice note, picture, video) or the line's (table, formula)."""
        cx, cy = b['x'] + min(200, b['w'] / 2), b['top'] + 8
        pg.mouse.move(cx, cy); pg.wait_for_timeout(120)
        grip = pg.evaluate("""([x, y]) => { const el = document.elementFromPoint(x, y); const own = el && el.closest('.cm-voice, .cm-image, .cm-video')?.querySelector('.cm-attach-grip');
             const g = own || document.querySelector('.cm-line-grip'); if (!g || getComputedStyle(g).display === 'none') return null;
             const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }""", [cx, cy])
        if not grip:
            return False
        pg.mouse.move(grip[0], grip[1]); pg.wait_for_timeout(80)
        pg.keyboard.down('Meta'); pg.mouse.down(); pg.mouse.up(); pg.keyboard.up('Meta')
        pg.wait_for_timeout(200)
        return True

    runs = 0
    for look in LOOKS:
        pg.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look)
        for top, bottom in itertools.product(KINDS, KINDS):
            if top == bottom == 'text':
                continue
            runs += 1
            # A table's text has to end at a blank line or the next line joins the table (Markdown's
            # rule, and what the app's moves write) — so a table on top keeps one.
            sep = '\n\n' if top == 'table' else '\n'
            after = '\n\n' if bottom == 'table' else '\n'
            doc = f'Start of the note\n{SRC[top]}{sep}{SRC[bottom]}{after}End of the note\n'
            pg.evaluate(f"(t) => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: t }}, selection: {{ anchor: 0 }} }}) }}", doc)
            pg.wait_for_timeout(700)
            name = f'{look} {top}/{bottom}'
            bs = blocks()
            want = [k for k in (top, bottom) if k != 'text']
            if len(bs) != len(want):
                check(name, False, f'expected {len(want)} drawn blocks, found {len(bs)}')
                continue
            for b in bs:
                check(name + ' pick', pick(b), 'no six dots to press')
            pg.mouse.move(1050, 1050); pg.wait_for_timeout(250)
            bs = blocks()
            check(name + ' picked', all(b['picked'] for b in bs), f"{[b['picked'] for b in bs]}")
            # outline gaps
            if top != 'text' and bottom != 'text':
                gap = bs[1]['top'] - bs[1]['ring'] - (bs[0]['bottom'] + bs[0]['ring'])
                check(name, gap >= 2, f'outlines {gap:.1f}px apart')
            else:
                t = line_box(SRC['text'][:20])
                b = bs[0]
                gap = (b['top'] - b['ring'] - t['bottom']) if top == 'text' else (t['top'] - b['bottom'] - b['ring'])
                check(name, gap >= 0, f'outline {gap:.1f}px into the line of text')
            # the line under them on its rule
            if look in ('lined', 'worn'):
                a, z = line_box('Start of the note'), line_box('End of the note')
                rule = pg.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-rule'))")
                off = (z['top'] - a['top']) % rule
                check(name + ' rule', min(off, rule - off) < 1, f'line below {min(off, rule - off):.1f}px off its rule')
            # drawn where the editor thinks (the six dots and drops depend on it)
            bad = pg.evaluate(f"""() => {{ const v = {VIEW}; const out = [];
              for (const el of v.contentDOM.children) {{ const r = el.getBoundingClientRect(); if (!r.height) continue;
                let pos; try {{ pos = v.posAtDOM(el) }} catch {{ continue }}
                const top = v.lineBlockAt(pos).top + v.documentTop;
                if (Math.abs(top - r.top) > 1.5) out.push(Math.round(r.top - top)) }} return out }}""")
            check(name + ' heights', not bad, f'{len(bad)} drawn off by {bad[:3]}')
    pg.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: 0 }} }}) }}")
    br.close()

print(f'{runs} pairs, {len(fails)} problems')
for f in fails[:80]:
    print('FAIL', f)
