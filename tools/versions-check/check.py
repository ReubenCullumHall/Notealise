"""versions-check — Earlier versions of a note (docs/plans/note-versions.md) in the REAL app.

A scratch Electron build (build.sh) on its own profile and a throwaway vault, driven over
Playwright with real clicks and keys. Screenshots go to $WORK/shots.

    WORK=/some/scratch/dir ./build.sh && WORK=/some/scratch/dir python3 check.py

What it checks, in order:
  1. the first save of a note keeps the text from before it, as a plain .md in .mdnotes/versions/
  2. selecting a paragraph and deleting it keeps a copy straight away (inside the 5 minutes)
  3. a tab's right-click and a sidebar note's right-click both offer "Earlier versions…"
  4. the box lists the copies under "Today", shows the copy FORMATTED (no `#`, no `**`) and the
     deleted paragraph lit up under a "Removed since" bar with Put back
  5. Put back returns the paragraph to its place in the note (and on disk), keeps the text from
     before the Put back as a version, and the piece is no longer shown as removed
  6. Escape closes the box; the copies follow the note into the archive
  7. Restore whole note puts the oldest copy back and says so
  8. "When you close the note" (the default): closing a tab keeps the note as it closed
  9. Settings → Data → Earlier versions shows the choice and saves another one
 10. "When you close the app": closing a tab keeps nothing; quitting keeps each note typed in
It also fails on any error in the window's console.
"""
import json
import os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WIN = sys.platform == 'win32'
WORK = Path(os.environ.get('WORK', (os.environ.get('TEMP', '.') + '/notealise-check/versions') if WIN else '/tmp/versions-check'))
HERE = Path(__file__).resolve().parent
ELECTRON = (HERE.parents[1] / 'node_modules/electron/dist/electron.exe') if WIN else \
    Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
PORT, INSPECT = 9361, 9362
NODE = Path('node') if WIN else Path.home() / '.local/opt/node/bin/node'
SHOTS = WORK / 'shots'
VAULT = WORK / 'vault'
NOTE = 'Biology/Lecture 4.md'
PARA = 'The Krebs cycle runs in the mitochondrial matrix and turns acetyl-CoA into NADH, FADH2 and a little ATP.'
ORIGINAL = '# Week 4\n\nMitochondria make **most** of the cell\'s ATP.\n\n' + PARA + '\n\nGlycolysis happens first, in the cytoplasm.\n'

results: list[tuple[str, bool, str]] = []
errors: list[str] = []


def check(name: str, ok, detail: str = '') -> None:
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def write(rel: str, text: str) -> None:
    # LF on every machine (Windows Python would write CRLF); open() rather than
    # write_text(newline=), which this Mac's Python is too old for.
    with open(VAULT / rel, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def reset_vault() -> None:
    if VAULT.exists():
        shutil.rmtree(VAULT)
    (VAULT / 'Biology').mkdir(parents=True)
    write(NOTE, ORIGINAL)
    write('Biology/Other.md', '# Other\n\nSomething else.\n')
    (VAULT / '.mdnotes').mkdir()
    (VAULT / '.mdnotes/settings.json').write_text(json.dumps({
        'spaces': [{'folder': 'Biology', 'emoji': '🧬'}], 'activeSpaceFolder': 'Biology'}))
    ud = WORK / 'ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(VAULT), 'hasOnboarded': True}))


def launch() -> subprocess.Popen:
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    return subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={WORK / "ud"}',
                             f'--remote-debugging-port={PORT}', f'--inspect={INSPECT}', '--mute-audio'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def connect(p):
    for _ in range(80):
        try:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
            page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
            page.set_default_timeout(10000)
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.wait_for_selector('.tree-title')
            time.sleep(1.2)
            return b, page
        except Exception:
            time.sleep(0.5)
    raise SystemExit('the scratch app never opened — run build.sh first')


def version_files() -> list[Path]:
    root = VAULT / '.mdnotes/versions'
    return sorted(p for p in root.glob('*/*.md')) if root.exists() else []


def on_disk(rel: str = NOTE) -> str:
    return (VAULT / rel).read_text()


def copies_of(rel: str) -> list[str]:
    """The text of every copy kept of `rel`, oldest first."""
    out = []
    root = VAULT / '.mdnotes/versions'
    for info in root.glob('*/note.json') if root.exists() else []:
        if json.loads(info.read_text()).get('path') == rel:
            out += [p.read_text() for p in sorted(info.parent.glob('*.md'))]
    return out


def menu_items(page) -> list[str]:
    page.wait_for_selector('.menu')
    return [t.strip() for t in page.locator('.menu .menu-item').all_inner_texts()]


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    reset_vault()
    proc = launch()
    try:
        with sync_playwright() as p:
            b, page = connect(p)
            page.set_viewport_size({'width': 1280, 'height': 820})

            # 1. first save keeps the text from before it
            page.locator('aside .tree-title', has_text='Lecture 4').first.click()
            page.wait_for_selector('.cm-content')
            time.sleep(0.8)
            page.locator('.cm-line', has_text='Glycolysis').click()
            page.keyboard.press('End')
            page.keyboard.type(' Ten steps.')
            time.sleep(1.4)
            files = version_files()
            check('first save keeps one copy', len(files) == 1, f'{len(files)} files')
            check('the copy is the note as it was, word for word', files and files[0].read_text() == ORIGINAL)
            check('the copy is a plain .md named by time and note', files and files[0].name.endswith(' Lecture 4.md'),
                  files[0].name if files else '')
            info = json.loads((files[0].parent / 'note.json').read_text()) if files else {}
            check('its folder knows which note it belongs to', info.get('path') == NOTE, str(info))

            # 2. delete the paragraph: a copy straight away, well inside the 5 minutes
            page.locator('.cm-line', has_text='Krebs cycle').click(click_count=3)
            page.keyboard.press('Backspace')
            time.sleep(1.0)
            page.locator('.cm-line', has_text='Glycolysis').click()
            page.keyboard.press('End')
            page.keyboard.type(' Then the Krebs cycle.')
            time.sleep(1.4)
            check('the paragraph is gone from the note', PARA not in on_disk())
            files = version_files()
            check('deleting it kept a second copy at once', len(files) == 2, f'{len(files)} files')
            check('that copy still has the paragraph', files and PARA in files[-1].read_text())

            # 3. both right-click menus offer it
            page.locator('aside .tree-title', has_text='Lecture 4').first.click(button='right')
            items = menu_items(page)
            check('a note\'s right-click offers "Earlier versions…"', 'Earlier versions…' in items, ', '.join(items))
            page.keyboard.press('Escape')
            time.sleep(0.4)
            tab = page.locator('[role="tablist"] [role="tab"]', has_text='Lecture 4').first
            tab.click(button='right')
            items = menu_items(page)
            check('a tab\'s right-click offers "Earlier versions…"', 'Earlier versions…' in items, ', '.join(items))
            page.locator('.menu .menu-item', has_text='Earlier versions').first.click()

            # 4. the box
            page.wait_for_selector('.history .cm-content')
            time.sleep(0.9)
            rows = page.locator('.history-list [role="option"]')
            check('the box lists both copies', rows.count() == 2, f'{rows.count()} rows')
            check('under "Today"', page.locator('.history-day').first.inner_text().strip().lower() == 'today')
            shown = page.locator('.history-view .cm-content').inner_text()
            check('the copy is shown formatted: no heading #', '#' not in shown and 'Week 4' in shown)
            check('…and no bold **', '**' not in shown and 'most' in shown)
            bold = page.evaluate("""() => [...document.querySelectorAll('.history-view .cm-line *')]
              .some(e => e.textContent === 'most' && Number(getComputedStyle(e).fontWeight) >= 600)""")
            check('…and the bold word drawn bold', bold)
            gone = page.locator('.history-gone-bar')
            lit = ' '.join(page.locator('.history-gone-line').all_inner_texts())
            check('the deleted paragraph is lit up under one "Removed since" bar',
                  gone.count() == 1 and PARA in lit and 'Removed since' in gone.first.inner_text(), f'{gone.count()} bars')
            summary = page.locator('.history-summary').inner_text()
            check('the summary says one piece was removed', '1 piece removed since' in summary, summary)
            covered = page.evaluate("""() => {
              const b = document.querySelector('.history-gone-bar .mini').getBoundingClientRect()
              const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
              return el && el.closest('.mini') ? 'ok' : (el ? el.className : 'nothing')
            }""")
            check('nothing covers Put back', covered == 'ok', covered)
            page.screenshot(path=str(SHOTS / '1-box-light.png'))
            page.emulate_media(color_scheme='dark')
            time.sleep(0.6)
            page.screenshot(path=str(SHOTS / '2-box-dark.png'))
            page.emulate_media(color_scheme='light')
            time.sleep(0.4)

            # 5. Put back
            gone.first.locator('button', has_text='Put back').click()
            time.sleep(1.6)
            text = on_disk()
            check('Put back returns the paragraph to the note', PARA in text)
            check('…in its old place, between the two paragraphs it sat between',
                  text.index('Mitochondria') < text.index(PARA) < text.index('Glycolysis') if PARA in text else False)
            check('…and keeps the typing done since', 'Then the Krebs cycle.' in text)
            check('the piece is no longer shown as removed', page.locator('.history-gone-bar').count() == 0)
            files = version_files()
            check('the text before the Put back was kept as a version', len(files) == 3
                  and 'Then the Krebs cycle.' in files[-1].read_text() and PARA not in files[-1].read_text(),
                  f'{len(files)} files')
            check('the editor shows it too', page.locator('.cm-host .cm-line', has_text='Krebs cycle runs').count() == 1)
            focus = page.evaluate("() => !!document.activeElement?.closest('.history')")
            check('focus stays in the box, not the note behind it', focus)

            # 6. Escape, and the copies follow the note into the archive
            page.keyboard.press('Escape')
            time.sleep(0.6)
            check('Escape closes the box', page.locator('.history').count() == 0)
            tab.click(button='right')
            page.locator('.menu .menu-item', has_text='Move to archive').first.click()
            time.sleep(1.8)
            info = json.loads((version_files()[0].parent / 'note.json').read_text())
            check('the copies follow the note into the archive', info.get('path') == 'Archive/Lecture 4.md', str(info))

            # 7. Restore whole note — from the archive's own list
            page.locator('aside [data-tip="Archive — notes you have put away"]').first.click()
            time.sleep(1.2)
            page.locator('aside .tree-title', has_text='Lecture 4').first.click(button='right')
            page.locator('.menu .menu-item', has_text='Earlier versions').first.click()
            page.wait_for_selector('.history .cm-content')
            time.sleep(0.6)
            rows = page.locator('.history-list [role="option"]')
            # 3, or 4 when closing its tab on the way into the archive kept one more
            check('the archived note still has its copies', rows.count() in (3, 4), f'{rows.count()} rows')
            before_restore = len(version_files())
            rows.nth(rows.count() - 1).click()  # the oldest: the note as it first was
            time.sleep(0.8)
            page.locator('.history-foot button', has_text='Restore whole note').click()
            time.sleep(1.6)
            check('Restore whole note closes the box', page.locator('.history').count() == 0)
            note = page.locator('.notice').first.inner_text(timeout=3000).strip() if page.locator('.notice').count() else ''
            check('…and says what it did', note.startswith('Restored the version from'), note)
            check('the note is back to how it first was', on_disk('Archive/Lecture 4.md').replace('\r\n', '\n') == ORIGINAL)
            check('the text it replaced was kept', len(version_files()) in (before_restore, before_restore + 1)
                  and any(PARA in p.read_text() and 'Then the Krebs cycle.' in p.read_text() for p in version_files()),
                  f'{len(version_files())} files')

            # 8. "When you close the note": closing a tab keeps the note as it closed
            page.locator('aside [data-tip="Back to your notes"]').first.click()
            time.sleep(1.2)
            page.locator('aside .tree-title', has_text='Other').first.click()
            page.wait_for_selector('.cm-host .cm-content')
            time.sleep(0.8)
            page.locator('.cm-host .cm-line', has_text='Something else').click()
            page.keyboard.press('End')
            page.keyboard.type(' Typed before closing.')
            time.sleep(1.2)
            check('the first change to a note keeps it as it was', copies_of('Biology/Other.md') == ['# Other\n\nSomething else.\n'],
                  str(len(copies_of('Biology/Other.md'))))
            page.locator('[role="tablist"] [role="tab"]', has_text='Other').first.click(button='right')
            page.locator('.menu .menu-item', has_text='Close Other').first.click()
            time.sleep(1.5)
            kept = copies_of('Biology/Other.md')
            check('closing its tab keeps the note as it closed', len(kept) == 2 and 'Typed before closing.' in kept[-1],
                  f'{len(kept)} copies')

            # 9. the setting
            page.locator('button[aria-label="Settings"]').click()
            time.sleep(1.0)
            page.locator('[role="dialog"] button', has_text='Data').first.click()
            time.sleep(0.5)
            page.locator('[role="dialog"] button', has_text='Earlier versions').first.click()
            time.sleep(0.6)
            dlg = page.locator('[role="dialog"]').first
            check('Settings → Data → Earlier versions shows "Keep a copy"', 'Keep a copy' in dlg.inner_text())
            current = dlg.locator('button', has_text='When you close the note')
            check('…set to "When you close the note"', current.count() >= 1)
            page.screenshot(path=str(SHOTS / '3-setting.png'))
            current.first.click()
            time.sleep(0.4)
            page.get_by_text('Every minute while you write').first.click()
            time.sleep(1.2)
            saved = json.loads((VAULT / '.mdnotes/settings.json').read_text()).get('versionEvery')
            check('choosing "Every minute" saves it', saved == '1', str(saved))
            page.keyboard.press('Escape')
            time.sleep(1.0)

            # 10. "When you close the app"
            page.locator('button[aria-label="Settings"]').click()
            time.sleep(1.0)
            page.locator('[role="dialog"] button', has_text='Data').first.click()
            time.sleep(0.5)
            page.locator('[role="dialog"] button', has_text='Earlier versions').first.click()
            time.sleep(0.6)
            page.locator('[role="dialog"] button', has_text='Every minute while you write').first.click()
            time.sleep(0.4)
            page.get_by_text('When you close the app').first.click()
            time.sleep(1.2)
            saved = json.loads((VAULT / '.mdnotes/settings.json').read_text()).get('versionEvery')
            check('choosing "When you close the app" saves it', saved == 'quit', str(saved))
            page.keyboard.press('Escape')
            time.sleep(1.0)
            before = len(copies_of('Biology/Other.md'))
            page.locator('aside .tree-title', has_text='Other').first.click()
            page.wait_for_selector('.cm-host .cm-content')
            time.sleep(0.8)
            page.locator('.cm-host .cm-line', has_text='Something else').click()
            page.keyboard.press('End')
            page.keyboard.type(' Typed before quitting.')
            time.sleep(1.2)
            page.locator('[role="tablist"] [role="tab"]', has_text='Other').first.click(button='right')
            page.locator('.menu .menu-item', has_text='Close Other').first.click()
            time.sleep(1.5)
            check('…closing the tab keeps nothing on that choice', len(copies_of('Biology/Other.md')) == before,
                  f'{before} → {len(copies_of("Biology/Other.md"))}')
            check('no errors in the window', not errors, ' | '.join(errors[:3]))
            b.close()
            subprocess.run([str(NODE), str(HERE / 'quit.mjs'), str(INSPECT)], capture_output=True, timeout=20)
            try:
                proc.wait(15)
                quit_ok = True
            except subprocess.TimeoutExpired:
                quit_ok = False
            check('the app quits', quit_ok)
            kept = copies_of('Biology/Other.md')
            check('…and quitting kept the note typed in, as it was', len(kept) == before + 1
                  and 'Typed before quitting.' in kept[-1], f'{before} → {len(kept)}')

    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f'\n{passed}/{len(results)} passed — screenshots in {SHOTS}')
    sys.exit(0 if passed == len(results) else 1)


if __name__ == '__main__':
    main()
