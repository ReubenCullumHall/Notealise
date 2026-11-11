"""A folder the app isn't allowed to read — inside the vault, or the vault itself: does the app still open?"""
import sys, time, os, subprocess
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); WHERE = sys.argv[2]   # 'inside' a space, at the 'top' level, or the 'root' (the notes folder itself)
WORK = lab.WORK / 'work'
vault = WORK / 'vault-locked'
if vault.exists():
    subprocess.run(['chmod', '-R', 'u+rwx', str(vault)])
lab.seed_vault(vault, folders=2, notes=4)
if WHERE == 'root':
    # the notes folder itself: the app should fall back to its "Choose folder…" screen
    locked = vault
else:
    locked = (vault / 'Biology' / 'Private stuff') if WHERE == 'inside' else (vault / 'Private stuff')
    locked.mkdir()
    (locked / 'secret.md').write_text('# secret\n')
os.chmod(locked, 0o000)
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:300]))
        page.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
        time.sleep(6)
        state = page.evaluate("""() => ({ rows: document.querySelectorAll('.tree-row').length,
          titles: [...document.querySelectorAll('.tree-title')].map(e => e.textContent.trim()).slice(0, 12),
          body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400) })""")
        print(f'=== locked folder {WHERE} ===')
        print('rows in the sidebar:', state['rows'], state['titles'])
        print('what the window says:', state['body'])
        print('page errors:', errs[:6])
        # try reload to catch boot-time errors
        page.reload()
        time.sleep(5)
        state2 = page.evaluate("() => ({ rows: document.querySelectorAll('.tree-row').length, body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) })")
        print('after a window reload: rows', state2['rows'], '|', state2['body'][:200])
        print('page errors after reload:', errs[:10])
        b.close()
finally:
    lab.stop(proc)
    subprocess.run(['chmod', '-R', 'u+rwx', str(vault)])
print('--- behind-the-scenes log ---')
print(open(WORK / 'app.log').read()[-1800:])
