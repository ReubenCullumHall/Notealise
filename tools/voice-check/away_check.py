"""Recording carries on when you switch notes (Reuben, 2026-11-06), in the real app with a fake mic.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 away_check.py

Record in A, switch to B: the recorder keeps going and a card shows in the sidebar; ↗ goes back
and the recorder is where it was; Pause/Resume from the card; Stop from the card while in B puts
the voice note in A where it was recorded (not at the end); closing A's tab mid-recording keeps it
going, and it lands in A when A is opened again."""
import json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def vault():
    v = WORK / 'away-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Voice').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    (v / 'Voice' / 'A.md').write_text('# A\n\nFirst line.\n\nMiddle line.\n\nLast line.\n')
    (v / 'Voice' / 'B.md').write_text('# B\n\nOther words.\n')
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Voice'}], 'activeSpaceFolder': 'Voice'}))
    ud = WORK / 'away-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken — pick a free one with PORT=')
    v, ud = vault()
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio', '--use-fake-device-for-media-stream'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    note = lambda n: (v / 'Voice' / f'{n}.md').read_text()  # noqa: E731
    try:
        with sync_playwright() as p:
            for _ in range(60):
                try:
                    b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                    page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
                    break
                except Exception:
                    time.sleep(0.5)
            page.set_default_timeout(15000)
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)
            open_note = lambda n: (page.locator('.tree-title', has_text=re.compile(f'^{n}$')).first.click(), time.sleep(0.9))  # noqa: E731
            card = lambda: page.locator('[aria-label^="Recording into"]')  # noqa: E731

            def record_in_a():
                open_note('A')
                page.locator('.cm-line', has_text='Middle line.').first.click()
                page.keyboard.press('End')
                page.keyboard.press('Enter')
                page.keyboard.type('/voice')
                time.sleep(0.4)
                page.keyboard.press('Enter')
                time.sleep(0.5)
                page.get_by_role('button', name='Start recording').first.click()
                time.sleep(1.5)

            # 1. switch away: it keeps going, the card shows
            record_in_a()
            open_note('B')
            time.sleep(1.2)
            check('switching notes keeps it recording: the card is in the sidebar', card().count() == 1)
            t1 = card().inner_text() if card().count() else ''
            time.sleep(1.2)
            t2 = card().inner_text() if card().count() else ''
            check('and its time keeps counting', t1 != t2 and 'Recording' in t2, f'{t1!r} → {t2!r}')
            check('nothing was added to A yet', note('A').count('<audio') == 0)
            page.screenshot(path=str(WORK / 'away-card.png'))

            # 2. Pause / Resume from the card
            card().get_by_role('button', name='Pause recording').click()
            time.sleep(0.4)
            check('Pause from the card', 'Paused' in card().inner_text(), card().inner_text())
            card().get_by_role('button', name='Resume recording').click()
            time.sleep(0.4)
            check('Resume from the card', 'Recording' in card().inner_text())

            # 3. ↗ back: the recorder is there again, still going
            card().get_by_role('button', name=re.compile('^Go back to')).click()
            time.sleep(1.5)
            check('↗ goes back to A with the recorder in it', page.locator('.cm-voice-rec').count() == 1 and card().count() == 0)
            pos_ok = page.evaluate("""() => { const r = document.querySelector('.cm-voice-rec'); const lines = [...document.querySelectorAll('.cm-line')];
              const mid = lines.find(l => l.textContent.includes('Middle line.')); const last = lines.find(l => l.textContent.includes('Last line.'));
              if (!r || !mid || !last) return false; const y = r.getBoundingClientRect().top; return y > mid.getBoundingClientRect().top && y < last.getBoundingClientRect().top }""")
            if not pos_ok:
                print('   ', page.evaluate("""() => [...document.querySelectorAll('.cm-line, .cm-voice-rec')].map(e => [e.className.slice(0, 20), e.textContent.slice(0, 20), Math.round(e.getBoundingClientRect().top)])"""))
                page.screenshot(path=str(WORK / 'away-back.png'))
            check('…where it was, between the middle and last lines', pos_ok)

            # 4. away again, Stop from the card: it lands in A where it was recorded
            open_note('B')
            time.sleep(1)
            card().get_by_role('button', name='Stop recording').click()
            time.sleep(2.5)
            print('   says:', page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''"))
            open_note('A')
            time.sleep(2)
            a = note('A')
            check('Stop from the card: it goes into A (when A opens)', a.count('<audio') == 1, a)
            check('…where it was recorded, not at the end', a.index('<audio') < a.index('Last line.'), a.replace('\n', '⏎'))
            check('the card goes', card().count() == 0)

            # 5. close A's tab mid-recording: keeps going; lands in A when it opens
            record_in_a()
            closed = False
            for el in page.locator('button[aria-label^="Close"]').all():
                try:
                    if el.is_visible():
                        el.click()
                        closed = True
                        break
                except Exception:
                    pass
            time.sleep(1.2)
            check('closing its tab keeps it recording (the card shows)', closed and card().count() == 1)
            card().get_by_role('button', name='Stop recording').click()
            time.sleep(2)
            print('   says:', page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''"))
            open_note('A')
            time.sleep(2)
            a = note('A')
            check('opening A adds it where it was recorded', a.count('<audio') == 2 and a.rindex('<audio') < a.index('Last line.'), a.replace('\n', '⏎'))

            # 6. a second /voice while one runs elsewhere says so
            record_in_a()
            open_note('B')
            time.sleep(0.8)
            page.locator('.cm-line', has_text='Other words.').first.click()
            page.keyboard.press('End')
            page.keyboard.press('Enter')
            page.keyboard.type('/voice')
            time.sleep(0.4)
            page.keyboard.press('Enter')
            time.sleep(0.6)
            msg = page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''")
            check('a second /voice elsewhere says one is already running', 'Already recording into A' in msg, msg)
            card().get_by_role('button', name='Stop recording').click()
            time.sleep(2)
            check('no errors on the page', not errors, '; '.join(errors))
    finally:
        proc.terminate()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
