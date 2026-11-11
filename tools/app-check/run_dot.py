"""Does the app notice a note added from outside when the notes folder's own name starts with a dot?"""
import sys, time
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1])
WORK = lab.WORK / 'work'
for name in ('vault-plain', '.vault-dot'):
    vault = WORK / name
    lab.seed_vault(vault, folders=1, notes=2)
    ud = WORK / 'ud'
    lab.profile(ud, vault)
    proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
    try:
        with sync_playwright() as p:
            b, page = lab.connect(p, PORT)
            page.wait_for_selector('.tree-row', timeout=30000)
            time.sleep(3)
            (vault / 'Biology' / 'Added from outside.md').write_text('# Added\n\nMade by another program.\n')
            time.sleep(4)
            seen = page.evaluate("() => [...document.querySelectorAll('.tree-title')].some(e => e.textContent.includes('Added from outside'))")
            print(f"folder named {name!r}: new note shows in the sidebar without restarting: {seen}")
            b.close()
    finally:
        lab.stop(proc)
        time.sleep(1)
