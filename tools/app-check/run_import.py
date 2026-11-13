"""A real Word import and a real web-page import in the scratch app (its file box answered by patch_dialog.mjs).
usage: python3 run_import.py <port> <build dir>   (APP_BIN=<packaged binary> for a packaged app)"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2]); S = Path(__file__).resolve().parent; INSPECT = PORT + 100
vault = B / 'work' / 'vault-import'; ud = B / 'work' / 'ud-import'
for d in (vault, ud):
    if d.exists(): shutil.rmtree(d)
(vault / 'Notes').mkdir(parents=True); (vault / '.mdnotes').mkdir(); ud.mkdir(parents=True)
(vault / 'Notes' / 'Hello.md').write_text('# Hello\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Notes'}], 'activeSpaceFolder': 'Notes', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
APP_BIN = os.environ.get('APP_BIN')
cmd = ([APP_BIN] if APP_BIN else [str(E), str(B / 'out/main/index.js')]) + [f'--inspect={INSPECT}', f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}']
if not APP_BIN: cmd = [cmd[0], f'--inspect={INSPECT}', cmd[1]] + cmd[3:]
proc = subprocess.Popen(cmd, env=env, stdout=open(B / 'work' / 'import.log', 'w'), stderr=subprocess.STDOUT)
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
            except Exception: time.sleep(0.25)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        node = str(Path.home() / '.local/opt/node/bin/node')
        print('  file box:', subprocess.run([node, str(S / 'patch_dialog.mjs'), str(INSPECT), str(B / 'fix' / 'Essay draft.docx'), str(B / 'fix' / 'Lab report.html')], capture_output=True, text=True).stdout.strip() or 'PATCH FAILED')
        formats = page.evaluate("() => window.api.importFormats()")
        for fmt, space in (('word', 'From Word'), ('html', 'From web pages')):
            modes = next(f['pickModes'] for f in formats if f['id'] == fmt)
            r = page.evaluate("""async ([fmt, mode, space]) => { try {
                const picked = await window.api.importPickSource(fmt, mode); if (!picked) return { error: 'nothing picked' }
                const paths = await window.api.importPrepare(fmt, picked)
                const preview = await window.api.importPreview(fmt, paths)
                const result = await window.api.importRun(fmt, paths, space)
                return { picked: picked.map(p => p.split('/').pop()), preview: JSON.stringify(preview).slice(0, 160), result: JSON.stringify(result).slice(0, 300) } } catch (e) { return { error: String(e) } } }""", [fmt, modes[0], space])
            print(f'  {fmt}:', r)
        time.sleep(1)
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
for f in sorted(vault.rglob('*.md')):
    if 'Hello' in f.name or '.mdnotes' in str(f): continue
    print('   wrote', f.relative_to(vault), '→', f.read_text()[:150].replace('\n', ' ⏎ '))
t = open(B / 'work' / 'import.log').read()
print('  errors in the app log:', [l[:160] for l in t.splitlines() if 'Error' in l or 'rror:' in l][:4])
