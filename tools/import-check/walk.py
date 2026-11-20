"""Click through Settings -> Data -> Import in the scratch app for one or more cases, the way a person would.
usage: python3 walk.py <port> <build dir> <case> [<case>...]     case = name=FormatLabel=path"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = int(sys.argv[1]); B = Path(sys.argv[2]); INSPECT = PORT + 100
CASES = [c.split('=', 2) for c in sys.argv[3:]]
S = Path(__file__).resolve().parent.parent / 'app-check'
vault = B / 'work' / 'vault'; ud = B / 'work' / 'ud'; shots = B / 'shots'
for d in (vault, ud):
    if d.exists(): shutil.rmtree(d)
shots.mkdir(exist_ok=True)
(vault / 'Notes').mkdir(parents=True); (vault / '.mdnotes').mkdir(); ud.mkdir(parents=True)
(vault / 'Notes' / 'Hello.md').write_text('# Hello\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Notes'}], 'activeSpaceFolder': 'Notes', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
node = str(Path.home() / '.local/opt/node/bin/node')
proc = subprocess.Popen([str(E), f'--inspect={INSPECT}', str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}'],
                        env=env, stdout=open(B / 'work' / 'walk.log', 'w'), stderr=subprocess.STDOUT)


def panel_text(page):
    return page.evaluate("""() => { const h = [...document.querySelectorAll('h3')].find(e => /Import/.test(e.textContent)); return h ? h.parentElement.innerText : '(no import panel)' }""")


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
        for name, label, src in CASES:
            print(f'\n=== {name}: {label} <- {Path(src).name}')
            subprocess.run([node, str(S / 'main_eval.mjs'), str(INSPECT), "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('menu:command','import-notes')"], capture_output=True)
            if page.locator('h3', has_text='Import data').count() == 0:
                # fall back to the gear
                page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', {key: ',', metaKey: true, bubbles: true}))")
                time.sleep(0.8)
            if page.locator('h3', has_text='Import data').count() == 0:
                page.get_by_text('Settings', exact=True).first.click(); time.sleep(0.8)
                page.get_by_text('Data', exact=True).first.click(); time.sleep(0.4)
                page.get_by_text('Import', exact=True).first.click(); time.sleep(0.4)
            page.wait_for_selector('h3:has-text("Import data")', timeout=8000)
            # the format drop-down
            row = page.locator('text=File format').first
            sel = page.locator('h3:has-text("Import data")').locator('xpath=..').locator('button[aria-expanded]').first
            sel.click(); time.sleep(0.3)
            page.get_by_role('option', name=label, exact=True).first.click() if page.get_by_role('option', name=label, exact=True).count() else page.get_by_text(label, exact=True).last.click()
            time.sleep(0.3)
            if src != '-':
                print('  file box:', subprocess.run([node, str(S / 'patch_dialog.mjs'), str(INSPECT), src], capture_output=True, text=True).stdout.strip())
                btn = page.locator('button.mini', has_text='Choose').first
                t0 = time.time(); btn.click()
                # wait for the preview box or an error
                for _ in range(2400):
                    t = panel_text(page)
                    if 'will be created' in t or page.locator('p.text-red-500').count(): break
                    time.sleep(0.05)
                print(f'  pick -> preview: {time.time() - t0:.1f}s')
            page.screenshot(path=str(shots / f'{name}-1-ready.png'))
            print('  ON SCREEN (ready):', panel_text(page).replace('\n', ' | ')[:1400])
            imp = page.locator('button.mini', has_text='Import').last
            if imp.is_disabled():
                print('  Import button is greyed out'); page.keyboard.press('Escape'); time.sleep(1.5); continue
            t0 = time.time(); imp.click()
            seen = set()
            for _ in range(6000):
                t = panel_text(page)
                if 'Import complete' in t or 'Import stopped' in t or page.locator('p.text-red-500').count(): break
                time.sleep(0.05)
            print(f'  import took: {time.time() - t0:.1f}s')
            time.sleep(0.6)
            page.screenshot(path=str(shots / f'{name}-2-done.png'))
            print('  ON SCREEN (after):', panel_text(page).replace('\n', ' | ')[:900])
            if page.locator('button.mini', has_text='Show me the notes').count():
                page.locator('button.mini', has_text='Show me the notes').click(); time.sleep(2.2)
                page.screenshot(path=str(shots / f'{name}-3-app.png'))
                print('  SIDEBAR:', page.evaluate("() => [...document.querySelectorAll('.tree-row .tree-title')].map(e => e.textContent).slice(0, 40).join(' · ')"))
                print('  OPEN NOTE:', page.evaluate("() => (document.querySelector('.cm-content')?.innerText || '(no note open)').slice(0, 200)").replace('\n', ' ⏎ '))
            else:
                page.keyboard.press('Escape'); time.sleep(1.5)
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
t = open(B / 'work' / 'walk.log').read()
print('\napp log errors:', [l[:200] for l in t.splitlines() if 'rror' in l][:6])
