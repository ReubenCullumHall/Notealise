"""In a real window: bin one note and pin another at (nearly) the same moment, 40 times. How many pins and bin rows survive?
usage: python3 run_bin_and_pin.py <port> <build dir>"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2])
vault = B / 'work' / 'vault-turns'; ud = B / 'work' / 'ud-turns'
for d in (vault, ud):
    if d.exists(): shutil.rmtree(d)
(vault / 'Space').mkdir(parents=True); (vault / '.mdnotes').mkdir(); ud.mkdir(parents=True)
N = 40
for i in range(N):
    (vault / 'Space' / f'Gone {i}.md').write_text(f'# Gone {i}\n'); (vault / 'Space' / f'Keep {i}.md').write_text(f'# Keep {i}\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
proc = subprocess.Popen([str(E), str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}'], env=env, stdout=open(B / 'work' / 'turns.log', 'w'), stderr=subprocess.STDOUT)
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
            except Exception: time.sleep(0.25)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        r = page.evaluate("""async (N) => {
          for (let i = 0; i < N; i++) {
            const wait = (ms) => new Promise(r => setTimeout(r, ms))
            await Promise.all([
              window.api.trashEntries([`Space/Gone ${i}.md`]),
              wait(i % 4).then(() => window.api.updateEntries([`Space/Keep ${i}.md`], { pinned: true }))
            ])
          }
          await new Promise(r => setTimeout(r, 600))
          const ws = await window.api.getWorkspace()
          return { pins: Object.values(ws.entries).filter(e => e.pinned).length, binRows: ws.trash.length } }""", N)
        time.sleep(0.5)
        disk = json.loads((vault / '.mdnotes' / 'workspace.json').read_text())
        files_gone = sum(1 for i in range(N) if not (vault / 'Space' / f'Gone {i}.md').exists())
        print(f"  of {N}: pins kept {r['pins']} (in the saved file {sum(1 for e in disk['entries'].values() if e.get('pinned'))}) | bin rows {r['binRows']} (saved {len(disk['trash'])}) | notes really moved to the bin {files_gone}")
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
