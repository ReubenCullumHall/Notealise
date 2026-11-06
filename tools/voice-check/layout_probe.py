"""Voice notes in different app layouts, in a real window: the window at three sizes, with the
sidebar shown and hidden, one column and two/three side by side. For each, the voice note's
controls are hit-tested (each control's middle must be that control — "nothing covers a control"),
the editor panel must fit the window with its buttons reachable, and the /voice recorder is
opened in the narrowest column. Screenshots go to WORK/layout-*.png. A probe: prints what it finds.

    WORK=/some/dir ./build.sh && WORK=/some/dir PORT=9483 python3 layout_probe.py"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON, MOD  # noqa: E402
from clip_edit import make_clip  # noqa: E402

PORT = int(os.environ.get('PORT', '9483'))
problems = []

HIT = """(sel) => { const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) { out.push({cls: el.className.baseVal ?? el.className, hidden: true}); continue }
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    out.push({cls: String(el.className.baseVal ?? el.className).slice(0, 40), ok: !!hit && (hit === el || el.contains(hit)),
              hit: hit ? String(hit.className.baseVal ?? hit.className).slice(0, 40) : null, x: Math.round(x), y: Math.round(y),
              inWin: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, w: Math.round(r.width) })
  } return out }"""


def vault():
    v = WORK / 'layout-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Voice').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    shutil.copy(WORK / 'takes.m4a', v / 'Voice' / 'takes.m4a')
    body = 'Some words before it, a sentence long enough to wrap in a narrow column.\n\n<audio controls src="takes.m4a" data-name="Explain it with a rather long name for a voice note"></audio>\n\nAfter.\n'
    for n in ['Photosynthesis', 'Respiration', 'Osmosis']:
        (v / 'Voice' / f'{n}.md').write_text(f'# {n}\n\n' + body)
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Voice'}], 'activeSpaceFolder': 'Voice'}))
    ud = WORK / 'layout-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


def resize(pid, w, h):
    if sys.platform == 'win32':
        # The window of this process (its top-level, visible one), then SetWindowPos.
        import ctypes
        from ctypes import wintypes
        U = ctypes.windll.user32
        found = []
        def cb(hwnd, _):
            p = wintypes.DWORD()
            U.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            if U.IsWindowVisible(hwnd) and U.GetWindowTextLengthW(hwnd) > 0:
                found.append((hwnd, p.value))
            return True
        U.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(cb), 0)
        # Electron's window belongs to the main process or a child of it: take the first titled one of the app
        mine = [h for h, p in found if p == pid] or [h for h, p in found if subprocess.run(['powershell', '-NoProfile', '-Command', f'(Get-CimInstance Win32_Process -Filter "ProcessId={p}").ParentProcessId'], capture_output=True, text=True).stdout.strip() == str(pid)]
        if mine:
            U.SetWindowPos(mine[0], 0, 40, 40, w, h, 0x0004)
        time.sleep(0.8)
        return
    subprocess.run(['osascript', '-e', f'tell application "System Events" to tell (first process whose unix id is {pid}) to set size of window 1 to {{{w}, {h}}}',
                    '-e', f'tell application "System Events" to tell (first process whose unix id is {pid}) to set position of window 1 to {{40, 40}}'],
                   capture_output=True)
    time.sleep(0.8)


def blocks(page, label):
    # each voice note into view first: one below the window isn't "covered"
    for i in range(page.locator('.cm-voice').count()):
        page.locator('.cm-voice').nth(i).evaluate("(el) => el.scrollIntoView({block: 'center'})")
    time.sleep(0.3)
    sels = ['.cm-voice-play', '.cm-voice-wavebox', '.cm-voice-time', '.cm-voice-icon']
    res = page.evaluate(HIT, ', '.join(sels))
    bad = [r for r in res if not r.get('hidden') and (not r['ok'] or not r['inWin'])]
    widths = page.evaluate("() => [...document.querySelectorAll('.cm-voice-wavebox')].map(e => Math.round(e.getBoundingClientRect().width))")
    over = page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(e => e.scrollWidth - e.clientWidth)")
    print(f'  {label}: {len(res)} controls, waveform widths {widths}, overflow {over}')
    for r in bad:
        print('     COVERED/OUTSIDE:', r)
        problems.append((label, r))
    if any(o > 1 for o in over):
        problems.append((label, f'block overflows by {over}'))
    if any(w < 60 for w in widths):
        problems.append((label, f'waveform only {widths} px wide'))


def editor(page, label, shot):
    page.locator('.cm-voice-editbtn').first.click()
    page.wait_for_function("() => document.querySelector('.clip-ed') && !document.querySelector('.clip-ed-loading')", timeout=20000)
    time.sleep(0.5)
    r = page.evaluate("() => { const p = document.querySelector('.clip-ed').getBoundingClientRect(); return {l: Math.round(p.left), t: Math.round(p.top), r: Math.round(p.right), b: Math.round(p.bottom), W: innerWidth, H: innerHeight, sh: document.querySelector('.clip-ed').scrollHeight, ch: document.querySelector('.clip-ed').clientHeight} }")
    res = page.evaluate(HIT, '.clip-ed button, .clip-ed input[type=range], .clip-ed-in, .clip-ed-rulerrow')
    bad = [x for x in res if not x.get('hidden') and (not x['ok'] or not x['inWin'])]
    fits = r['l'] >= 0 and r['t'] >= 0 and r['r'] <= r['W'] and r['b'] <= r['H']
    print(f'  {label} editor: panel {r}, fits {fits}, {len(res)} controls, {len(bad)} covered/outside')
    for x in bad:
        print('     ', x)
        problems.append((label + ' editor', x))
    if not fits:
        problems.append((label + ' editor', f'panel outside the window {r}'))
    page.screenshot(path=str(WORK / f'layout-{shot}-editor.png'))
    page.keyboard.press('Escape')
    page.wait_for_selector('.clip-ed', state='detached', timeout=5000)
    time.sleep(0.3)


def main():
    make_clip()
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
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)
            page.locator('.tree-title', has_text='Photosynthesis').first.click()
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)

            for (w, h) in [(1400, 900), (1000, 700), (760, 560)]:
                resize(proc.pid, w, h)
                tag = f'{w}x{h}'
                print(f'window {tag}: page {page.evaluate("() => [innerWidth, innerHeight]")}')
                blocks(page, f'{tag} one column')
                page.screenshot(path=str(WORK / f'layout-{tag}-one.png'))
                editor(page, f'{tag} one column', f'{tag}-one')

                # two columns: Alt-click a second note in the sidebar
                page.locator('[data-tip^="Open another column"]').last.click()
                time.sleep(0.6)
                page.locator('.tree-title', has_text='Respiration').first.click()
                time.sleep(1.2)
                cols = page.locator('.cm-editor').count()
                blocks(page, f'{tag} {cols} columns')
                page.screenshot(path=str(WORK / f'layout-{tag}-two.png'))
                page.locator('[data-tip^="Open another column"]').last.click()
                time.sleep(0.6)
                page.locator('.tree-title', has_text='Osmosis').first.click()
                time.sleep(1.2)
                cols = page.locator('.cm-editor').count()
                blocks(page, f'{tag} {cols} columns')
                page.screenshot(path=str(WORK / f'layout-{tag}-three.png'))
                # sidebar hidden
                c = page.locator('[data-tip^="Collapse sidebar"]')
                if c.count():
                    c.first.click()
                    time.sleep(0.8)
                    blocks(page, f'{tag} {cols} columns, sidebar hidden')
                    page.screenshot(path=str(WORK / f'layout-{tag}-three-nosidebar.png'))
                    # the editor from the right-most column
                    last = page.locator('.cm-voice-editbtn').last
                    last.click()
                    page.wait_for_function("() => document.querySelector('.clip-ed') && !document.querySelector('.clip-ed-loading')", timeout=20000)
                    time.sleep(0.4)
                    page.keyboard.press('Escape')
                    page.wait_for_selector('.clip-ed', state='detached', timeout=5000)
                    show = page.locator('[data-tip^="Show sidebar"]')
                    if show.count():
                        show.first.evaluate('(el) => el.click()')
                        time.sleep(0.8)
                # back to one column: close the extra columns by opening Photosynthesis plainly
                for _ in range(3):
                    x = page.locator('[data-tip^="Close this note"]')
                    if x.count() == 0:
                        break
                    x.last.click()
                    time.sleep(0.5)
                print('  columns left:', page.locator('.cm-editor').count())

            # the recorder in the narrowest column: three columns at 760 wide
            for n in ['Respiration', 'Osmosis']:
                page.locator('[data-tip^="Open another column"]').last.click()
                time.sleep(0.6)
                page.locator('.tree-title', has_text=n).first.click()
                time.sleep(1)
            ed = page.locator('.cm-content').last
            ed.click()
            page.keyboard.press(f'{MOD}+ArrowDown')
            page.keyboard.press('Enter')
            page.keyboard.type('/voice')
            time.sleep(0.5)
            page.keyboard.press('Enter')
            time.sleep(0.8)
            rec = page.locator('.cm-voice-rec')
            print('recorder elements:', rec.count(), page.evaluate("() => [...document.querySelectorAll('[class*=rec]')].slice(0,6).map(e => e.className)"))
            page.screenshot(path=str(WORK / 'layout-recorder-narrow.png'))
            res = page.evaluate(HIT, '.cm-voice-rec button')
            print('  recorder buttons:', [(r.get('cls'), r.get('ok'), r.get('inWin'), r.get('w')) for r in res])
            start = page.get_by_role('button', name='Start recording')
            if start.count():
                start.first.click()
                time.sleep(3)
                page.screenshot(path=str(WORK / 'layout-recorder-live.png'))
                stop = page.get_by_role('button', name='Stop')
                if stop.count():
                    stop.first.click()
                    time.sleep(1.5)
            page.screenshot(path=str(WORK / 'layout-recorder-done.png'))
            print('Osmosis now:', (v / 'Voice' / 'Osmosis.md').read_text()[-200:])
            print('errors:', errors)
    finally:
        proc.terminate()
    print('\nPROBLEMS:', len(problems))
    for pr in problems:
        print(' -', pr)


if __name__ == '__main__':
    main()
