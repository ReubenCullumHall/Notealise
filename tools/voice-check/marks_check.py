"""Marks while recording (Reuben, 2026-11-06), in the real app with a fake mic.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 marks_check.py

Record in A; mark with ⌘⇧M while typing, with the Mark button, and from the sidebar card while
in B; Stop: the voice note's line has a line of links under it, one per mark, and clicking one
plays the voice note from that moment."""
import os, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON, MOD  # noqa: E402
from away_check import vault  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken — pick a free one with PORT=')
    v, ud = vault()
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio', '--use-fake-device-for-media-stream'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)
            open_note = lambda n: (page.locator('.tree-title', has_text=re.compile(f'^{n}$')).first.click(), time.sleep(0.9))  # noqa: E731
            open_note('A')
            page.locator('.cm-line', has_text='Middle line.').first.click()
            page.keyboard.press('End')
            page.keyboard.press('Enter')
            page.keyboard.type('/voice')
            time.sleep(0.4)
            page.keyboard.press('Enter')
            time.sleep(0.5)
            page.get_by_role('button', name='Start recording').first.click()
            time.sleep(1.3)
            # type in the note while recording, mark with the key
            page.locator('.cm-line', has_text='First line.').first.click()
            page.keyboard.press('End')
            page.keyboard.type(' typing')
            page.keyboard.press(f'{MOD}+Shift+m')
            time.sleep(0.3)
            check('⌘⇧M marks, without typing an M', 'M' not in (v / 'Voice' / 'A.md').read_text().split('First line.')[1].split('\n')[0] and
                  '1 mark' in page.evaluate("() => document.querySelector('.cm-voice-rec-status')?.textContent ?? ''"),
                  page.evaluate("() => document.querySelector('.cm-voice-rec-status')?.textContent ?? ''"))
            time.sleep(1.2)
            page.get_by_role('button', name='Mark this moment').first.click()
            time.sleep(0.3)
            check('the Mark button marks', '2 marks' in page.evaluate("() => document.querySelector('.cm-voice-rec-status')?.textContent ?? ''"))
            page.screenshot(path=str(WORK / 'marks-recorder.png'))
            open_note('B')
            time.sleep(1.2)
            card = page.locator('[aria-label^="Recording into"]')
            card.get_by_role('button', name='Mark this moment').click()
            time.sleep(0.3)
            check('the sidebar card marks too', '3 marks' in card.inner_text(), card.inner_text())
            open_note('A')
            time.sleep(1.2)
            page.get_by_role('button', name='Stop').first.click()
            time.sleep(2)
            a = (v / 'Voice' / 'A.md').read_text()
            links = re.findall(r'\[(\d+:\d\d)\]\(([^)]+)#t=(\d+)\)', a)
            check('three mark links under the voice note', len(links) == 3, a.replace('\n', '⏎'))
            audio_line = next(i for i, l in enumerate(a.split('\n')) if '<audio' in l)
            check('…on the line straight under it', '#t=' in a.split('\n')[audio_line + 1], a.split('\n')[audio_line + 1] if audio_line + 1 < len(a.split('\n')) else '')
            secs = [int(t) for _, _, t in links]
            check('…in order, at the moments marked', secs == sorted(secs) and secs[0] >= 0, str(secs))
            time.sleep(0.8)
            page.locator('.cm-voice[data-state="ready"]').first.wait_for()
            pill = page.locator('.cm-momentlink').nth(1)
            check('they show as moment links', page.locator('.cm-momentlink').count() == 3)
            pill.click()
            time.sleep(1)
            t = page.evaluate("() => document.querySelector('.cm-voice-time')?.textContent")
            check('clicking one plays from its moment', t and t.startswith(f'0:0{secs[1]}') or t.startswith(f'0:0{secs[1] + 1}'), f'{t} (mark at {secs[1]} s)')
            check('no errors on the page', not errors, '; '.join(errors))
    finally:
        proc.terminate()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
