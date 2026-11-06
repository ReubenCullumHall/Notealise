"""Save as you record (Reuben, 2026-11-06): a crash mid-recording keeps it.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 crash_check.py

1. Record ~4 s, then KILL the app (no quit, no saving). The pieces are on disk in
   .mdnotes/recording/. Start the app again: the recording is put back into its note,
   saved beside it as "Voice note … (recovered).m4a", and plays.
2. A normal Stop and a Discard leave nothing behind in .mdnotes/recording/."""
import os, re, signal, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402
from away_check import vault  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def launch(ud):
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    return subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio', '--use-fake-device-for-media-stream'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def connect(p):
    for _ in range(60):
        try:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
            page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
            page.set_default_timeout(15000)
            return b, page
        except Exception:
            time.sleep(0.5)
    raise SystemExit('no app')


def start_recording(page):
    page.locator('.tree-title', has_text=re.compile('^A$')).first.click()
    time.sleep(0.9)
    page.locator('.cm-line', has_text='Middle line.').first.click()
    page.keyboard.press('End')
    page.keyboard.press('Enter')
    page.keyboard.type('/voice')
    time.sleep(0.4)
    page.keyboard.press('Enter')
    time.sleep(0.5)
    page.get_by_role('button', name='Start recording').first.click()


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken — pick a free one with PORT=')
    v, ud = vault()
    kept = v / '.mdnotes' / 'recording'
    proc = launch(ud)
    try:
        with sync_playwright() as p:
            b, page = connect(p)
            time.sleep(1.5)
            start_recording(page)
            time.sleep(4.2)
            parts = list(kept.glob('*.part')) if kept.exists() else []
            size = parts[0].stat().st_size if parts else 0
            check('while recording, its pieces are on disk', len(parts) == 1 and size > 1000, f'{len(parts)} file(s), {size} bytes')
            time.sleep(1.2)
            size2 = parts[0].stat().st_size if parts else 0
            check('…and keep growing', size2 > size, f'{size} → {size2}')
            b.close()
        # the crash: kill the whole app, no chance to save
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=10)
        time.sleep(1)
        check('after the crash the note has no voice note yet', '<audio' not in (v / 'Voice' / 'A.md').read_text())
        # it must look finished-growing to be recovered (15 s): age the file rather than wait
        for f in kept.glob('*.part'):
            t = time.time() - 60
            os.utime(f, (t, t))
        proc = launch(ud)
        with sync_playwright() as p:
            b, page = connect(p)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(4)
            files = sorted(x.name for x in (v / 'Voice').iterdir() if 'recovered' in x.name)
            check('started again, the recording is saved beside its note', len(files) == 1, str(files))
            notice = page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''")
            check('it says so', 'Recovered a recording' in notice or '(recovered)' in notice, notice)
            page.locator('.tree-title', has_text=re.compile('^A$')).first.click()
            time.sleep(2)
            a = (v / 'Voice' / 'A.md').read_text()
            check('…and it is put into the note', 'recovered' in a and '<audio' in a, a.replace('\n', '⏎'))
            page.wait_for_selector('.cm-voice', timeout=10000)
            time.sleep(1.5)
            st = page.evaluate("() => [document.querySelector('.cm-voice')?.dataset.state, document.querySelector('.cm-voice-time')?.textContent]")
            check('it plays (about 5 s long)', st[0] == 'ready' and st[1] in ('0:04', '0:05', '0:06'), str(st))
            check('nothing is left in .mdnotes/recording', not list(kept.glob('*')), str(list(kept.glob('*'))))

            # 2. a normal Stop and a Discard leave nothing behind
            start_recording(page)
            time.sleep(2)
            page.get_by_role('button', name='Stop').first.click()
            time.sleep(2)
            check('a normal Stop leaves nothing kept', not list(kept.glob('*')), str(list(kept.glob('*'))))
            start_recording(page)
            time.sleep(4)
            page.get_by_role('button', name='Discard').first.click()
            time.sleep(0.3)
            yes = page.get_by_role('button', name='Yes, discard the recording')
            if yes.count():
                yes.first.click()
            time.sleep(1.5)
            check('a Discard leaves nothing kept', not list(kept.glob('*')), str(list(kept.glob('*'))))
            check('no errors on the page', not errors, '; '.join(errors))
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except Exception:
            pass
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
