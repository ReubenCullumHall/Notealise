"""Finer than run_firstkey: the longest gap between drawn frames for the first key and for keys in a heading.
usage: WORK=.. python3 run_firstkey_frames.py <port> small|big [note title]"""
import sys, time
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); WHICH = sys.argv[2]; NOTE = sys.argv[3] if len(sys.argv) > 3 else 'Typical'
WORK = lab.WORK / 'work'; vault = WORK / ('vault-small' if WHICH == 'small' else 'vault-big')
n = lab.seed_vault(vault) if WHICH == 'small' else lab.seed_vault(vault, spaces=('Biology', 'Maths', 'Physics', 'Journal', 'History', 'English', 'Chemistry', 'Projects'), folders=10, notes=25)
ud = WORK / 'ud'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
START = """() => { window.__gaps = []; let last = performance.now(); const f = (t) => { window.__gaps.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(f) }; requestAnimationFrame(f); return 1 }"""
def step(page, label, fn, settle=2.0):
    a = page.evaluate("() => Math.round(performance.now())"); fn(); time.sleep(settle); b = page.evaluate("() => Math.round(performance.now())")
    gaps = sorted([d for (s, d) in page.evaluate("() => window.__gaps") if a - 20 <= s <= b], reverse=True)
    print(f"  {label:40s} longest gaps between frames (ms): {gaps[:5]}   over 33 ms: {sum(1 for g in gaps if g > 33)}")
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=60000); time.sleep(4)
        t0 = time.time(); lab.open_note(page, None, NOTE, settle=4)
        page.evaluate(START); time.sleep(0.5)
        print(f'=== {n} notes, note "{NOTE}" ===')
        line = page.locator('.cm-line', has_text='The quick brown fox').first
        step(page, 'clicking into the note', lambda: (line.click(), page.keyboard.press('End')))
        step(page, 'the FIRST key after opening it', lambda: page.keyboard.type('x'))
        step(page, 'twenty ordinary letters', lambda: page.keyboard.type(' some ordinary words', delay=45))
        head = page.locator('.cm-line', has_text='Section 1').first
        step(page, 'clicking into a heading', lambda: (head.click(), page.keyboard.press('End')))
        step(page, 'ten letters typed in that heading', lambda: page.keyboard.type(' of things', delay=45), settle=3)
        step(page, 'a new [[link]] typed and closed', lambda: (line.click(), page.keyboard.press('End'), page.keyboard.type(' [[Typical]] ', delay=45)), settle=3)
        b.close()
finally:
    lab.stop(proc)
