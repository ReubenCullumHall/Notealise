"""Link to a moment in a voice note (editor/momentLink.ts), in the real app with real input.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 moment_check.py

Right-click the waveform → "Copy link to 0:13", paste it into a note in another folder (it must
re-point), click it there (it must open the voice note's note and play from 0:13), click one in
the same note, and click one whose recording is in no note. The Mac clipboard is put back after.
Mac only as written (afconvert, `say` via clip_edit.make_clip)."""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402
from clip_edit import make_clip  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def vault():
    v = WORK / 'moment-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Biology' / 'Revision').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    shutil.copy(WORK / 'takes.m4a', v / 'Biology' / 'takes.m4a')
    (v / 'Biology' / 'Photosynthesis.md').write_text(
        '# Photosynthesis\n\n<audio controls src="takes.m4a" data-name="Explain it" data-speed="1"></audio>\n\n'
        'Jump: [Explain it · 0:20](takes.m4a#t=20)\n\nGone: [Old · 0:03](gone.m4a#t=3)\n')
    (v / 'Biology' / 'Revision' / 'Cards.md').write_text('# Cards\n\nWhat is photosynthesis?\n')
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Biology'}], 'activeSpaceFolder': 'Biology'}))
    ud = WORK / 'moment-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


PLAYING = """() => { const b = document.querySelector('.cm-voice-play');
  return { playing: !!b && b.classList.contains('is-playing'),
           time: document.querySelector('.cm-voice-time')?.textContent ?? '' } }"""


def wait_playing(page, secs=6):
    end = time.time() + secs
    st = page.evaluate(PLAYING)
    while time.time() < end and not st['playing']:
        time.sleep(0.15)
        st = page.evaluate(PLAYING)
    return st


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken — pick a free one with PORT=')
    make_clip()
    v, ud = vault()
    saved_clip = subprocess.run(['pbpaste'], capture_output=True).stdout
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio'], env=env,
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
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)
            page.locator('.tree-title', has_text='Photosynthesis').first.click()
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
            time.sleep(0.8)

            # 1. the link's look: a pill with the play mark, the address hidden
            link = page.locator('.cm-momentlink', has_text='Explain it · 0:20')
            check('a moment link shows as its words, as a link', link.count() == 1)
            mark = page.evaluate("""() => { const el = document.querySelector('.cm-momentlink');
                return el ? getComputedStyle(el, '::before').maskImage.slice(0, 30) : '' }""")
            check('it carries the play mark', 'svg' in mark, mark)
            page.locator('.cm-editor').first.screenshot(path=str(WORK / 'moment.png'))

            # 2. right-click the middle of the waveform → Copy link to 0:13
            wave = page.locator('.cm-voice-wavebox').first.bounding_box()
            page.mouse.click(wave['x'] + wave['width'] * 0.5, wave['y'] + wave['height'] / 2, button='right')
            time.sleep(0.4)
            items = [t.strip() for t in page.locator('.menu .menu-item').all_text_contents()]
            copy = next((t for t in items if t.startswith('Copy link to')), '')
            check('right-clicking the waveform offers Copy link to the spot', copy == 'Copy link to 0:13', str(items))
            page.locator('.menu .menu-item', has_text='Copy link to').click()
            time.sleep(0.6)
            notice = page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''")
            check('it says the link was copied', 'Link to 0:13 copied' in notice, notice)
            clip = subprocess.run(['pbpaste'], capture_output=True, text=True).stdout
            check('the clipboard holds the link, written for this note', clip == '[Explain it · 0:13](takes.m4a#t=13)', clip)

            # 2b. right-click away from the waveform: where playback is (0:00 here)
            ctl = page.locator('.cm-voice-name').first.bounding_box()
            page.mouse.click(ctl['x'] + 4, ctl['y'] + ctl['height'] / 2, button='right')
            time.sleep(0.4)
            items = [t.strip() for t in page.locator('.menu .menu-item').all_text_contents()]
            check('off the waveform it offers where playback is', 'Copy link to 0:00' in items, str(items))
            page.keyboard.press('Escape')
            time.sleep(0.3)

            # 3. paste into a note in another folder: re-pointed
            if page.locator('.tree-title', has_text='Cards').count() == 0:
                page.locator('.tree-title', has_text='Revision').first.click()
                time.sleep(0.5)
            page.locator('.tree-title', has_text='Cards').first.click()
            page.wait_for_selector('.cm-content')
            time.sleep(0.6)
            page.locator('.cm-line', has_text='What is photosynthesis?').click()
            page.keyboard.press('End')
            page.keyboard.press('Enter')
            page.keyboard.press('Enter')
            page.evaluate("""(t) => { const dt = new DataTransfer(); dt.setData('text/plain', t);
                document.activeElement.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})) }""", clip)
            page.keyboard.press('Enter')
            time.sleep(1.5)
            cards = (v / 'Biology' / 'Revision' / 'Cards.md').read_text()
            check('pasted into a note in another folder, it still reaches the recording',
                  '[Explain it · 0:13](../takes.m4a#t=13)' in cards, cards)

            # 4. click it there: opens Photosynthesis and plays from 0:13
            page.locator('.cm-momentlink', has_text='Explain it · 0:13').click()
            st = wait_playing(page)
            active = page.evaluate("() => document.querySelector('.tab.active, [aria-selected=true]')?.textContent ?? ''")
            on = page.locator('.cm-voice').count() == 1
            check('clicking it opens the note with the voice note', on, active)
            check('and plays it from 0:13', st['playing'] and st['time'].startswith(('0:13', '0:14', '0:15')), str(st))
            vb = page.locator('.cm-voice').first.bounding_box()
            vh = page.evaluate('() => innerHeight')
            check('the voice note is on screen', vb and 0 <= vb['y'] and vb['y'] + vb['height'] <= vh, str(vb))
            page.locator('.cm-voice-play').click()  # pause
            time.sleep(0.3)

            # 5. a link in the same note: plays here from 0:20
            page.locator('.cm-momentlink', has_text='Explain it · 0:20').click()
            st = wait_playing(page)
            check('a link in the same note plays it from its time', st['playing'] and st['time'].startswith(('0:20', '0:21', '0:22')), str(st))
            page.locator('.cm-voice-play').click()
            time.sleep(0.3)

            # 6. a link whose recording is in no note: says so, nothing opens
            page.locator('.cm-momentlink', has_text='Old · 0:03').click()
            time.sleep(0.6)
            notice = page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''")
            check('a link to a recording in no note says so', "isn't in any note" in notice, notice)

            check('no errors on the page', not errors, '; '.join(errors))
    finally:
        proc.terminate()
        subprocess.run(['pbcopy'], input=saved_clip)
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
