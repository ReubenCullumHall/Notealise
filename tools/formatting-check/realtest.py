import json, os, re, sys
from playwright.sync_api import sync_playwright

S = os.environ.get('WORK', '/tmp/formatting-check')
VAULT = os.path.join(S, 'vault', 'Test')
SHOTS = os.path.join(S, 'shots')
os.makedirs(SHOTS, exist_ok=True)
ONLY = sys.argv[1:] or ['rest', 'drag', 'pro', 'type', 'keys', 'click']

# name, source line, words a user would drag across (visible text)
INLINE = [
    ('bold', 'B **bold words** end', 'bold words'),
    ('italic', 'I *italic words* end', 'italic words'),
    ('bold-italic', 'BI ***both words*** end', 'both words'),
    ('strike', 'S ~~struck words~~ end', 'struck words'),
    ('underline', 'U <u>underlined words</u> end', 'underlined words'),
    ('sup', 'SUP x<sup>two words</sup> end', 'two words'),
    ('sub', 'SUB H<sub>two words</sub> end', 'two words'),
    ('mark', 'M <mark>marked words</mark> end', 'marked words'),
    ('highlight', 'HL <mark class="hl-amber">amber words</mark> end', 'amber words'),
    ('text colour', 'TC <span class="tc-sky">sky words</span> end', 'sky words'),
    ('custom colour', 'HEX <mark style="background-color: #ffcc00">hex words</mark> end', 'hex words'),
    ('inline code', 'C `code words` end', 'code words'),
    ('link', 'L [link words](https://example.com) end', 'link words'),
    ('autolink', 'AU <https://example.com> end', 'example.com'),
    ('bare url', 'URL https://example.com end', 'example.com'),
    ('wiki link', 'W [[Start]] end', 'Start'),
    ('inline math', 'MATH $x^2$ end', None),
]
BLOCK = [
    ('h1', '# Heading one'),
    ('h2', '## Heading two'),
    ('h3', '### Heading three'),
    ('quote', '> Quoted words'),
    ('bullet', '- Bullet words'),
    ('numbered', '1. Numbered words'),
    ('task', '- [ ] Task words'),
    ('task done', '- [x] Done words'),
]
BLOCKS_BIG = '$$\nx^2\n$$\n\n```js\nconst fenced = 1\n```\n\n| A | B |\n| --- | --- |\n| a | b |\n\n---\n'
DOC = '# All formats\n\n' + '\n\n'.join([c[1] for c in INLINE] + [b[1] for b in BLOCK]) + '\n\n' + BLOCKS_BIG

# What counts as markdown/HTML code showing on screen.
LEAK = re.compile(r'\*|~~|`|<\/?[a-z]|\[\[|\]\]|\]\(|\$|^#|^>|^\s*- |\[[ x]\]|\|')

JS_VIEW = "() => { window.__v = document.querySelector('.cm-content').cmTile.view; return !!window.__v }"
JS_SHOWN = """(n) => {
  const v = window.__v; if (n > v.state.doc.lines) return null
  const l = v.state.doc.line(n); const d = v.domAtPos(l.from)
  const el = (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line')
  if (!el) return null
  const c = el.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach((k) => k.remove())
  return c.textContent
}"""
JS_LINE_NO = "(t) => { const v = window.__v; for (let i = 1; i <= v.state.doc.lines; i++) if (v.state.doc.line(i).text === t) return i; return -1 }"
JS_RECT = """([n, text]) => {
  const v = window.__v; const l = v.state.doc.line(n)
  const shown = (() => { const d = v.domAtPos(l.from); return (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line') })()
  const w = document.createTreeWalker(shown, NodeFilter.SHOW_TEXT); let full = '', nodes = []
  while (w.nextNode()) { if (w.currentNode.parentElement.closest('.katex-mathml')) continue; nodes.push([w.currentNode, full.length]); full += w.currentNode.data }
  const at = full.indexOf(text); if (at < 0) return null
  const pos = (off) => { for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= off) return [nodes[i][0], off - nodes[i][1]] }
  const r = document.createRange(); const [a, ao] = pos(at); const [b, bo] = pos(at + text.length - 1)
  r.setStart(a, ao); r.setEnd(b, bo + 1); const rc = r.getBoundingClientRect()
  return {x1: rc.left, x2: rc.right, y: rc.top + rc.height / 2}
}"""
JS_SCROLL = """(n) => { const v = window.__v; const l = v.state.doc.line(n); const d = v.domAtPos(l.from); (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line').scrollIntoView({block: 'center'}) }"""
JS_SEL = "() => { const v = window.__v; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to) }"
JS_DOC = "() => window.__v.state.doc.toString()"
JS_TITLE = "() => window.__v.state.doc.line(1).text"
JS_TABS = "() => document.querySelectorAll('[data-tab-path], .tab-item, [role=tab]').length"


def open_note(page, name):
    page.locator('.tree-row', has_text=name).first.click()
    page.wait_for_timeout(700)
    assert page.evaluate(JS_VIEW)


def park(page):
    # Click the title line's end so nothing below has a cursor in it.
    page.evaluate("() => document.querySelector('.cm-scroller').scrollTop = 0"); page.wait_for_timeout(100)
    r = page.evaluate(JS_RECT, [1, page.evaluate(JS_TITLE).lstrip('# ')])
    page.mouse.click(r['x2'] + 30, r['y'])
    page.wait_for_timeout(120)


out = {}
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://localhost:9333')
    page = b.contexts[0].pages[0]
    page.emulate_media(color_scheme='light', reduced_motion='reduce')
    page.wait_for_timeout(600)
    with open(os.path.join(VAULT, 'All formats.md'), 'w') as f:
        f.write(DOC)
    page.wait_for_timeout(1500)
    open_note(page, 'All formats')
    park(page)

    rows = INLINE + [(n, s, None) for n, s in BLOCK]

    if 'rest' in ONLY:
        res = []
        for name, src, _ in rows:
            n = page.evaluate(JS_LINE_NO, src)
            page.evaluate(JS_SCROLL, n); page.wait_for_timeout(60)
            shown = page.evaluate(JS_SHOWN, n)
            res.append({'form': name, 'shown': shown, 'leak': bool(shown and LEAK.search(shown))})
        out['rest'] = res
        page.screenshot(path=f'{SHOTS}/real-rest.png', full_page=True)

    if 'drag' in ONLY:
        res = []
        for name, src, words in INLINE:
            if not words:
                continue
            n = page.evaluate(JS_LINE_NO, src)
            page.evaluate(JS_SCROLL, n); page.wait_for_timeout(150)
            before = page.evaluate(JS_SHOWN, n)
            tabs0, title0 = page.evaluate(JS_TABS), page.evaluate(JS_TITLE)
            r = page.evaluate(JS_RECT, [n, words + ' e'])
            page.mouse.move(r['x1'] + 1, r['y']); page.mouse.down()
            page.mouse.move((r['x1'] + r['x2']) / 2, r['y'], steps=5)
            mid = page.evaluate(JS_SHOWN, n)
            page.mouse.move(r['x2'] - 1, r['y'], steps=5)
            during = page.evaluate(JS_SHOWN, n)
            if name in ('underline', 'link', 'wiki link'):
                page.screenshot(path=f'{SHOTS}/real-drag-{name.replace(" ", "-")}.png', clip={'x': 280, 'y': max(0, r['y'] - 40), 'width': 800, 'height': 80})
            page.mouse.up(); page.wait_for_timeout(250)
            after = page.evaluate(JS_SHOWN, n) if page.evaluate(JS_TITLE) == title0 else None
            res.append({'form': name, 'selected': page.evaluate(JS_SEL), 'text_moved': not (before == mid == during == after),
                        'leak': any(LEAK.search(x or '') for x in (mid, during, after)),
                        'opened_something': page.evaluate(JS_TABS) != tabs0 or page.evaluate(JS_TITLE) != title0,
                        'during': during})
            if page.evaluate(JS_TITLE) != title0:
                open_note(page, 'All formats')
            park(page)
        out['drag'] = res

    if 'pro' in ONLY:
        sw = page.locator('[aria-label="Show the raw Markdown"]').first
        found = sw.count() > 0
        res = {'switch_found': found}
        if found:
            sw.click(force=True); page.wait_for_timeout(500)
            page.evaluate(JS_VIEW)
            shown = {}
            for name, src, _ in rows:
                n = page.evaluate(JS_LINE_NO, src); page.evaluate(JS_SCROLL, n); page.wait_for_timeout(60)
                shown[name] = page.evaluate(JS_SHOWN, n)
            res['shows_code'] = {k: bool(v and LEAK.search(v)) for k, v in shown.items()}
            page.screenshot(path=f'{SHOTS}/real-pro.png', full_page=True)
            page.locator('[aria-label="Show the formatted view"]').first.click(force=True); page.wait_for_timeout(500)
            page.evaluate(JS_VIEW)
        out['pro'] = res

    if 'click' in ONLY:
        # A plain click (no drag) on a wiki link still opens it.
        n = page.evaluate(JS_LINE_NO, 'W [[Start]] end')
        page.evaluate(JS_SCROLL, n); page.wait_for_timeout(150)
        r = page.evaluate(JS_RECT, [n, 'Start'])
        page.mouse.click((r['x1'] + r['x2']) / 2, r['y']); page.wait_for_timeout(800)
        out['click'] = {'wiki_click_opened_start': page.evaluate("() => document.querySelector('.cm-content').cmTile.view.state.doc.line(1).text")}
        open_note(page, 'All formats'); park(page)

    pass  # disconnect only; closing would quit the app
json.dump(out, open(os.path.join(S, 'real-' + '-'.join(ONLY) + '.json'), 'w'), indent=1)
