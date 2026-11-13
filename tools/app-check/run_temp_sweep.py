"""The launch clean-up in the real app: old leftovers go, fresh ones and other people's stay. usage: python3 run_temp_sweep.py <port> <build dir>"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
PORT = int(sys.argv[1]); B = Path(sys.argv[2])
vault = B / 'work' / 'vault-ts'; ud = B / 'work' / 'ud-ts'; tmp = B / 'work' / 'tmp-ts'
for d in (vault, ud, tmp):
    if d.exists(): shutil.rmtree(d)
(vault / 'Space').mkdir(parents=True); (vault / '.mdnotes').mkdir(); ud.mkdir(parents=True); tmp.mkdir(parents=True)
(vault / 'Space' / 'Hello.md').write_text('# Hello\n')
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
def make(name, days):
    d = tmp / name; d.mkdir(); (d / 'input.wav').write_bytes(b'x' * 1000)
    t = time.time() - days * 86400
    os.utime(d / 'input.wav', (t, t)); os.utime(d, (t, t))
make('notealise-transcribe-OLD001', 3); make('notealise-voice-OLD002', 3); make('notealise-print-OLD003', 3)
make('notealise-transcribe-NEW001', 0); make('notealise-onboarding-test', 30); make('someone-elses-folder', 30)
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}; env['TMPDIR'] = str(tmp)
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
proc = subprocess.Popen([str(E), str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}'], env=env, stdout=open(B / 'work' / 'ts.log', 'w'), stderr=subprocess.STDOUT)
time.sleep(7); proc.terminate()
try: proc.wait(timeout=8)
except Exception: proc.kill()
print('  left after one launch:', sorted(p.name for p in tmp.iterdir() if p.name.startswith(('notealise', 'someone'))))
