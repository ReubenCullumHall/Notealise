"""Edit by the words (clipEdit/words.ts + WordList.tsx), in the real app with real input.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 words_check.py

Writes word times for the test recording the way Transcribe keeps them (.mdnotes/transcripts/,
stamped with the file's size and time), opens the editor, then: the words show; pressing a word
selects it and moves the playhead; dragging across words selects a run; Backspace cuts it and the
words go; Undo brings them back; the word being said is marked while it plays. A recording
changed since (another stamp) shows no words. Mac only as written."""
import hashlib, json, os, re, shutil, subprocess, sys, time, unicodedata
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402
from clip_edit import make_clip, vault  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def fake_words(total=26.0):
    """Words spread over three phrases, roughly where `say` speaks them in takes.m4a."""
    phrases = [(0.2, 4.2, 'Um okay la photosynthèse no wait'),
               (6.3, 10.8, 'Photosynthesis is how plants turn sunlight into food uh hang on'),
               (13.6, 23.5, 'Take three photosynthesis is how plants use light water and carbon dioxide to make glucose')]
    out = []
    for a, b, text in phrases:
        ws = text.split()
        step = (b - a) / len(ws)
        for i, w in enumerate(ws):
            out.append({'text': w, 'from': round((a + i * step) * 1000), 'to': round((a + (i + 0.8) * step) * 1000)})
    return out


def write_times(v, rel, words):
    st = (v / rel).stat()
    name = hashlib.sha256(unicodedata.normalize('NFC', rel).lower().encode()).hexdigest()[:32]
    d = v / '.mdnotes' / 'transcripts'
    d.mkdir(parents=True, exist_ok=True)
    (d / f'{name}.json').write_text(json.dumps({'v': 1, 'path': rel, 'size': st.st_size, 'mtimeMs': round(st.st_mtime_ns / 1e6), 'words': words}))


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken — pick a free one with PORT=')
    make_clip()
    v, ud = vault()
    words = fake_words()
    write_times(v, 'Biology/takes.m4a', words)
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
            time.sleep(0.6)
            page.locator('.cm-voice-editbtn').click()
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            page.wait_for_selector('.clip-ed-words', timeout=5000)
            time.sleep(0.4)
            n = page.locator('.clip-ed-word').count()
            check('the words show under the sound', n == len(words), f'{n} of {len(words)}')
            page.screenshot(path=str(WORK / 'words_1.png'))

            t0 = page.evaluate("() => document.querySelector('.clip-ed-time').textContent")
            page.locator('.clip-ed-word').nth(8).click()  # "is"
            time.sleep(0.3)
            sel = page.locator('.clip-ed-word.is-sel').all_text_contents()
            t1 = page.evaluate("() => document.querySelector('.clip-ed-time').textContent")
            check('pressing a word selects it', sel == [words[8]['text']], str(sel))
            check('and moves the playhead to it', t1 != t0 and '0:0' in t1, f'{t0} → {t1}')

            # drag across "uh hang on" (words 14–16)
            a = page.locator('.clip-ed-word').nth(14).bounding_box()
            z = page.locator('.clip-ed-word').nth(16).bounding_box()
            page.mouse.move(a['x'] + 3, a['y'] + a['height'] / 2)
            page.mouse.down()
            page.mouse.move(z['x'] + z['width'] / 2, z['y'] + z['height'] / 2, steps=6)
            page.mouse.up()
            time.sleep(0.3)
            sel = page.locator('.clip-ed-word.is-sel').all_text_contents()
            check('dragging across words selects the run', sel == ['uh', 'hang', 'on'], str(sel))
            check('the waveform shows the same selection', page.locator('.clip-ed-sel').count() == 1)
            total0 = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            page.keyboard.press('Backspace')
            time.sleep(0.4)
            total1 = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            texts = page.locator('.clip-ed-word').all_text_contents()
            check('Backspace cuts them out of the sound', total1 != total0, f'{total0} → {total1}')
            check('and the words go', 'hang' not in texts and len(texts) == len(words) - 3, ' '.join(texts[10:16]))
            page.screenshot(path=str(WORK / 'words_2.png'))
            page.keyboard.press('Meta+z')
            time.sleep(0.3)
            check('Undo brings them back', page.locator('.clip-ed-word').count() == len(words))

            # playing marks the word being said
            page.locator('.clip-ed-word').nth(20).click()
            page.keyboard.press(' ')
            time.sleep(1.2)
            now = page.evaluate("() => [...document.querySelectorAll('.clip-ed-word[data-now]')].map(e => +e.dataset.word)")
            page.keyboard.press(' ')
            check('playing marks the word being said (one, after the one pressed)', len(now) == 1 and now[0] > 20, str(now))

            # Escape (asks if changed) → close
            page.keyboard.press('Escape')
            time.sleep(0.5)
            if page.locator('.clip-ed').count():
                d = page.get_by_role('button', name=re.compile('Discard'))
                if d.count():
                    d.first.click()
            time.sleep(0.5)

            # a recording changed since it was transcribed: no words
            write_times(v, 'Biology/takes.m4a', words)
            raw = json.loads(next((v / '.mdnotes' / 'transcripts').glob('*.json')).read_text())
            raw['size'] += 1
            next((v / '.mdnotes' / 'transcripts').glob('*.json')).write_text(json.dumps(raw))
            page.locator('.cm-voice-editbtn').click()
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            time.sleep(0.8)
            check('a recording changed since shows no words', page.locator('.clip-ed-words').count() == 0)
            page.keyboard.press('Escape')
            check('no errors on the page', not errors, '; '.join(errors))
    finally:
        proc.terminate()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
