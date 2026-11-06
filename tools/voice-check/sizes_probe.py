"""Voice notes at different sizes, in a real window: how long things take and how long the window
freezes (Chromium 'longtask' entries — any stretch over 50 ms when nothing else can happen).

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 sizes_probe.py

Needs WORK/short.m4a (0.4 s), WORK/long25.m4a (25 min), WORK/long70.m4a (70 min) — see the README.
Prints a table; screenshots go to WORK/sizes-*.png. A probe, not a pass/fail check."""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))

WATCH = """() => { window.__lt = []; if (window.__obs) window.__obs.disconnect();
  window.__obs = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)) });
  window.__obs.observe({entryTypes: ['longtask']}) }"""
READ = "() => { const a = window.__lt || []; window.__lt = []; return {n: a.length, max: a.length ? Math.max(...a) : 0, sum: a.reduce((x, y) => x + y, 0)} }"


def vault():
    v = WORK / 'sizes-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Voice').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    for name, f in [('Short', 'short.m4a'), ('Long', 'long25.m4a'), ('Lecture', 'long70.m4a')]:
        shutil.copy(WORK / f, v / 'Voice' / f)
        (v / 'Voice' / f'{name}.md').write_text(f'# {name}\n\n<audio controls src="{f}" data-name="{name}"></audio>\n\nAfter.\n')
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Voice'}], 'activeSpaceFolder': 'Voice'}))
    ud = WORK / 'sizes-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


def main():
    v, ud = vault()
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rows = []

    def row(what, secs, lt):
        rows.append((what, secs, lt))
        print(f'{what:<58} {secs:>6.2f} s   freezes: {lt["n"]} (longest {lt["max"]} ms, total {lt["sum"]} ms)')

    try:
        with sync_playwright() as p:
            for _ in range(60):
                try:
                    b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                    page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
                    break
                except Exception:
                    time.sleep(0.5)
            page.set_default_timeout(120000)
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)

            for name in ['Short', 'Long', 'Lecture']:
                page.evaluate(WATCH)
                t = time.time()
                page.locator('.tree-title', has_text=name).first.click()
                page.wait_for_selector('.cm-voice:not([data-state="loading"])', timeout=120000)
                # the waveform arrives after the length
                end = time.time() + 60
                while time.time() < end and page.evaluate("() => { const b = document.querySelector('.cm-voice-wave'); return b && [...b.children].some(c => c.style.height && c.style.height !== '0px' && parseFloat(c.style.height) > 15) }") is False:
                    time.sleep(0.1)
                row(f'{name}: open the note until the waveform shows', time.time() - t, page.evaluate(READ))
                state = page.evaluate("() => document.querySelector('.cm-voice').dataset.state")
                dur = page.evaluate("() => document.querySelector('.cm-voice-time')?.textContent")
                print(f'   state {state}, time readout {dur}')
                page.screenshot(path=str(WORK / f'sizes-{name}-block.png'))

                # the editor
                page.evaluate(WATCH)
                t = time.time()
                page.locator('.cm-voice-editbtn').click()
                time.sleep(0.3)
                if page.locator('.clip-ed').count() == 0:
                    msg = page.evaluate("() => document.querySelector('.notice')?.textContent ?? ''")
                    row(f'{name}: editor refused', time.time() - t, page.evaluate(READ))
                    print('   says:', msg)
                    continue
                page.wait_for_function("() => !document.querySelector('.clip-ed-loading') && document.querySelector('.clip-ed-time em')?.textContent?.length", timeout=120000)
                row(f'{name}: open the editor until ready', time.time() - t, page.evaluate(READ))
                total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
                print('   length shown', total)
                page.screenshot(path=str(WORK / f'sizes-{name}-editor.png'))

                wave = page.locator('.clip-ed-in').bounding_box()
                y = wave['y'] + 60
                # select 40–45 % and delete
                page.mouse.move(wave['x'] + wave['width'] * 0.40, y)
                page.mouse.down()
                page.mouse.move(wave['x'] + wave['width'] * 0.45, y, steps=4)
                page.mouse.up()
                page.evaluate(WATCH)
                t = time.time()
                page.keyboard.press('Backspace')
                time.sleep(0.4)
                row(f'{name}: delete a stretch', time.time() - t - 0.4, page.evaluate(READ))

                page.evaluate(WATCH)
                t = time.time()
                page.keyboard.press(' ')
                page.wait_for_function("() => document.querySelector('.clip-ed-play')?.getAttribute('aria-label')?.startsWith('Pause') || document.querySelector('.clip-ed-play.is-playing')", timeout=60000)
                row(f'{name}: press Space after an edit until it plays', time.time() - t, page.evaluate(READ))
                time.sleep(0.6)
                page.keyboard.press(' ')

                # zoom all the way in and back out with the slider
                page.evaluate(WATCH)
                z = page.locator('.clip-ed-zoom input')
                print('   zoom slider enabled:', z.is_enabled())
                for k in (range(11) if z.is_enabled() else []):
                    z.evaluate('''(el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})) }''', str(round(k / 10, 2)))
                    time.sleep(0.03)
                for k in (range(10, -1, -1) if z.is_enabled() else []):
                    z.evaluate('''(el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})) }''', str(round(k / 10, 2)))
                    time.sleep(0.03)
                row(f'{name}: zoom in and out (22 slider steps)', 0, page.evaluate(READ))

                # Remove silences
                page.evaluate(WATCH)
                t = time.time()
                page.get_by_role('button', name='Remove silences').click()
                time.sleep(0.5)
                row(f'{name}: Remove silences', time.time() - t - 0.5, page.evaluate(READ))
                print('   says:', page.evaluate("() => document.querySelector('.clip-ed-foot, .clip-ed-summary')?.textContent ?? ''")[:120])

                # speed 1.5 and Save as new clip
                sp = page.locator('.clip-ed-speed input')
                if sp.count():
                    sp.evaluate("(el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '1.5'); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})) }")
                    print('   speed now', page.evaluate("() => document.querySelector('.clip-ed-speed')?.textContent"))
                page.evaluate(WATCH)
                t = time.time()
                page.get_by_role('button', name='Save as new clip').click()
                page.wait_for_selector('.clip-ed', state='detached', timeout=300000)
                row(f'{name}: Save as new clip at 1.5x until the panel closes', time.time() - t, page.evaluate(READ))
                time.sleep(1)
                print('   note now:', (v / 'Voice' / f'{name}.md').read_text().count('<audio'), 'voice notes;',
                      sorted(x.name for x in (v / 'Voice').iterdir() if x.suffix in ('.m4a', '.wav')))
            print('errors:', errors)
    finally:
        proc.terminate()


if __name__ == '__main__':
    main()
