"""Go to a note — how smooth is it? Frame times while it opens, while you type, and while it closes.

Same setup as jump_check.py (scratch build with the trigger hook), ideally on a vault of a few hundred
notes. Each variant is a CSS override injected into the page, so effects can be switched off one at a
time without a rebuild. CPU throttling stands in for a busy machine.

Usage:  python3 smooth.py <cdp-port> <trigger-file> [cpu-slowdown, default 4]

Per phase it prints: frames, the longest frame (ms), and how many frames went over 25 ms (a visible hitch
at 60 Hz is anything over ~17 ms; over 25 ms is a dropped frame you can feel), plus long tasks (>50 ms).
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

port, trigger = sys.argv[1], Path(sys.argv[2])
slow = float(sys.argv[3]) if len(sys.argv) > 3 else 4
DIALOG = '[role="dialog"][aria-label="Go to a note"]'

NO_FILTER = """
@keyframes jo-nf { 0% { opacity: 0; transform: translate(-50%, -22px) scale(0.92); }
  72% { transform: translate(-50%, 2px) scale(1.004); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes jc-nf { from { opacity: 1; transform: translate(-50%, 0) scale(1); } to { opacity: 0; transform: translate(-50%, -10px) scale(0.96); } }
.jump { animation-name: jo-nf !important; } .jump.closing { animation-name: jc-nf !important; }
"""
NO_PANEL_GLASS = ".jump { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background: rgb(var(--surface)) !important; }"
NO_BACKDROP_BLUR = ".jump-backdrop { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }"
NO_GROW = ".jump-grow { transition: none !important; }"

VARIANTS = [
    ('as built', ''),
    ('no blur in the motion', NO_FILTER),
    ('+ no page blur behind', NO_FILTER + NO_BACKDROP_BLUR),
    ('+ no glass on the panel', NO_FILTER + NO_BACKDROP_BLUR + NO_PANEL_GLASS),
    ('only: no page blur behind', NO_BACKDROP_BLUR),
    ('only: no glass on panel', NO_PANEL_GLASS),
    ('only: no height ease', NO_GROW),
]

RECORD = """() => {
  window.__frames = []; window.__long = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__rec) requestAnimationFrame(tick); };
  window.__rec = true; requestAnimationFrame(tick);
  try { window.__po && window.__po.disconnect();
    window.__po = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration) });
    window.__po.observe({ type: 'longtask', buffered: false }); } catch (e) {}
}"""
STOP = "() => { window.__rec = false; return JSON.stringify({ f: window.__frames.slice(1), l: window.__long }) }"


def menu():
    trigger.write_text('1')
    for _ in range(100):
        if not trigger.exists():
            return
        time.sleep(0.01)


def phase(page, act, wait):
    page.evaluate(RECORD)
    act()
    time.sleep(wait)
    d = json.loads(page.evaluate(STOP))
    f, lt = d['f'], d['l']
    return len(f), max(f) if f else 0, sum(1 for x in f if x > 25), len(lt), max(lt) if lt else 0


with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = browser.contexts[0].pages[0]
    page.emulate_media(color_scheme='dark', reduced_motion='no-preference')
    cdp = page.context.new_cdp_session(page)
    time.sleep(0.8)
    page.wait_for_selector('.tree-row', timeout=20000)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': slow})
    print(f'CPU slowed {slow}x.  columns: frames / longest ms / frames >25ms / long tasks / longest task ms\n')
    for name, css in VARIANTS:
        page.evaluate("(c) => { let s = document.getElementById('smooth-variant'); if (!s) { s = document.createElement('style'); s.id = 'smooth-variant'; document.head.appendChild(s) } s.textContent = c }", css)
        rows = {'open': [], 'type': [], 'close': []}
        for _ in range(3):
            rows['open'].append(phase(page, menu, 0.7))
            page.wait_for_selector(DIALOG)
            rows['type'].append(phase(page, lambda: page.keyboard.type('plan wav', delay=70), 0.5))
            rows['close'].append(phase(page, lambda: page.keyboard.press('Escape'), 0.5))
            time.sleep(0.3)
        out = []
        for k, v in rows.items():
            worst = max(r[1] for r in v)
            drops = sum(r[2] for r in v) / len(v)
            lts = max(r[4] for r in v)
            out.append(f'{k}: worst {worst:5.0f} ms, {drops:4.1f} dropped/run, longest task {lts:4.0f} ms')
        print(f'{name:28s} | ' + ' | '.join(out))
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
    browser.close()
