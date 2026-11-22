#!/usr/bin/env python3
"""Every page look with a chart card beside every other block: pictures for Reuben, plus a check
that no two blocks' outlines touch.  WORK=<scratch> python3 looks.py <free port>"""
import base64, json, os, shutil, struct, sys, time, zlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app-check'))
os.environ.setdefault('LAB_SIZE', '1120x1500')
import lab  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9495
RUN = lab.WORK / 'flow-looks'; VAULT, UD = RUN / 'vault', RUN / 'ud'
LOOKS = ['none', 'lined', 'grid', 'grid-fine', 'dots', 'graph', 'grain', 'worn']
def png(w, h):
    raw = b''.join(b'\x00' + bytes((90 + x % 120, 130, 170 - y % 90)) * 1 + b''.join(bytes((90 + i % 120, 130, 170 - y % 90)) for i in range(1, w)) for x, y in ((0, y) for y in range(h)))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
CHART = '```mermaid\nflowchart LR\n  A[Start] --> B{Revised?}\n  B -->|Yes| C[Test]\n  B -->|No| D[Read]\n```'
TEXT = f"""Words above the blocks.

{CHART}
$$
\\int_0^1 x\\,dx = \\tfrac12
$$
{CHART}
| Term | Meaning |
| --- | --- |
| Cell | Unit of life |

{CHART}
![](pic.png)

{CHART}

<details open><summary>A toggle</summary>

{CHART}

</details>

Words below the blocks.
"""
if RUN.exists(): shutil.rmtree(RUN)
(VAULT / 'Study').mkdir(parents=True); (VAULT / 'Study' / 'Looks.md').write_text(TEXT); (VAULT / 'Study' / 'pic.png').write_bytes(png(320, 90))
(VAULT / '.mdnotes').mkdir(); (VAULT / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Study'}], 'activeSpaceFolder': 'Study', 'playStartupAnimation': False}))
lab.profile(UD, VAULT); proc, _ = lab.launch(UD, PORT, RUN / 'app.log'); bad = []
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT); page.emulate_media(color_scheme='light', reduced_motion='reduce')
        page.wait_for_selector('.tree-title'); page.locator('.tree-row', has=page.locator('.tree-title', has_text='Looks')).first.click(); page.wait_for_selector('.cm-chart-card'); time.sleep(1.2)
        for look in LOOKS:
            page.evaluate("(l) => document.documentElement.setAttribute('data-page-look', l)", look); time.sleep(0.45)
            boxes = page.evaluate("""() => [...document.querySelectorAll('.cm-chart-card, .cm-math-display, .cm-table table, .cm-image')].map((e) => { const r = e.getBoundingClientRect(); return { k: e.className.toString().split(' ')[0] || e.tagName, t: r.top, b: r.bottom } }).sort((a, b) => a.t - b.t)""")
            gaps = [round(boxes[i + 1]['t'] - boxes[i]['b'], 1) for i in range(len(boxes) - 1)]
            # A picked outline reaches 4px out from each block (2px wide, 2px off).
            near = [g for g in gaps if g < 8]
            print(look.ljust(10), 'blocks', len(boxes), 'smallest gap', min(gaps), 'TOUCHING' if near else 'ok', flush=True)
            if near: bad.append((look, near))
            page.locator('.cm-scroller').first.screenshot(path=str(RUN / f'{look}.png'))
        page.evaluate("() => document.documentElement.setAttribute('data-page-look', 'none')")
        page.emulate_media(color_scheme='dark', reduced_motion='reduce'); time.sleep(0.6); page.locator('.cm-scroller').first.screenshot(path=str(RUN / 'dark.png'))
finally:
    lab.stop(proc)
print('outlines clear on every look' if not bad else f'TOO CLOSE: {bad}'); print(RUN)
