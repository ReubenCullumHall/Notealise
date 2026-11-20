"""Open given notes in the scratch app and take a picture of each. usage: look.py <port> <build> <vault> <note title>..."""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2]); vault = Path(sys.argv[3]); TITLES = sys.argv[4:]; INSPECT = PORT + 100
S = Path(__file__).resolve().parent.parent / 'app-check'
ud = B / 'work' / 'ud-look'; shots = B / 'shots'
if ud.exists(): shutil.rmtree(ud)
ud.mkdir(parents=True); (vault / '.mdnotes').mkdir(exist_ok=True)
# every top-level folder is a space (up to the app's 15), so imported spaces are reachable however they were laid out
tops = sorted(d.name for d in vault.iterdir() if d.is_dir() and not d.name.startswith('.'))[:15]
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': t} for t in tops], 'activeSpaceFolder': tops[0], 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
node = str(Path.home() / '.local/opt/node/bin/node')
proc = subprocess.Popen([str(E), f'--inspect={INSPECT}', str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
            except Exception: time.sleep(0.25)
        page.emulate_media(color_scheme='light', reduced_motion='null')
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        for i, t in enumerate(TITLES):
            subprocess.run([node, str(S / 'main_eval.mjs'), str(INSPECT), "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('menu:command','quick-open')"], capture_output=True)
            time.sleep(0.6)
            # Go to a note searches only the space you're in unless its "every space" toggle is on
            box = page.locator('input[aria-label="Go to a note"]')
            box.wait_for(timeout=5000)
            if 'all spaces' not in (box.get_attribute('placeholder') or ''):
                page.evaluate("() => document.querySelector('[data-tip=\"Searching this space only\"]').click()"); time.sleep(0.4)
            page.keyboard.type(t, delay=15); time.sleep(0.6); page.keyboard.press('Enter'); time.sleep(1.8)
            if os.environ.get('LOOK_SCROLL'):  # px to scroll the note before the picture
                page.evaluate("(y) => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = y }", int(os.environ['LOOK_SCROLL'])); time.sleep(0.8)
            name = f'look-{i}-' + ''.join(c if c.isalnum() else '_' for c in t)[:30]
            page.screenshot(path=str(shots / f'{name}.png'))
            print(name, '|', page.evaluate("() => (document.querySelector('.cm-content')?.innerText || '(no note open)').slice(0, 900)").replace('\n', ' ⏎ '))
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
