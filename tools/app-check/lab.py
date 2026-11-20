"""Scratch lab for the app audit: seed a made-up vault, launch the scratch build on its own
profile with a debug port, and measure things over CDP. Nothing here touches the installed app,
~/notes-app-mac's profile, or any real notes."""
import json, os, shutil, subprocess, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Everything made here (the scratch build, made-up vaults, the test profile) lives in $WORK.
WORK = Path(os.environ.get("WORK", "/tmp/app-check"))
ELECTRON = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
MAIN = WORK / os.environ.get("LAB_OUT", "out") / "main/index.js"

PARA = ('The quick brown fox jumps over the lazy dog while **bold words** and *italic ones* sit beside a '
        '[[Cell structure]] link and a <mark class="hl-amber">highlight</mark> in the middle of an ordinary '
        'sentence about revision for the exam next week.')


def note_text(title: str, lines: int, seed: int = 0) -> str:
    out = [f'# {title}', '']
    i = 0
    while len(out) < lines:
        i += 1
        out += [f'## Section {i}', '']
        for _ in range(3):
            out += [PARA, '']
        out += ['- first point', '- second point with [a link](https://example.com)', '- [ ] a task', '']
        if (i + seed) % 5 == 0:
            out += ['| Term | Meaning |', '| --- | --- |', '| alpha | first |', '| beta | second |', '']
        if (i + seed) % 7 == 0:
            out += ['$$', 'E = mc^2', '$$', '']
        if (i + seed) % 9 == 0:
            out += ['<details><summary>A toggle</summary>', '', 'Hidden words here.', '', '</details>', '']
    return '\n'.join(out) + '\n'


def seed_vault(vault: Path, spaces=('Biology', 'Maths', 'Physics', 'Journal'), folders=5, notes=12,
               lines=90, splash=False, extra=None) -> int:
    if vault.exists():
        shutil.rmtree(vault)
    count = 0
    for s in spaces:
        for f in range(folders):
            d = vault / s / f'Topic {f + 1}'
            d.mkdir(parents=True)
            for n in range(notes):
                name = f'{s} note {f + 1}-{n + 1}'
                (d / f'{name}.md').write_text(note_text(name, lines + (n * 7) % 60, n))
                count += 1
    (vault / spaces[0] / 'Cell structure.md').write_text(note_text('Cell structure', 80))
    (vault / spaces[0] / 'Typical.md').write_text(note_text('Typical', 150))
    (vault / spaces[0] / 'Long.md').write_text(note_text('Long', 2000))
    (vault / spaces[0] / 'Huge.md').write_text(note_text('Huge', 10000))
    count += 4
    (vault / '.mdnotes').mkdir()
    settings = {'spaces': [{'folder': s} for s in spaces], 'activeSpaceFolder': spaces[0],
                'playStartupAnimation': splash}
    if extra:
        settings.update(extra)
    (vault / '.mdnotes' / 'settings.json').write_text(json.dumps(settings))
    return count


def profile(ud: Path, vault: Path) -> None:
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir(parents=True)
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))


def launch(ud: Path, port: int, log: Path):
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    log.parent.mkdir(parents=True, exist_ok=True)
    f = open(log, "w")
    t0 = time.time()
    args = [str(ELECTRON), str(MAIN), f'--user-data-dir={ud}', f'--remote-debugging-port={port}', '--mute-audio']
    if not os.environ.get('LAB_SHOW'):
        # Quiet: off-screen, never takes focus (Reuben works while checks run), and a hidden
        # window still runs its timers and drawing at full speed.
        env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + f' --require "{HERE / "quiet.cjs"}"').strip()
        args += ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
                 '--disable-background-timer-throttling']
    proc = subprocess.Popen(args, env=env, stdout=f, stderr=subprocess.STDOUT)
    return proc, t0


def wait_page_target(port: int, timeout=40.0):
    """Poll the debug port's plain HTTP list until the app's page is there. Returns the time."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=0.3) as r:
                targets = json.loads(r.read())
            if any(t.get('type') == 'page' and t.get('url', '').startswith('file:') for t in targets):
                return time.time()
        except Exception:
            pass
        time.sleep(0.02)
    return None


def connect(p, port: int):
    for _ in range(80):
        try:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
            page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
            page.set_default_timeout(20000)
            return b, page
        except Exception:
            time.sleep(0.25)
    raise SystemExit('the scratch app never opened')


def stop(proc) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except Exception:
        proc.kill()


def rss_mb(proc) -> float:
    """Resident memory of the scratch app and all its helper processes, in MB."""
    out = subprocess.run(['ps', '-axo', 'pid,ppid,rss,command'], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines()[1:]:
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3]))
    kids = {proc.pid}
    grew = True
    while grew:
        grew = False
        for pid, ppid, _, _ in rows:
            if ppid in kids and pid not in kids:
                kids.add(pid)
                grew = True
    return sum(r for pid, _, r, _ in rows if pid in kids) / 1024


def open_note(page, folder, title, settle=1.0):
    """Click a note in the sidebar (opening its folder first when given)."""
    if folder:
        row = page.locator('.tree-title', has_text=folder).first
        row.click()
        time.sleep(0.4)
    page.locator('.tree-title', has_text=title).first.click()
    page.wait_for_selector('.cm-content')
    time.sleep(settle)
