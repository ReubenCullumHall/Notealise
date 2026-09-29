import json, os, re
from playwright.sync_api import sync_playwright
S = os.environ.get('WORK', '/tmp/formatting-check')
V = os.path.join(S, 'vault', 'Test')
LEAK = re.compile(r'\*|~~|`|<\/?[a-z]|\[\[|\]\]|\]\(|\$|^#|^>|^\s*- |\[[ x]\]|\|')
LINES = ['x <u>under words</u>', 'x **bold words**', 'x `code words`', 'x [[Start]]', 'x [link words](https://e.com)',
         'x <mark class="hl-amber">amber words</mark>', 'x ~~struck words~~', '## Heading words', '> Quote words',
         '- Bullet words', '- [ ] Task words']
SHOWN = """(n) => { const v = window.__v; if (n > v.state.doc.lines) return null; const l = v.state.doc.line(n); const d = v.domAtPos(l.from);
  const el = (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line'); if (!el) return null
  const c = el.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach((k) => k.remove()); return c.textContent }"""
TEXT = "(n) => { const v = window.__v; return n > v.state.doc.lines ? null : v.state.doc.line(n).text }"
res = []
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://localhost:9333')
    page = b.contexts[0].pages[0]
    page.emulate_media(color_scheme='light', reduced_motion='reduce')
    for src in LINES:
        for gesture in ['click far right, Enter, type', 'End, Enter, type', 'Home, type', 'click mid-word, Enter twice']:
            if not os.path.exists(os.path.join(V, 'Edge.md')):
                open(os.path.join(V, 'Edge.md'), 'w').write('# Edge\n')
                page.wait_for_timeout(900)
            page.locator('.tree-row', has_text='Edge').first.click(); page.wait_for_timeout(400)
            page.evaluate("() => { window.__v = document.querySelector('.cm-content').cmTile.view }")
            page.evaluate("([d]) => { const v = window.__v; v.contentDOM.blur(); v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: d}, selection: {anchor: 0}}) }", ['# Edge\n\n' + src + '\n\nafter\n'])
            page.wait_for_timeout(150)
            n = 3
            geo = page.evaluate("""(n) => { const v = window.__v; const l = v.state.doc.line(n); const a = v.coordsAtPos(l.from + 3);
              const r = v.contentDOM.getBoundingClientRect(); return {right: r.right - 20, y: (a.top + a.bottom) / 2, x: a.left} }""", n)
            if gesture.startswith('click far'):
                page.mouse.click(geo['right'], geo['y']); page.keyboard.press('Enter'); page.keyboard.type('next')
            elif gesture.startswith('End'):
                page.mouse.click(geo['x'], geo['y']); page.keyboard.press('End'); page.keyboard.press('Enter'); page.keyboard.type('next')
            elif gesture.startswith('Home'):
                page.mouse.click(geo['x'], geo['y']); page.keyboard.press('Home'); page.keyboard.type('X')
            else:
                # inside the styled words, two letters into "words"
                w = page.evaluate("""(n) => { const v = window.__v; const l = v.state.doc.line(n); const i = l.text.lastIndexOf('words'); if (i < 0) return null; const c = v.coordsAtPos(l.from + i + 2); return {x: c.left, y: (c.top + c.bottom) / 2} }""", n)
                if not w:
                    continue
                page.mouse.click(w['x'], w['y']); page.keyboard.press('Enter'); page.keyboard.press('Enter')
            page.wait_for_timeout(200)
            lines = [(page.evaluate(TEXT, k), page.evaluate(SHOWN, k)) for k in range(3, 8)]
            leak = [sh for _, sh in lines if sh and LEAK.search(sh)]
            res.append({'line': src, 'gesture': gesture, 'leak': leak, 'file': [t for t, _ in lines if t is not None]})
json.dump(res, open(os.path.join(S, 'realedge.json'), 'w'), indent=1)
