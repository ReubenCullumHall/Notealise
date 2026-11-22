#!/usr/bin/env python3
"""Stage 0: does the drawing tool (Pele) work inside the app's real security rules?

Needs a scratch build whose main.tsx adds `window.__peleLoad = () => import('pele/lazy')`:
    WORK=<scratch> LAB_OUT=out-spike python3 spike.py <free port>

One hidden launch, made-up notes. It draws ordinary charts of every kind we offer, then hostile
ones, puts their raw output into the page, and reports anything that tried to reach outside.
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app-check'))
import lab  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9489
RUN = lab.WORK / 'flow-spike'
VAULT, UD = RUN / 'vault', RUN / 'ud'

FLOW = """---
title: Revision flow
---
flowchart TD
  A[Start] --> B{Revised?}
  B -->|Yes| C[Do a test]
  B -->|No| D[Read notes]
  D --> B
  C --> E((Done))
"""
ORDINARY = {
    'flowchart': FLOW,
    'state': 'stateDiagram-v2\n  [*] --> Solid\n  Solid --> Liquid: melt\n  Liquid --> Gas: boil\n  Gas --> [*]\n',
    'sequence': 'sequenceDiagram\n  Ana->>Bo: Revised?\n  Bo-->>Ana: Yes\n',
    'pie': 'pie title Time\n  "Maths": 40\n  "Biology": 60\n',
    'timeline': 'timeline\n  title Term\n  Autumn : Cells\n  Spring : Genes\n',
    'gantt': 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Exams\n  Revise :a1, 2026-01-01, 10d\n',
    'class': 'classDiagram\n  class Cell\n  Cell : +nucleus\n',
    'er': 'erDiagram\n  STUDENT ||--o{ NOTE : writes\n',
    'mindmap': 'mindmap\n  root((Cells))\n    Nucleus\n    Membrane\n',
}
HOSTILE = {
    'html in a label': 'flowchart TD\n  A["<img src=x onerror=window.__pwned=1>"] --> B["<script>window.__pwned=1</script>"]\n',
    'script link': 'flowchart TD\n  A --> B\n  click A "javascript:window.__pwned=1"\n  click B href "javascript:window.__pwned=1"\n',
    'web link': 'flowchart TD\n  A --> B\n  click A href "https://example.com/leak"\n',
    'file picture': 'flowchart TD\n  A@{ img: "file://10.255.255.1/share/leak.png", label: "x", h: 40, w: 40 } --> B\n',
    'web picture': 'flowchart TD\n  A@{ img: "https://example.com/leak.png", label: "x", h: 40, w: 40 } --> B\n',
    'picture in a label': 'flowchart TD\n  A["<img src=\'https://example.com/l.png\'/>"] --> B\n',
    'css url in a style': 'flowchart TD\n  A --> B\n  style A fill:url(https://example.com/leak.png)\n  classDef x stroke:url(file:///etc/passwd)\n  class B x\n',
    'theme css': '%%{init: {"themeCSS": "* { background: url(https://example.com/leak.png) }"}}%%\nflowchart TD\n  A --> B\n',
    'config pollution': '%%{init: {"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted": 1}}}}%%\nflowchart TD\n  A --> B\n',
    'front matter css': '---\nconfig:\n  themeCSS: "* { background: url(https://example.com/leak.png) }"\n---\nflowchart TD\n  A --> B\n',
}
BIG = 'flowchart TD\n' + ''.join(f'  N{i}[Box {i}] --> N{(i * 7 + 3) % 250}[Box {(i * 7 + 3) % 250}]\n  N{i} --> N{(i * 11 + 5) % 250}\n'
                                 for i in range(249))

JS = r"""async ({ordinary, hostile, big}) => {
  const out = { csp: [], ordinary: {}, hostile: {} }
  document.addEventListener('securitypolicyviolation', (e) => out.csp.push(e.effectiveDirective + ' ' + String(e.blockedURI).slice(0, 60)))
  const t0 = performance.now()
  const P = await window.__peleLoad()
  out.loadMs = Math.round(performance.now() - t0)
  const opts = { images: false, links: false, maxEdges: 500, idPrefix: 'spike-' }
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-5000px;top:0;width:800px;height:600px'
  document.body.append(host)
  const scan = (svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const all = [...doc.querySelectorAll('*')]
    const tags = {}
    for (const n of all) { const t = n.localName; if (['image', 'a', 'script', 'foreignObject', 'iframe', 'use', 'style', 'img', 'animate', 'set'].includes(t)) tags[t] = (tags[t] || 0) + 1 }
    const attrs = []
    for (const n of all) for (const a of n.attributes) {
      if (/^on/i.test(a.name)) attrs.push(a.name)
      if (/href$/i.test(a.name) && !a.value.startsWith('#')) attrs.push(a.name + '=' + a.value.slice(0, 40))
      if (/url\(/i.test(a.value) && !/url\(["']?#/i.test(a.value)) attrs.push('css-url:' + a.value.slice(0, 50))
    }
    return { nodes: all.length, tags, attrs: attrs.slice(0, 4) }
  }
  for (const [name, text] of Object.entries(ordinary)) {
    const s = performance.now()
    try {
      const r = await P.renderAsync(text, opts)
      host.innerHTML = r.svg
      out.ordinary[name] = { ms: Math.round(performance.now() - s), kb: Math.round(r.svg.length / 1024), type: r.type, w: Math.round(r.width), h: Math.round(r.height), ...scan(r.svg) }
    } catch (e) { out.ordinary[name] = { error: String(e.message || e).slice(0, 110) } }
  }
  try {
    await P.load('flowchart')
    const m = P.parse(ordinary.flowchart, { maxEdges: 500 })
    const nodes = m.nodes instanceof Map ? [...m.nodes.values()] : Array.isArray(m.nodes) ? m.nodes : Object.values(m.nodes)
    out.model = { keys: Object.keys(m), title: m.title, node: nodes[0], edge: m.edges?.[1], count: [nodes.length, m.edges?.length] }
    const r = P.render(ordinary.flowchart, opts)
    const d = new DOMParser().parseFromString(r.svg, 'image/svg+xml')
    out.ids = { nodes: [...d.querySelectorAll('[data-id]')].slice(0, 7).map((e) => e.getAttribute('class') + ' = ' + e.getAttribute('data-id')) }
  } catch (e) { out.model = { error: String(e.message || e).slice(0, 200) } }
  for (const [name, text] of Object.entries(hostile)) {
    try {
      const r = await P.renderAsync(text, opts)
      host.innerHTML = r.svg
      await new Promise((f) => setTimeout(f, 120))
      out.hostile[name] = { links: r.links.length, ...scan(r.svg) }
    } catch (e) { out.hostile[name] = { refused: String(e.message || e).slice(0, 70) } }
  }
  out.ran = window.__pwned === 1
  out.polluted = ({}).polluted === 1
  for (const n of [1, 2]) {
    const s = performance.now()
    const r = await P.renderAsync(big, opts)
    out['big' + n] = { ms: Math.round(performance.now() - s), kb: Math.round(r.svg.length / 1024) }
  }
  try {
    P.render('flowchart TD\n  A --> B\n  B -->', opts); out.broken = 'no error'
  } catch (e) { out.broken = { name: e.name, code: e.code, line: e.line, column: e.column, message: String(e.message).slice(0, 100) } }
  try {
    const over = 'flowchart TD\n' + Array.from({ length: 520 }, (_, i) => `  A${i} --> B${i}\n`).join('')
    await P.renderAsync(over, opts); out.tooBig = 'no error'
  } catch (e) { out.tooBig = { code: e.code, message: String(e.message).slice(0, 90) } }
  out.worker = await new Promise((done) => {
    try {
      const w = new Worker(new URL('assets/spike-worker.js', location.href), { type: 'module' })
      const end = (v) => { w.terminate(); done(v) }
      w.onmessage = (e) => end('runs: ' + e.data)
      w.onerror = (e) => end('refused: ' + (e.message || 'error'))
      setTimeout(() => end('no answer in 3 s'), 3000)
    } catch (e) { done('refused: ' + String(e.message).slice(0, 90)) }
  })
  host.remove()
  return out
}"""

if RUN.exists():
    shutil.rmtree(RUN)
(VAULT / 'Chem').mkdir(parents=True)
(VAULT / 'Chem' / 'Spike.md').write_text('# Spike\n')
(VAULT / '.mdnotes').mkdir()
(VAULT / '.mdnotes' / 'settings.json').write_text('{"spaces":[{"folder":"Chem"}],"activeSpaceFolder":"Chem","playStartupAnimation":false}')
lab.profile(UD, VAULT)
(lab.MAIN.parent.parent / 'renderer/assets/spike-worker.js').write_text("self.postMessage(typeof OffscreenCanvas)\n")
proc, _ = lab.launch(UD, PORT, RUN / 'app.log')
try:
    with sync_playwright() as p:
        browser, page = lab.connect(p, PORT)
        requests = []
        page.on('request', lambda r: requests.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:', 'devtools:')) else None)
        page.wait_for_selector('.tree-title')
        time.sleep(0.8)
        r = page.evaluate(JS, {'ordinary': ORDINARY, 'hostile': HOSTILE, 'big': BIG})
        time.sleep(0.5)
        r['outside_requests'] = requests
finally:
    lab.stop(proc)
(RUN / 'result.json').write_text(json.dumps(r, indent=1))
print('load ms', r['loadMs'], '| outside requests', r['outside_requests'], '| script ran', r['ran'], '| polluted', r['polluted'])
print('blocked by security rules:', r['csp'][:6])
for k, v in r['ordinary'].items():
    print(' ', k, {x: v[x] for x in v if x in ('error', 'ms', 'kb', 'w', 'h', 'tags', 'attrs')})
print('model', json.dumps(r['model'])[:900])
print('ids', r.get('ids'))
for k, v in r['hostile'].items():
    print(' !', k, v)
print('500-arrow chart', r['big1'], r['big2'])
print('broken', r['broken'])
print('too big', r['tooBig'])
print('worker', r['worker'])
