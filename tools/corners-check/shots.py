"""Corners (Settings → Look → Corners, per space) in the REAL app, with real clicks.

Builds nothing — run build.sh first. Seeds a two-space vault (Revision: a note with a maths box,
a table and a checklist, plus a second note open as a tab; Journal: one note), then:

  1. Look → Every space → Corners: clicks Sharp, Rounded, Extra round in turn and, for each,
     measures the corner of a tab, a space button, the maths box, a sidebar row, the gear and the
     search bar, and saves a picture of the whole window and of the picker.
  2. Spaces → Journal → Corners: sets Journal alone to Sharp, then switches spaces with the
     sidebar's space buttons and checks the corners follow the space.
  3. Quits, relaunches on the same profile and checks Journal still starts Sharp with no
     rounded first frame (the first-paint cache).

Pictures go to $WORK/shots. WORK defaults to /tmp/corners-check.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WIN = sys.platform == 'win32'
WORK = Path(os.environ.get('WORK', (os.environ.get('TEMP', '.') + '/notealise-check/build') if WIN else '/tmp/corners-check'))
ELECTRON = (Path(__file__).resolve().parents[2] / 'node_modules/electron/dist/electron.exe') if WIN else \
    Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
MOD = 'Control' if WIN else 'Meta'
SHOTS = WORK / 'shots'
PORT = 9339

MATHS = """# Quadratics

The roots of any quadratic:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

| a | b | c |
|---|---|---|
| 1 | -3 | 2 |

- [ ] Practise question 4
- [x] Factorise first

Some ==highlighted== words and a [[Physics]] link.
"""


def reset_vault() -> Path:
    vault = WORK / 'vault'
    if vault.exists():
        shutil.rmtree(vault)
    (vault / 'Revision' / 'Biology').mkdir(parents=True)
    (vault / 'Journal').mkdir()
    (vault / '.mdnotes').mkdir()
    (vault / 'Revision' / 'Maths.md').write_text(MATHS)
    (vault / 'Revision' / 'Physics.md').write_text('# Physics\n\nForces and motion.\n')
    (vault / 'Revision' / 'Biology' / 'Cells.md').write_text('# Cells\n\nMitochondria.\n')
    (vault / 'Journal' / 'Today.md').write_text('# Today\n\nA quiet day.\n')
    (vault / '.mdnotes' / 'settings.json').write_text(json.dumps({
        'spaces': [{'folder': 'Revision', 'emoji': '📘', 'theme': 'light'},
                   {'folder': 'Journal', 'emoji': '🌙', 'theme': 'light'}],
        'activeSpaceFolder': 'Revision'}))
    ud = WORK / 'ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
    return vault


def launch():
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    return subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={WORK / "ud"}',
                             f'--remote-debugging-port={PORT}', '--mute-audio'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def connect(p):
    for _ in range(60):
        try:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
            page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
            page.set_default_timeout(15000)
            time.sleep(1.5)
            return b, page
        except Exception:
            time.sleep(0.5)
    raise SystemExit('the scratch app never opened — run build.sh first')


# What each corner reads, by where you see it. Each is the first match on screen.
PROBES = """() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return 'missing';
    const cs = getComputedStyle(e); return cs.borderTopLeftRadius; };
  // (the --r-* values themselves read back as their unresolved calc() text, so
  // every probe is a real element's own corner)
  return {
    html: document.documentElement.dataset.corners,
    tab: r('[role="tab"]'),
    spaceButton: r('button[aria-pressed][data-tip="Journal"]'),
    gear: r('button[aria-label="Settings"]'),
    sidebarRow: r('.tree-row'),
    mathsBand: r('.cm-math-editing'),
    mathsBox: r('.cm-tooltip.cm-math-box'),
    mathsField: r('.cm-math-input'),
    search: r('.search-pill'),
    linkChip: r('.cm-wikilink-lead'),
    toggle: r('button[role="switch"]'),
  };
}"""


def open_settings(page, nav: str, page_label=None):
    page.locator('button[aria-label="Settings"]').first.click()
    time.sleep(0.8)
    page.get_by_text(nav, exact=True).first.click()
    time.sleep(0.4)
    if page_label:
        page.get_by_text(page_label, exact=True).first.click()
        time.sleep(0.4)


def open_advanced(page):
    """Corners sits open under the theme cards (it was in the Advanced fold for a day); this
    only opens Advanced if a later move puts it back behind a fold."""
    if page.locator('h3', has_text='Corners').count() == 0:
        page.get_by_text('Advanced', exact=True).first.click()
        time.sleep(0.6)


def corners_btn(page, label: str):
    return page.locator('section.settings-group', has=page.locator('h3', has_text='Corners')) \
        .locator('button.mode-btn', has_text=label).first


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    reset_vault()
    fails = []
    with sync_playwright() as p:
        proc = launch()
        try:
            b, page = connect(p)
            page.locator('.tree-title', has_text='Maths').first.click()
            time.sleep(0.6)
            page.locator('.tree-title', has_text='Physics').first.click(modifiers=[MOD])
            time.sleep(0.6)
            page.locator('.tree-title', has_text='Maths').first.click()
            time.sleep(1.0)
            before = page.evaluate(PROBES)
            print('start (should be the old look):', before)
            if (before['html'], before['tab'], before['spaceButton'], before['sidebarRow']) != ('rounded', '10px', '10px', '12px'):
                fails.append(f'default is not the old look: {before}')

            # 1. Look → Every space
            for label, key in (('Sharp', 'sharp'), ('Extra round', 'round'), ('Rounded', 'rounded')):
                open_settings(page, 'Look', 'Every space')
                open_advanced(page)
                btn = corners_btn(page, label)
                btn.scroll_into_view_if_needed()
                btn.click()
                time.sleep(0.6)
                sec = page.locator('section.settings-group', has=page.locator('h3', has_text='Corners')).first
                sec.screenshot(path=str(SHOTS / f'picker-{key}.png'))
                page.screenshot(path=str(SHOTS / f'settings-{key}.png'))
                page.keyboard.press('Escape')
                time.sleep(0.8)
                # open the maths box on the formula, so its corners are on screen too
                page.locator('.cm-math-display').first.click()
                time.sleep(0.8)
                got = page.evaluate(PROBES)
                print(f'{label:12}', got)
                page.screenshot(path=str(SHOTS / f'window-{key}.png'))
                page.keyboard.press('Escape')
                time.sleep(0.5)
                if got['html'] != key:
                    fails.append(f'{label}: <html> says {got["html"]}')
                want = {'sharp': ('0px', '0px'), 'rounded': ('4px', '10px'), 'round': ('5px', '12.5px')}[key]
                if (got['tab'], got['spaceButton']) != (want[1], want[1]):
                    fails.append(f'{label}: tab/space button {got["tab"]}/{got["spaceButton"]}, want {want[1]}')
                if (got['mathsBox'], got['mathsField']) != (want[1], want[0]):
                    fails.append(f'{label}: maths box/field {got["mathsBox"]}/{got["mathsField"]}, want {want[1]}/{want[0]}')

            # 2. Spaces → Journal → Sharp. Picking Journal's tab in Settings switches the app
            #    into Journal (that is how that page has always worked), so Revision is checked
            #    by going back to it with the sidebar's space button.
            open_settings(page, 'Spaces')
            page.locator('.space-tab', has_text='Journal').first.click()
            time.sleep(0.5)
            open_advanced(page)
            btn = corners_btn(page, 'Sharp')
            btn.scroll_into_view_if_needed()
            btn.click()
            time.sleep(0.5)
            page.screenshot(path=str(SHOTS / 'spaces-journal-sharp.png'))
            page.keyboard.press('Escape')
            time.sleep(0.8)
            page.locator('button[data-tip="Revision"]').first.click()
            time.sleep(1.2)
            here = page.evaluate(PROBES)
            print('back in Revision:', here['html'], here['tab'])
            if here['html'] != 'rounded':
                fails.append(f'Revision changed with Journal: {here["html"]}')
            page.locator('button[data-tip="Journal"]').first.click()
            time.sleep(1.2)
            there = page.evaluate(PROBES)
            print('in Journal:', there)
            page.screenshot(path=str(SHOTS / 'window-journal-sharp.png'))
            if there['html'] != 'sharp':
                fails.append(f'Journal is not sharp: {there["html"]}')
            # Look → Every space should now say the spaces differ
            open_settings(page, 'Look', 'Every space')
            open_advanced(page)
            note = page.locator('h3', has_text='Corners').locator('text=spaces differ').count()
            print('Every space → Corners says "spaces differ":', note > 0)
            if not note:
                fails.append('Every space did not say the spaces differ')
            page.keyboard.press('Escape')
            time.sleep(0.5)
            b.close()
        finally:
            proc.terminate()
            time.sleep(2.5)

        # 3. Relaunch in Journal — the very first paint should already be sharp
        proc = launch()
        try:
            b, page = connect(p)
            first = page.evaluate(PROBES)
            print('relaunch in Journal:', first['html'], first['spaceButton'])
            cache = json.loads((WORK / 'ud' / 'theme-cache.json').read_text())
            print('first-paint cache:', cache)
            if cache.get('corners') != 'sharp':
                fails.append(f'cache did not save corners: {cache}')
            if first['html'] != 'sharp':
                fails.append(f'relaunch not sharp: {first["html"]}')
            b.close()
        finally:
            proc.terminate()
            time.sleep(2)

    print('\nFAILS:' if fails else '\nall corner checks passed', *fails, sep='\n  ')
    print('pictures in', SHOTS)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
