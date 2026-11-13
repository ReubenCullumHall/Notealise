"""The 7-day tidy-up at launch, in the real app, with one expired item that can't be deleted. usage: python3 run_recovery_sweep.py <port> <build dir>"""
import json, os, shutil, stat, subprocess, sys, time
from pathlib import Path
PORT = int(sys.argv[1]); B = Path(sys.argv[2])
vault = B / 'work' / 'vault-sweep'; ud = B / 'work' / 'ud-sweep'
if vault.exists():
    for d in vault.rglob('*'):
        if d.is_dir(): os.chmod(d, 0o700)
    shutil.rmtree(vault)
if ud.exists(): shutil.rmtree(ud)
(vault / 'Space').mkdir(parents=True); rec = vault / '.mdnotes' / 'recovery'; rec.mkdir(parents=True); ud.mkdir(parents=True)
(vault / 'Space' / 'Hello.md').write_text('# Hello\n')
(rec / 'aaaaaa-First.md').write_text('one'); (rec / 'bbbbbb-Stuck').mkdir(); (rec / 'bbbbbb-Stuck' / 'inside.md').write_text('two')
(rec / 'cccccc-Third.md').write_text('three'); (rec / 'dddddd-Recent.md').write_text('four')
os.chmod(rec / 'bbbbbb-Stuck', 0o500)
old = int(time.time() * 1000) - 8 * 24 * 3600 * 1000
(vault / '.mdnotes' / 'workspace.json').write_text(json.dumps({'entries': {}, 'trash': [], 'recovery': [
    {'id': 'aaaaaa', 'from': 'Space/First.md', 'name': 'First.md', 'type': 'file', 'purgedAt': old},
    {'id': 'bbbbbb', 'from': 'Space/Stuck', 'name': 'Stuck', 'type': 'dir', 'purgedAt': old},
    {'id': 'cccccc', 'from': 'Space/Third.md', 'name': 'Third.md', 'type': 'file', 'purgedAt': old},
    {'id': 'dddddd', 'from': 'Space/Recent.md', 'name': 'Recent.md', 'type': 'file', 'purgedAt': int(time.time() * 1000)}]}))
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Space'}], 'activeSpaceFolder': 'Space', 'playStartupAnimation': False}))
(ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
proc = subprocess.Popen([str(E), str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}'], env=env, stdout=open(B / 'work' / 'sweep.log', 'w'), stderr=subprocess.STDOUT)
time.sleep(7)
proc.terminate()
try: proc.wait(timeout=8)
except Exception: proc.kill()
listed = [r['id'][0].upper() for r in json.loads((vault / '.mdnotes' / 'workspace.json').read_text())['recovery']]
on_disk = sorted(p.name.split('-')[1][0] for p in rec.iterdir())
print(f"  expired: First, Stuck (can't be deleted), Third; not expired: Recent  →  still on disk {on_disk} | still LISTED as recoverable {listed}")
os.chmod(rec / 'bbbbbb-Stuck', 0o700)
