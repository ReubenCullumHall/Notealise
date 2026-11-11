"""Typing feel in the real window: how many keystrokes take longer than one screen refresh,
in notes of different lengths. Also: does the sidebar's second line follow what was typed?"""
import sys, time, json, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9471
WHICH = sys.argv[2] if len(sys.argv) > 2 else 'small'
WORK = lab.WORK / 'work'

START = """() => {
  window.__ev = []; window.__long = []; window.__frames = []; window.__stop = false;
  window.__po1 = new PerformanceObserver((l) => { for (const e of l.getEntries())
    window.__ev.push([e.name, Math.round(e.duration), Math.round(e.processingStart - e.startTime), +(e.processingEnd - e.processingStart).toFixed(1)]) });
  window.__po1.observe({ type: 'event', durationThreshold: 16 });
  window.__po2 = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) });
  window.__po2.observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  const tick = (t) => { window.__frames.push(+(t - last).toFixed(1)); last = t; if (!window.__stop) requestAnimationFrame(tick) };
  requestAnimationFrame(tick);
}"""
STOP = """() => { window.__stop = true; window.__po1.disconnect(); window.__po2.disconnect();
  return { ev: window.__ev, long: window.__long, frames: window.__frames } }"""

TEXT = 'these are some ordinary words typed at a steady pace to see how the note keeps up with the hands '


def pct(xs, q):
    if not xs:
        return 0
    s = sorted(xs)
    return s[min(len(s) - 1, int(len(s) * q))]


def type_in(page, label):
    line = page.locator('.cm-line', has_text='The quick brown fox').first
    line.click()
    page.keyboard.press('End')
    time.sleep(0.5)
    page.evaluate(START)
    time.sleep(0.3)
    n = 0
    for _ in range(2):
        page.keyboard.type(TEXT, delay=45)
        n += len(TEXT)
    time.sleep(0.6)
    r = page.evaluate(STOP)
    keys = [e for e in r['ev'] if e[0] in ('keydown', 'keypress', 'beforeinput', 'input', 'textInput')]
    downs = [e for e in r['ev'] if e[0] == 'keydown']
    frames = r['frames'][5:]
    proc = [e[3] for e in downs]
    print(f"  {label}: {n} keys | keystrokes slower than one refresh (16 ms): {len(downs)} "
          f"(median {int(statistics.median([e[1] for e in downs])) if downs else 0} ms, worst {max([e[1] for e in downs], default=0)} ms; "
          f"work per slow key: median {statistics.median(proc) if proc else 0} ms, worst {max(proc, default=0)} ms) | "
          f"long freezes (>50 ms): {len(r['long'])} {sorted(r['long'], reverse=True)[:5]} | "
          f"frames: median {pct(frames, .5)} ms, 95th {pct(frames, .95)} ms, worst {max(frames, default=0)} ms, over 33 ms: {sum(1 for f in frames if f > 33)}")
    return r


def main():
    vault = WORK / ('vault-small' if WHICH == 'small' else 'vault-big')
    if WHICH == 'small':
        lab.seed_vault(vault)
    else:
        lab.seed_vault(vault, spaces=('Biology', 'Maths', 'Physics', 'Journal', 'History', 'English', 'Chemistry', 'Projects'), folders=10, notes=25)
    ud = WORK / 'ud'
    lab.profile(ud, vault)
    proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
    try:
        with sync_playwright() as p:
            b, page = lab.connect(p, PORT)
            page.wait_for_selector('.tree-row', timeout=30000)
            time.sleep(2.5)
            print(f'=== typing, vault {WHICH} ===')
            for title in ('Typical', 'Long', 'Huge'):
                lab.open_note(page, None, title, settle=2.5 if title != 'Huge' else 5)
                lines = page.evaluate("() => document.querySelector('.cm-content') ? document.querySelectorAll('.cm-line').length : -1")
                type_in(page, f'{title:8s} (lines drawn {lines})')
                time.sleep(1.0)

            # the sidebar's second line and the note's own "edited" stamp, after typing at the very top
            lab.open_note(page, None, 'Typical', settle=1.5)
            row = page.locator('.tree-row', has=page.locator('.tree-title', has_text='Typical')).first
            before = row.locator('.tree-sub').first.inner_text()
            page.locator('.cm-line').first.click()
            page.keyboard.press('Meta+ArrowUp')
            page.keyboard.press('ArrowDown')
            page.keyboard.press('ArrowDown')
            page.keyboard.type('ZZTOP fresh words ', delay=30)
            time.sleep(3.0)
            after = row.locator('.tree-sub').first.inner_text()
            on_disk = (vault / 'Biology' / 'Typical.md').read_text()[:120].replace('\n', ' / ')
            print('--- sidebar line follows typing? ---')
            print('  before:', before[:80])
            print('  after 3 s:', after[:80])
            print('  on disk:', on_disk)
            b.close()
    finally:
        lab.stop(proc)


if __name__ == '__main__':
    main()
