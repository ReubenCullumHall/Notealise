"""Voice notes under awkward timing, in a real window (fake microphone):
  1. /voice, then switch to another note mid-recording, come back, Stop.
  2. /voice, then CLOSE the note's tab mid-recording; reopen it — what happened to the recording?
  3. Play a voice note, switch notes (the tape shows in the sidebar), come back, edit and Save —
     what does the tape hold and play afterwards?
  4. The same recording in two notes: Save in one — the other keeps the original.
A probe: prints what it finds; screenshots to WORK/behave-*.png.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 behave_probe.py"""
import json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402
from clip_edit import make_clip  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))


def vault():
    v = WORK / 'behave-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Voice').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    shutil.copy(WORK / 'takes.m4a', v / 'Voice' / 'takes.m4a')
    (v / 'Voice' / 'A.md').write_text('# A\n\nWords.\n')
    (v / 'Voice' / 'B.md').write_text('# B\n\nOther words.\n')
    (v / 'Voice' / 'C.md').write_text('# C\n\n<audio controls src="takes.m4a" data-name="Explain it"></audio>\n\nAfter.\n')
    (v / 'Voice' / 'D.md').write_text('# D\n\nThe same one: <audio controls src="takes.m4a"></audio>\n')
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Voice'}], 'activeSpaceFolder': 'Voice'}))
    ud = WORK / 'behave-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


def main():
    make_clip()
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
            page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            time.sleep(1.5)
            open_note = lambda n: (page.locator('.tree-title', has_text=re.compile(f'^{n}$')).first.click(), time.sleep(0.8))  # noqa: E731

            def record_in(n):
                open_note(n)
                page.locator('.cm-line', has_text='ords').first.click()
                page.keyboard.press('End')
                page.keyboard.press('Enter')
                page.keyboard.type('/voice')
                time.sleep(0.4)
                page.keyboard.press('Enter')
                time.sleep(0.5)
                page.get_by_role('button', name='Start recording').first.click()

            # 1. switch away mid-recording and back
            print('--- 1. switch notes while recording')
            record_in('A')
            time.sleep(1.5)
            open_note('B')
            time.sleep(1.5)
            print('   in B: recorder visible?', page.locator('.cm-voice-rec').count(), '| sidebar/tape says:',
                  page.evaluate("() => document.querySelector('[class*=deck]')?.textContent?.slice(0,80) ?? '-'"))
            open_note('A')
            time.sleep(0.5)
            print('   back in A: recorder visible?', page.locator('.cm-voice-rec').count(),
                  'time', page.evaluate("() => document.querySelector('.cm-voice-rec-time')?.textContent"))
            stop = page.get_by_role('button', name='Stop')
            if stop.count():
                stop.first.click()
            time.sleep(1.5)
            print('   A now has', note('A').count('<audio'), 'voice note(s)')

            # 2. close the tab mid-recording
            print('--- 2. close the note\'s tab while recording')
            record_in('B')
            time.sleep(1.5)
            tab = page.locator('[class*="tab"]', has_text=re.compile('^B$'))
            closed = False
            x = page.locator('.tab-close, [aria-label^="Close"]')
            # close the active tab with the app's own key (Cmd+W is a menu accelerator; CDP keys skip it)
            for el in page.locator('button[aria-label^="Close"]').all():
                try:
                    if el.is_visible():
                        el.click()
                        closed = True
                        break
                except Exception:
                    pass
            time.sleep(1.0)
            print('   closed a tab:', closed, '| tape/sidebar:', page.evaluate("() => document.body.innerText.includes('Recording') ? 'mentions Recording' : 'no Recording text'"))
            time.sleep(2)
            open_note('B')
            time.sleep(1)
            print('   reopened B: recorder visible?', page.locator('.cm-voice-rec').count(), '| B has', note('B').count('<audio'), 'voice note(s)')
            page.screenshot(path=str(WORK / 'behave-2.png'))
            stop = page.get_by_role('button', name='Stop')
            if stop.count():
                stop.first.click()
                time.sleep(1.5)
            print('   after Stop: B has', note('B').count('<audio'), 'voice note(s)')

            # 3. the tape and the editor
            print('--- 3. tape + editor')
            open_note('C')
            page.wait_for_selector('.cm-voice[data-state="ready"]')
            page.locator('.cm-voice-play').first.click()
            time.sleep(1)
            open_note('A')
            time.sleep(0.8)
            print('   tape in the sidebar:', page.evaluate("() => [...document.querySelectorAll('*')].filter(e => /deck/.test(e.className)).length"))
            open_note('C')
            page.locator('.cm-voice-editbtn').first.click()
            page.wait_for_function("() => document.querySelector('.clip-ed') && !document.querySelector('.clip-ed-loading')")
            wave = page.locator('.clip-ed-in').bounding_box()
            page.mouse.move(wave['x'] + wave['width'] * 0.1, wave['y'] + 60)
            page.mouse.down()
            page.mouse.move(wave['x'] + wave['width'] * 0.2, wave['y'] + 60, steps=3)
            page.mouse.up()
            page.keyboard.press('Backspace')
            page.get_by_role('button', name=re.compile('^Save$')).click()
            page.wait_for_selector('.clip-ed', state='detached')
            time.sleep(1.5)
            print('   C now:', re.findall(r'src="([^"]+)"', note('C')), '| D still:', re.findall(r'src="([^"]+)"', note('D')))
            print('   notice:', page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''"))
            open_note('A')
            time.sleep(0.8)
            deck = page.evaluate("() => { const d = [...document.querySelectorAll('[class*=deck]')][0]; return d ? d.textContent.slice(0, 80) : null }")
            print('   tape after Save, from another note:', deck)
            page.screenshot(path=str(WORK / 'behave-3.png'))
            print('errors:', errors[:6])
    finally:
        proc.terminate()


if __name__ == '__main__':
    main()
