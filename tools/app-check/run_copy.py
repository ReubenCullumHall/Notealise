"""Typing feel on a COPY of a real vault (docs/feature-done-checklist.md §7: smoothness is
measured on real notes, before and after). Copies only the notes' text and the two settings
files into $WORK, opens the biggest note there, and types on a fresh line at its end, then in
a heading. Prints sizes and timings only — never a note's name or words. The real vault is
only read.

  python3 run_copy.py <port> "<path to the real vault>"      (LAB_OUT=<build folder> picks the build)
"""
import json, os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); SRC = Path(sys.argv[2])
WORK = lab.WORK / 'work'
vault = WORK / 'vault-copy'
if vault.exists():
    shutil.rmtree(vault)
notes = []
for root, dirs, files in os.walk(SRC):
    dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
    for f in files:
        if f.lower().endswith('.md') and not f.startswith('.'):
            src = Path(root) / f
            dst = vault / src.relative_to(SRC)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            notes.append(dst)
(vault / '.mdnotes').mkdir(parents=True, exist_ok=True)
for name in ('settings.json', 'workspace.json'):
    if (SRC / '.mdnotes' / name).exists():
        shutil.copyfile(SRC / '.mdnotes' / name, vault / '.mdnotes' / name)
biggest = max(notes, key=lambda p: p.stat().st_size)
rel = biggest.relative_to(vault).as_posix()
lines = biggest.read_text(errors='ignore').count('\n') + 1
links = sum(p.read_text(errors='ignore').count('[[') for p in notes)
# open that note at launch, in its own space, with no opening animation in the way
sp = vault / '.mdnotes' / 'settings.json'
s = json.loads(sp.read_text()) if sp.exists() else {}
s['session'] = {'tabs': [rel], 'panes': [rel], 'focus': 0}
s['startup'] = 'last'
s['playStartupAnimation'] = False
if '/' in rel:
    s['activeSpaceFolder'] = rel.split('/')[0]
sp.write_text(json.dumps(s))
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')

START = """() => { window.__long = []; window.__frames = []; window.__stop = false;
  window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]) });
  window.__po.observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  const tick = (t) => { window.__frames.push([Math.round(t), +(t - last).toFixed(1)]); last = t; if (!window.__stop) requestAnimationFrame(tick) };
  requestAnimationFrame(tick); }"""
NOW = "() => Math.round(performance.now())"


def step(page, label, fn, settle=1.5):
    a = page.evaluate(NOW)
    fn()
    time.sleep(settle)
    b = page.evaluate(NOW)
    r = page.evaluate("() => ({ long: window.__long, frames: window.__frames })")
    tasks = sorted([d for (s0, d) in r['long'] if a - 50 <= s0 <= b], reverse=True)
    slow = [d for (t, d) in r['frames'] if a <= t <= b and d > 33]
    print(f"  {label:40s} freezes over 50 ms: {len(tasks):2d} {tasks[:5]} | frames over 33 ms: {len(slow)} (worst {max(slow, default=0)} ms)")


try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)[:160]))
        page.wait_for_selector('.cm-content', timeout=60000)
        time.sleep(4)
        look = page.evaluate("() => ({ theme: document.documentElement.dataset.theme, page: document.documentElement.dataset.pageLook || document.documentElement.dataset.page || null, drawn: document.querySelectorAll('.cm-line').length, chips: document.querySelectorAll('.links-scroll > *').length })")
        print(f"=== copy of a real vault: {len(notes)} notes, {links} [[links]] in all; the biggest note is {biggest.stat().st_size / 1024:.0f} KB, {lines} lines; look: {look} | build: {os.environ.get('LAB_OUT', 'out')} ===")
        page.evaluate(START)
        text = 'these are some ordinary words typed at a steady pace to see how the note keeps up with the hands '
        step(page, 'clicking to the end of the note', lambda: (page.locator('.cm-content').first.click(), page.keyboard.press('Meta+ArrowDown'), page.keyboard.press('Enter')))
        step(page, 'the first key', lambda: page.keyboard.type('x'))
        step(page, '190 ordinary letters', lambda: page.keyboard.type(text * 2, delay=45), settle=1.5)
        step(page, 'a new heading: "## " and 20 letters', lambda: (page.keyboard.press('Enter'), page.keyboard.type('## a heading typed here', delay=45)), settle=2.5)
        step(page, '60 more ordinary letters', lambda: (page.keyboard.press('Enter'), page.keyboard.type(text[:60], delay=45)))
        print('  window errors:', errors[:3])
        b.close()
finally:
    lab.stop(proc)
    shutil.rmtree(vault, ignore_errors=True)   # the copy does not outlive the run
