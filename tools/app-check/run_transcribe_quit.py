"""Quit the app part-way through a real transcription: what is left in the temp folder, and is the program still running?
usage: python3 run_transcribe_quit.py <port> <build dir>"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2]); S = Path(__file__).resolve().parent; INSPECT = PORT + 100
REPO = Path(__file__).resolve().parents[2]
vault = B / 'work' / 'vault-tq'; ud = B / 'work' / 'ud-tq'; tmp = B / 'work' / 'tmp-tq'
for d in (vault, ud, tmp):
    if d.exists(): shutil.rmtree(d)
(vault / 'Voice').mkdir(parents=True); (vault / '.mdnotes').mkdir(); ud.mkdir(parents=True); tmp.mkdir(parents=True)
shutil.copy(B / 'fix' / 'talk.m4a', vault / 'Voice' / 'talk.m4a')
(vault / 'Voice' / 'Lecture.md').write_text('# Lecture\n\nAbove.\n\n<audio controls src="talk.m4a"></audio>\n\nEnd.\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Voice'}], 'activeSpaceFolder': 'Voice', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}; env['TMPDIR'] = str(tmp)
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
node = str(Path.home() / '.local/opt/node/bin/node')
def main_eval(expr): return subprocess.run([node, str(S / 'main_eval.mjs'), str(INSPECT), expr], capture_output=True, text=True).stdout.strip()
def left(): return sorted(f"{p.name[:21]}… ({sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) / 1048576:.1f} MB)" for p in tmp.iterdir() if p.name.startswith('notealise-'))
def whisper(): return subprocess.run(['pgrep', '-fl', str(tmp)], capture_output=True, text=True).stdout.count('whisper')
proc = subprocess.Popen([str(E), f'--inspect={INSPECT}', str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=open(B / 'work' / 'tq.log', 'w'), stderr=subprocess.STDOUT)
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
            except Exception: time.sleep(0.25)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        app_path = json.loads(main_eval("process.mainModule.require('electron').app.getAppPath()"))
        link = Path(app_path) / 'build-whisper'
        if not link.exists(): os.symlink(REPO / 'build-whisper', link)
        page.locator('.tree-title', has_text='Lecture').first.click()
        page.wait_for_function("() => document.querySelector('.cm-voice')?.dataset.state === 'ready'", timeout=30000); time.sleep(1)
        page.locator('.cm-voice').get_by_text('Transcribe', exact=True).first.click()
        page.wait_for_function("() => /Transcribing · \\d+%/.test(document.querySelector('.cm-voice')?.innerText || '')", timeout=90000)
        time.sleep(1.5)
        print('  part-way:', page.evaluate("() => (document.querySelector('.cm-voice').innerText.match(/Transcribing[^\\n]*/) || [''])[0]"), '| temp folder holds', left(), '| the program running:', whisper())
        try: b.close()
        except Exception: pass
    print('  quit:', main_eval("(process.mainModule.require('electron').app.quit(), 'asked to quit')"))
    try: proc.wait(timeout=20)
    except Exception: print('  the app did not quit in 20 s'); proc.kill()
    time.sleep(2.5)
    print('  AFTER QUITTING — left in the temp folder:', left() or 'nothing', '| the program still running:', whisper())
finally:
    if proc.poll() is None: proc.kill()
    subprocess.run(['pkill', '-f', str(tmp)], capture_output=True)
