"""Shared by the voice-check scripts: a fresh two-space vault, and the scratch app on its own
profile with a debug port. The app is the one `build.sh` built into $WORK (default
/tmp/voice-check); it never touches ~/notes-app-mac's own profile or the installed app."""
import json, os, shutil, subprocess, sys, time
from contextlib import contextmanager
from pathlib import Path

WIN = sys.platform == 'win32'
WORK = Path(os.environ.get('WORK', (os.environ.get('TEMP', '.') + '/notealise-check/build') if WIN else '/tmp/voice-check'))
ELECTRON = (Path(__file__).resolve().parents[2] / 'node_modules/electron/dist/electron.exe') if WIN else     Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
# The key that is Cmd on a Mac and Ctrl elsewhere (the app's own zoom/undo modifier).
MOD = 'Control' if WIN else 'Meta'
# Redo: Ctrl+Y on Windows (CodeMirror's own binding), Cmd+Shift+Z on a Mac.
REDO = 'Control+y' if WIN else 'Meta+Shift+z'


def reset_vault() -> Path:
    """Space "Voice" (a long note holding one voice note) and space "Other". Rewritten before
    every run: the app saves the space it was last in, and a run that ends in "Other" would
    start the next one there."""
    vault = WORK / 'vault'
    if vault.exists():
        shutil.rmtree(vault)
    (vault / 'Voice').mkdir(parents=True)
    (vault / 'Other').mkdir()
    (vault / '.mdnotes').mkdir()
    shutil.copy(WORK / 'memo.m4a', vault / 'Voice' / 'memo.m4a')
    lines = ['# Zoom', '', 'Above the voice note.', '', '<audio controls src="memo.m4a"></audio>', '', 'The line under it.', '']
    lines += [f'Filler line {i} so the note scrolls up and down.' for i in range(80)]
    # LF unless NOTE_CRLF=1: Python on Windows would otherwise write CRLF files, which is a different test
    nl = '\r\n' if os.environ.get('NOTE_CRLF') else '\n'
    (vault / 'Voice' / 'Zoom.md').write_text('\n'.join(lines) + '\n', newline=nl)
    (vault / 'Other' / 'Elsewhere.md').write_text('# Elsewhere\n\nThe other space.\n', newline=nl)
    (vault / '.mdnotes' / 'settings.json').write_text(json.dumps(
        {'spaces': [{'folder': 'Voice'}, {'folder': 'Other'}], 'activeSpaceFolder': 'Voice'}))
    ud = WORK / 'ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
    return vault


SRC = Path(__file__).resolve().parents[2] / 'src'


@contextmanager
def app(port: int):
    """The scratch app, muted (a playback check makes no sound), closed normally at the end.
    Refuses an old build: on 2026-10-16 a build failed, the run went on against the last one, and
    its checks reported on code that was not there."""
    built = WORK / 'out/main/index.js'
    if not built.exists() or any(p.stat().st_mtime > built.stat().st_mtime for p in SRC.rglob('*') if p.is_file()):
        raise SystemExit(f'the scratch build is older than src/ — run build.sh again (if it failed: {WORK / "build.log"})')
    env ={k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={WORK / "ud"}',
                             f'--remote-debugging-port={port}', '--mute-audio'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield proc
    finally:
        proc.terminate()
        time.sleep(2)


def connect(p, port: int):
    for _ in range(60):
        try:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
            page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
            page.set_default_timeout(15000)
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            time.sleep(1.5)
            return b, page
        except Exception:
            time.sleep(0.5)
    raise SystemExit('the scratch app never opened — run build.sh first')


def open_zoom_note(page):
    page.locator('.tree-title', has_text='Zoom').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
    time.sleep(0.6)


def window_state(page) -> dict:
    """The waveform's visible stretch (the hidden seek slider's min/max follow it), the note's
    scroll, and which space is showing (by the sidebar's note names)."""
    return page.evaluate("""() => { const s = document.querySelector('.cm-voice-seek'); const sc = document.querySelector('.cm-scroller');
      return {min: s ? +(+s.min).toFixed(2) : null, max: s ? +(+s.max).toFixed(2) : null, scroll: sc ? Math.round(sc.scrollTop) : null,
        space: [...document.querySelectorAll('.tree-title')].map(e => e.textContent.trim()).join(',')} }""")
