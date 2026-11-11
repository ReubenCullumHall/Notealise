"""When does the window freeze in a big vault? Times every long freeze against what was typed:
the first key after opening a note, ordinary words, a heading, a new [[link]]."""
import sys, time
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); WHICH = sys.argv[2] if len(sys.argv) > 2 else 'big'
WORK = lab.WORK / 'work'
vault = WORK / ('vault-small' if WHICH == 'small' else 'vault-big')
if WHICH == 'small':
    n = lab.seed_vault(vault)
else:
    n = lab.seed_vault(vault, spaces=('Biology', 'Maths', 'Physics', 'Journal', 'History', 'English', 'Chemistry', 'Projects'), folders=10, notes=25)
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
START = """() => { window.__long = []; window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]) });
  window.__po.observe({ entryTypes: ['longtask'] }); return Math.round(performance.now()) }"""
NOW = "() => Math.round(performance.now())"


def step(page, label, fn, settle=2.5):
    a = page.evaluate(NOW)
    fn()
    time.sleep(settle)
    b = page.evaluate(NOW)
    tasks = [d for (s, d) in page.evaluate("() => window.__long") if a - 50 <= s <= b]
    print(f"  {label:44s} freezes over 50 ms: {len(tasks):2d}  {sorted(tasks, reverse=True)[:6]}")


try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=60000)
        time.sleep(4)
        lab.open_note(page, None, 'Typical', settle=4)
        page.evaluate(START)
        print(f'=== {n} notes ===')
        line = page.locator('.cm-line', has_text='The quick brown fox').first
        step(page, 'clicking into the note', lambda: (line.click(), page.keyboard.press('End')))
        step(page, 'the FIRST key after opening it', lambda: page.keyboard.type('x'))
        step(page, 'twenty more ordinary letters', lambda: page.keyboard.type(' some ordinary words', delay=45))
        head = page.locator('.cm-line', has_text='Section 1').first
        step(page, 'clicking into a heading', lambda: (head.click(), page.keyboard.press('End')))
        step(page, 'ten letters typed in that heading', lambda: page.keyboard.type(' of things', delay=45), settle=4)
        step(page, 'back in a paragraph, typing a new [[link]]', lambda: (line.click(), page.keyboard.press('End'), page.keyboard.type(' [[Typi', delay=45), page.keyboard.press('Escape')), settle=4)
        step(page, 'ten ordinary letters after that', lambda: page.keyboard.type(' and more', delay=45))
        b.close()
finally:
    lab.stop(proc)
