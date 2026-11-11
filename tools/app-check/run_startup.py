"""Launch timing: from starting the program to the notes being on screen."""
import sys, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9471
WORK = lab.WORK / 'work'
WORK.mkdir(parents=True, exist_ok=True)

PAGE_METRICS = """() => new Promise((resolve) => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)]));
  let lcp = null;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.round(e.startTime) })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  const res = performance.getEntriesByType('resource').filter(r => /index-.*\\.(js|css)$/.test(r.name))
    .map(r => ({ name: r.name.split('/').pop(), end: Math.round(r.responseEnd), dur: Math.round(r.duration) }));
  setTimeout(() => resolve({
    timeOrigin: performance.timeOrigin,
    domInteractive: Math.round(nav.domInteractive), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
    paints, lcp, res,
    rows: document.querySelectorAll('.tree-row').length,
    now: Math.round(performance.now())
  }), 300);
})"""

# Marks, from inside the page, when the sidebar's rows and the note's text first appear.
INIT = """
(() => {
  window.__marks = {};
  const seen = (k) => { if (!(k in window.__marks)) window.__marks[k] = Math.round(performance.now()); };
  const look = () => {
    if (document.querySelector('.tree-row')) seen('rows');
    if (document.querySelector('.cm-content')) seen('editor');
    if (document.querySelector('aside')) seen('sidebar');
  };
  const start = () => { new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true }); look(); };
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  try { new PerformanceObserver((l) => { window.__long = (window.__long || []).concat(l.getEntries().map(e => [Math.round(e.startTime), Math.round(e.duration)])) }).observe({ entryTypes: ['longtask'] }); } catch {}
})();
"""


def run(label: str, vault: Path, repeats=3):
    cold = []
    for i in range(repeats):
        ud = WORK / 'ud'
        lab.profile(ud, vault)
        proc, t0 = lab.launch(ud, PORT, WORK / 'app.log')
        t_page = lab.wait_page_target(PORT)
        with sync_playwright() as p:
            b, page = lab.connect(p, PORT)
            page.wait_for_selector('.tree-row', timeout=30000)
            m = page.evaluate(PAGE_METRICS)
            main_boot = m['timeOrigin'] - t0 * 1000
            cold.append({'main_boot': round(main_boot), 'page_target': round((t_page - t0) * 1000) if t_page else None, **m})
            if i == repeats - 1:
                # a reload with marks: the window's own share of the launch
                page.add_init_script(INIT)
                reloads = []
                for _ in range(3):
                    page.reload()
                    page.wait_for_selector('.tree-row', timeout=30000)
                    time.sleep(1.2)
                    reloads.append(page.evaluate('() => ({ marks: window.__marks, long: window.__long || [], fcp: Math.round((performance.getEntriesByType("paint").find(e => e.name === "first-contentful-paint") || {}).startTime || 0) })'))
            b.close()
        lab.stop(proc)
        time.sleep(1.0)
    print(f'\n=== {label} ===')
    for c in cold:
        print(f"  launch: program start -> window starts loading {c['main_boot']} ms | then first paint {c['paints'].get('first-contentful-paint')} ms, "
              f"largest paint {c['lcp']} ms, page loaded {c['load']} ms | rows on screen {c['rows']} | js/css {c['res']}")
    for r in reloads:
        print(f"  window reload: first paint {r['fcp']} ms, sidebar {r['marks'].get('sidebar')} ms, note list {r['marks'].get('rows')} ms, long tasks {r['long']}")
    return cold, reloads


if __name__ == '__main__':
    which = sys.argv[2] if len(sys.argv) > 2 else 'both'
    if which in ('small', 'both'):
        v = WORK / 'vault-small'
        n = lab.seed_vault(v)
        run(f'{n} notes', v)
    if which in ('big', 'both'):
        v = WORK / 'vault-big'
        n = lab.seed_vault(v, spaces=('Biology', 'Maths', 'Physics', 'Journal', 'History', 'English', 'Chemistry', 'Projects'), folders=10, notes=25)
        run(f'{n} notes', v)
