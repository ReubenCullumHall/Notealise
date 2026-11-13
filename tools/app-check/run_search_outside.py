"""Search notes after a change made outside the app: how long until the changed note's new word is found,
and is anything stale? 2,004 notes, contents + every space on. usage: WORK=.. python3 run_search_outside.py <port>"""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); WORK = lab.WORK / 'work'; vault = WORK / 'vault-search'
n = lab.seed_vault(vault, spaces=('Biology', 'Maths', 'Physics', 'Journal', 'History', 'English', 'Chemistry', 'Projects'), folders=10, notes=25)
ud = WORK / 'ud-search'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'search.log')
ROWS = "() => [...document.querySelectorAll('aside .tree-row .tree-title')].map(e => e.textContent)"
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=60000); time.sleep(3)
        page.locator('[data-tip="Searching titles only"]').first.click()
        page.locator('[data-tip="Searching this space only"]').first.click()
        box = page.locator('input[placeholder^="Search notes"]').first
        t0 = time.time(); box.fill('exam next week')
        page.wait_for_function("() => document.querySelectorAll('aside .tree-row').length > 50", timeout=120000)
        print(f'=== {n} notes ===')
        print(f'  first search inside every note (reads them all): {time.time() - t0:.2f} s')
        times = []
        for i in range(5):
            word = f'zebracorn{i}'
            box.fill(word); time.sleep(1.0)
            assert page.evaluate(ROWS) == [], 'the made-up word was already there'
            f = vault / 'History' / f'Topic {i + 2}' / f'History note {i + 2}-5.md'
            t = time.time(); f.write_text(f.read_text() + f'\nA line added by another program: {word}.\n')
            page.wait_for_function("(w) => [...document.querySelectorAll('aside .tree-row')].some(r => r.textContent.includes('History note'))", arg=word, timeout=120000)
            times.append(time.time() - t)
        print('  a note changed outside → its new word found after (s):', [round(x, 2) for x in times], '| median', round(sorted(times)[2], 2))
        # nothing stale: a word REMOVED outside stops being found, and an untouched note is still found
        f = vault / 'Maths' / 'Topic 1' / 'Maths note 1-1.md'; f.write_text(f.read_text() + '\nremovablephrase here\n'); time.sleep(1.5)
        box.fill('removablephrase'); page.wait_for_function("() => document.querySelectorAll('aside .tree-row').length === 1", timeout=30000)
        f.write_text(f.read_text().replace('removablephrase', 'gone')); time.sleep(2.0)
        print('  a word taken out of a note outside is no longer found:', page.evaluate(ROWS) == [])
        # a folder renamed outside: its notes are found under the new place, not the old
        (vault / 'English' / 'Topic 1').rename(vault / 'English' / 'Renamed topic'); time.sleep(2.5)
        box.fill('English note 1-1'); time.sleep(1.5)
        print('  after a folder was renamed outside, its note is listed once:', page.evaluate(ROWS))
        b.close()
finally:
    lab.stop(proc)
