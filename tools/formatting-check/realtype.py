import json, os, re, sys
from playwright.sync_api import sync_playwright

S = os.environ.get('WORK', '/tmp/formatting-check')
VAULT = os.path.join(S, 'vault', 'Test')
LEAK = re.compile(r'\*|~~|`|<\/?[a-z]|\[\[|\]\]|\]\(|\$|^#|^>|^\s*- |\[[ x]\]|\||^---$')

JS_VIEW = "() => { window.__v = document.querySelector('.cm-content').cmTile.view; return !!window.__v }"
JS_CUR = """() => {
  const v = window.__v; const l = v.state.doc.lineAt(v.state.selection.main.head); const d = v.domAtPos(l.from)
  const el = (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line')
  let shown = null
  if (el) { const c = el.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach((k) => k.remove()); shown = c.textContent }
  return {n: l.number, doc: l.text, shown}
}"""
JS_LINE = """(n) => {
  const v = window.__v; const l = v.state.doc.line(n); const d = v.domAtPos(l.from)
  const el = (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line')
  let shown = null
  if (el) { const c = el.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach((k) => k.remove()); shown = c.textContent }
  return {doc: l.text, shown}
}"""
JS_END = "() => { const v = window.__v; v.focus(); v.dispatch({selection: {anchor: v.state.doc.length}, scrollIntoView: true}) }"
JS_RECT = """([n, text]) => {
  const v = window.__v; const l = v.state.doc.line(n); const d = v.domAtPos(l.from)
  const el = (d.node.nodeType === 3 ? d.node.parentElement : d.node).closest('.cm-line')
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let full = '', nodes = []
  while (w.nextNode()) { nodes.push([w.currentNode, full.length]); full += w.currentNode.data }
  const at = full.indexOf(text); if (at < 0) return null
  const pos = (off) => { for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= off) return [nodes[i][0], off - nodes[i][1]] }
  const r = document.createRange(); const [a, ao] = pos(at); const [b, bo] = pos(at + text.length - 1)
  r.setStart(a, ao); r.setEnd(b, bo + 1); const rc = r.getBoundingClientRect()
  return {x1: rc.left, x2: rc.right, y: rc.top + rc.height / 2}
}"""

HAND = [
    ('bold', '**bold words**'), ('italic', '*italic words*'), ('strike', '~~struck words~~'),
    ('underline', '<u>under words</u>'), ('code', '`code words`'), ('link', '[link words](https://example.com)'),
    ('wiki', '[[Start]]'), ('math', '$x^2$'), ('heading', '## Heading words'), ('quote', '> Quote words'),
    ('bullet', '- Bullet words'), ('numbered', '1. Numbered words'), ('task', '- [ ] Task words'),
    ('divider', '---'), ('highlight', '<mark class="hl-amber">amber words</mark>'),
]


def fresh(page, name):
    with open(os.path.join(VAULT, name + '.md'), 'w') as f:
        f.write('# ' + name + '\n\nfirst\n')
    page.wait_for_timeout(1200)
    page.locator('.tree-row', has_text=name).first.click()
    page.wait_for_timeout(700)
    page.evaluate(JS_VIEW)
    page.evaluate(JS_END)
    page.keyboard.press('Enter'); page.keyboard.press('Enter')


def leave(page):
    """Start the next test on a fresh paragraph (set up directly, so one test's
    list or quote can't continue into the next)."""
    page.keyboard.press('Escape')
    page.evaluate("() => { const v = window.__v; v.dispatch({changes: {from: v.state.doc.length, insert: '\\n\\n'}, selection: {anchor: v.state.doc.length + 2}}) }")
    page.wait_for_timeout(150)


out = {'hand': [], 'keys': []}
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://localhost:9333')
    page = b.contexts[0].pages[0]
    page.emulate_media(color_scheme='light', reduced_motion='reduce')
    page.wait_for_timeout(500)

    # 1. Typing each form by hand, one key at a time.
    fresh(page, 'Typing')
    for name, src in HAND:
        steps = []
        for ch in src:
            page.keyboard.type(ch)
            page.wait_for_timeout(35)
            c = page.evaluate(JS_CUR)
            steps.append(c['shown'])
        n = page.evaluate(JS_CUR)['n']
        leave(page)
        final = page.evaluate(JS_LINE, n)
        raw_steps = [i + 1 for i, s in enumerate(steps) if s and LEAK.search(s)]
        out['hand'].append({'form': name, 'typed': src, 'final_doc': final['doc'], 'final_shown': final['shown'],
                            'final_leak': bool(final['shown'] and LEAK.search(final['shown'])),
                            'keys_showing_code': f"{len(raw_steps)} of {len(src)}", 'last_step_shown': steps[-1]})

    # 2. The style shortcuts with nothing selected.
    fresh(page, 'Keys')
    log = out['keys']

    def rec(label):
        c = page.evaluate(JS_CUR)
        log.append({'step': label, 'doc': c['doc'], 'shown': c['shown'], 'leak': bool(c['shown'] and LEAK.search(c['shown']))})
        return c

    for key, nm in [('Meta+b', 'bold'), ('Meta+i', 'italic'), ('Meta+u', 'underline'), ('Meta+Shift+x', 'strike')]:
        page.keyboard.press(key); rec(f'{nm}: shortcut pressed, nothing typed yet')
        page.keyboard.type('hello world', delay=30); rec(f'{nm}: typed "hello world"')
        page.keyboard.press(key); page.keyboard.type(' plain', delay=30); rec(f'{nm}: shortcut again, typed " plain"')
        leave(page)

    page.keyboard.press('Meta+b'); page.keyboard.press('Meta+b'); page.keyboard.type('x'); rec('bold pressed twice then "x" (should be plain)')
    leave(page)
    page.keyboard.press('Meta+b'); page.keyboard.press('Meta+i'); page.keyboard.type('both'); rec('bold+italic then "both"')
    leave(page)
    page.keyboard.press('Meta+b'); page.keyboard.type('hello '); rec('bold "hello " (space typed)')
    page.keyboard.press('Backspace'); rec('  Backspace (removes the space)')
    page.keyboard.press('Backspace'); rec('  Backspace again (should remove "o", keep bold)')
    page.keyboard.type('p'); rec('  typed "p"')
    leave(page)
    # middle of bold: switch it off for what is typed next
    page.keyboard.press('Meta+b'); page.keyboard.type('abcd'); page.keyboard.press('Meta+b')
    page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft')
    rec('bold "abcd", cursor moved between b and c')
    page.keyboard.press('Meta+b'); page.keyboard.type('X'); rec('  shortcut, typed "X" (X plain, both halves bold)')
    leave(page)
    # select a word that is one letter wider than the styled span, then toggle twice
    page.keyboard.press('Meta+u'); page.keyboard.type('under'); page.keyboard.press('Meta+u'); page.keyboard.type(' next')
    c = rec('underlined "under", then " next"')
    r = page.evaluate(JS_RECT, [c['n'], 'under n'])
    page.mouse.move(r['x1'] + 1, r['y']); page.mouse.down(); page.mouse.move(r['x2'] - 1, r['y'], steps=6); page.mouse.up()
    page.keyboard.press('Meta+u'); rec('  dragged "under n", underline once (all underlined)')
    page.keyboard.press('Meta+u'); rec('  underline again (none underlined)')
    leave(page)
    # undo through a bold typing run
    page.keyboard.press('Meta+b'); page.keyboard.type('undo me', delay=30); rec('bold "undo me"')
    for i in range(10):
        page.keyboard.press('Meta+z'); c = rec(f'  undo {i + 1}')
        if not c['doc']:
            break

print(json.dumps(out, indent=1))
