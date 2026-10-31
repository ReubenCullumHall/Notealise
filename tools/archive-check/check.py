"""archive-check — the archive's round 2 (docs/plans/archive.md, 2026-10-26) in the REAL app.

A scratch Electron build (build.sh) on its own profile and a throwaway three-space vault, driven
over Playwright with real clicks. The menu bar item is clicked through the main process's
inspector (menu.mjs): CDP keys skip menu shortcuts, and real OS keys could land in another
window called "Electron". Screenshots go to $WORK/shots.

    WORK=/some/scratch/dir ./build.sh && WORK=/some/scratch/dir python3 check.py

What it checks, in order:
  1. a tab's right-click: "Move to archive" + "Close <name>"; archiving closes the tab; Undo brings
     the note back AND reopens its tab
  2. File → Move to Archive (Cmd/Ctrl+Shift+A registered) archives the note you're in
  3. a link to an archived note opens in the space you're in, with "In the archive" + Put back;
     the tab's right-click offers "Put back…"; Put back into this space keeps the tab, into another
     space closes it
  4. the archive's sort survives a restart
  5. right-click a space → "Archive this space" (you move to its neighbour), Put back offers
     "As its own space" and it comes back with its emoji and theme; Undo does the same
  6. a note not edited in 3+ months shows "?" over its six dots at rest; the pop-up asks "Want to
     archive?" with Yes / Never ask me this again; "never" sticks and Undo undoes it; in a selection
     the handle selects instead; Yes archives
It also fails on any error in the window's console.
"""
import json
import re, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WIN = sys.platform == 'win32'
WORK = Path(os.environ.get('WORK', (os.environ.get('TEMP', '.') + '/notealise-check/build') if WIN else '/tmp/archive-check'))
HERE = Path(__file__).resolve().parent
ELECTRON = (HERE.parents[1] / 'node_modules/electron/dist/electron.exe') if WIN else \
    Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
NODE = Path('node') if WIN else Path.home() / '.local/opt/node/bin/node'
PORT, INSPECT = 9351, 9352
SHOTS = WORK / 'shots'
VAULT = WORK / 'vault'
DAY = 86400

results: list[tuple[str, bool, str]] = []
errors: list[str] = []


def check(name: str, ok, detail: str = '') -> None:
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def write(rel: str, text: str, age_days: int = 0) -> None:
    p = VAULT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, newline='\n')  # LF on every machine (Windows Python would write CRLF)
    if age_days:
        t = time.time() - age_days * DAY
        os.utime(p, (t, t))


def reset_vault() -> None:
    if VAULT.exists():
        shutil.rmtree(VAULT)
    write('Revision/Index.md', '# Index\n\nSee [[Old trip]] for the trip.\n\nAnd [[Waves]].\n')
    write('Revision/Physics/Waves.md', '# Waves\n\nLight is a wave.\n')
    write('Revision/Lecture 1.md', '# Lecture 1\n\nLast term.\n', age_days=120)
    write('Journal/Ancient.md', '# Ancient\n\nWritten long ago.\n', age_days=150)
    write('Journal/Pinned old.md', '# Pinned old\n\nA favourite.\n', age_days=150)
    write('Journal/Recent.md', '# Recent\n\nToday.\n')
    write('Work/Plan.md', '# Plan\n\nThe plan.\n')
    write('Archive/Old trip.md', '# Old trip\n\nParis in the spring.\n')
    (VAULT / '.mdnotes').mkdir()
    (VAULT / '.mdnotes/settings.json').write_text(json.dumps({
        'spaces': [{'folder': 'Revision', 'emoji': '📚'}, {'folder': 'Journal', 'emoji': '📓', 'theme': 'dark'},
                   {'folder': 'Work'}],
        'activeSpaceFolder': 'Revision'}))
    (VAULT / '.mdnotes/workspace.json').write_text(json.dumps({'entries': {
        'Archive/Old trip.md': {'archivedFrom': 'Journal/Old trip.md', 'archivedAt': int((time.time() - 9 * DAY) * 1000)},
        'Journal/Pinned old.md': {'pinned': True}}, 'trash': [], 'recovery': []}))
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


def quit_app(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()


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


def settings() -> dict:
    return json.loads((VAULT / '.mdnotes/settings.json').read_text())


def workspace() -> dict:
    return json.loads((VAULT / '.mdnotes/workspace.json').read_text())


def titles(page) -> list[str]:
    return page.locator('aside .tree-title').all_inner_texts()


def tabs(page) -> list[str]:
    return [t.strip() for t in page.locator('[role="tablist"] [role="tab"]').all_inner_texts()]


def menu(page) -> list[str]:
    page.wait_for_selector('.menu')
    return [t.strip() for t in page.locator('.menu .menu-item').all_inner_texts()]


def pick(page, label: str) -> None:
    page.locator('.menu .menu-item', has_text=label).first.click()
    time.sleep(1.4)


def notice(page) -> str:
    try:
        return page.locator('.notice').first.inner_text(timeout=3000).strip()
    except Exception:
        return ''


def undo(page) -> None:
    page.locator('.notice .notice-action', has_text='Undo').first.click()
    time.sleep(1.6)


def open_note(page, title: str) -> None:
    page.locator('aside .tree-title', has_text=title).first.click()
    page.wait_for_selector('.cm-content')
    time.sleep(0.8)


def space_chip(page, name: str):
    return page.locator(f'aside button[aria-pressed][data-tip="{name}"]')


def go_space(page, name: str) -> None:
    space_chip(page, name).click()
    time.sleep(1.2)


def archive_button(page):
    return page.locator('aside [data-tip="Archive — notes you have put away"], aside [data-tip="Back to your notes"]').first


def toggle_month(page) -> None:
    """Settings → Archive → "Group by month", through the real window, then close Settings."""
    page.locator('button[aria-label="Settings"]').click()
    time.sleep(1.0)
    page.locator('[role="dialog"] button', has_text='Archive').first.click()
    time.sleep(0.6)
    page.locator('[role="dialog"] button', has_text='Group by month').click()
    time.sleep(0.8)
    page.keyboard.press('Escape')
    time.sleep(1.2)


def run_menu_bar(top: str, item: str) -> dict:
    out = subprocess.run([str(NODE), str(HERE / 'menu.mjs'), str(INSPECT), top, item], capture_output=True, text=True,
                         timeout=20)
    try:
        return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception:
        return {'error': out.stdout + out.stderr}


def row(page, title: str):
    return page.locator('aside .tree-row', has=page.locator('.tree-title', has_text=title)).first


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    reset_vault()
    with sync_playwright() as p:
        proc = launch()
        try:
            b, page = connect(p)

            # --- 1. a tab's right-click ---------------------------------------------------------
            open_note(page, 'Index')
            page.locator('[role="tab"]', has_text='Index').click(button='right')
            items = menu(page)
            page.screenshot(path=str(SHOTS / '1-tab-menu.png'))
            check('1 tab right-click lists Move to archive + Close', items == ['Move to archive', 'Close Index'], str(items))
            pick(page, 'Move to archive')
            check('1 the note moved into the archive', (VAULT / 'Archive/Index.md').exists()
                  and not (VAULT / 'Revision/Index.md').exists())
            check('1 its tab closed', 'Index' not in tabs(page), str(tabs(page)))
            check('1 the message offers Undo', notice(page).startswith('Archived “Index”.'), notice(page))
            undo(page)
            check('1 Undo puts it back', (VAULT / 'Revision/Index.md').exists())
            sel = page.locator('[role="tab"][aria-selected="true"]', has_text='Index').count()
            check('1 Undo reopens its tab, on screen', sel == 1, str(tabs(page)))

            # --- 2. File → Move to Archive ------------------------------------------------------
            r = run_menu_bar('File', 'Move to Archive')
            time.sleep(1.6)
            check('2 the menu item exists with Cmd/Ctrl+Shift+A',
                  r.get('found') and r.get('accelerator') == 'CommandOrControl+Shift+A', str(r))
            check('2 it archives the note you are in', (VAULT / 'Archive/Index.md').exists(), notice(page))
            undo(page)
            check('2 Undo again', (VAULT / 'Revision/Index.md').exists())

            # --- 3. a link to an archived note opens where you are ------------------------------
            open_note(page, 'Index')
            link = page.locator('.cm-content .cm-wikilink', has_text='Old trip').first
            box = link.bounding_box()
            page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            time.sleep(1.6)
            line = page.locator('.archive-line')
            check('3 still in Revision after following the link', settings()['activeSpaceFolder'] == 'Revision',
                  settings()['activeSpaceFolder'])
            check('3 the note opened in a tab here', 'Old trip' in tabs(page), str(tabs(page)))
            check('3 the line says "In the archive" with Put back', line.count() == 1
                  and 'In the archive' in line.inner_text() and 'Put back' in line.inner_text(),
                  line.inner_text() if line.count() else 'no line')
            check('3 the sidebar still shows Revision', 'Index' in titles(page), str(titles(page)))
            page.locator('.pane-col').first.screenshot(path=str(SHOTS / '3-archive-line.png'))
            strip = page.locator('.pane-col .links-block').first.inner_text()
            check('3 its links strip shows Index once (not a leftover from the earlier archive + Undo)',
                  strip.count('Index') == 1, strip.replace('\n', ' '))
            page.locator('[role="tab"]', has_text='Old trip').click(button='right')
            items = menu(page)
            check('3 an archived note’s tab offers Put back…', items == ['Put back…', 'Close Old trip'], str(items))
            page.keyboard.press('Escape')
            time.sleep(0.4)
            line.get_by_role('button', name='Put back').click()
            time.sleep(0.6)
            items = menu(page)
            page.screenshot(path=str(SHOTS / '3-put-back-menu.png'))
            heading = page.locator('.menu .menu-heading').first.inner_text()
            check('3 Put back opens "Put back in" with Journal marked',
                  heading == 'Put back in' and any('Journal' in i and 'where it came from' in i for i in items), str(items))
            pick(page, 'Revision')
            check('3 put back into this space', (VAULT / 'Revision/Old trip.md').exists())
            check('3 its tab stays, the line goes', 'Old trip' in tabs(page) and page.locator('.archive-line').count() == 0,
                  str(tabs(page)))
            # into another space: archive it from its tab, follow the link again, put it in Work
            page.locator('[role="tab"]', has_text='Old trip').click(button='right')
            menu(page)
            pick(page, 'Move to archive')
            page.locator('[role="tab"]', has_text='Index').click()
            time.sleep(0.6)
            link = page.locator('.cm-content .cm-wikilink', has_text='Old trip').first
            box = link.bounding_box()
            page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            time.sleep(1.6)
            page.locator('.archive-line').get_by_role('button', name='Put back').click()
            time.sleep(0.6)
            menu(page)
            pick(page, 'Work')
            check('3 put back into Work', (VAULT / 'Work/Old trip.md').exists())
            check('3 …and its tab left Revision’s strip', 'Old trip' not in tabs(page), str(tabs(page)))
            check('3 …and you stayed in Revision', settings()['activeSpaceFolder'] == 'Revision')

            page.mouse.move(900, 600)
            time.sleep(0.4)
            row(page, 'Lecture 1').screenshot(path=str(SHOTS / '6-row-rest-light.png'))

            # --- 4. the archive's sort survives a restart ---------------------------------------
            # (the sort picker only shows while the archive holds something)
            page.locator('[role="tab"]', has_text='Index').click(button='right')
            menu(page)
            pick(page, 'Move to archive')
            archive_button(page).click()
            time.sleep(1.2)
            page.locator('aside [data-tip="Sort the archive"]').click()
            page.locator('aside button', has_text='Title A–Z').click()
            time.sleep(1.0)
            check('4 the sort is saved', settings().get('archiveSort') == 'az', str(settings().get('archiveSort')))
            b.close()
            quit_app(proc)
            proc = launch()
            b, page = connect(p)
            shown = page.locator('aside [data-tip="Sort the archive"]').inner_text().strip()
            check('4 after a restart the archive still sorts A–Z', shown == 'A–Z', shown)

            # --- 4b. the spaces dim a little in the archive and the bin, and fade ---------------
            strip = space_chip(page, 'Revision').locator('xpath=..')
            fade = lambda: float(strip.evaluate('e => getComputedStyle(e).opacity'))
            check('4b in the archive the spaces are dimmed a little', 0.5 < fade() < 0.7, str(fade()))
            archive_button(page).click()
            time.sleep(0.15)
            mid = fade()
            time.sleep(1.0)
            check('4b leaving the archive fades them back up', mid < 0.99 and fade() == 1.0, f'{mid} then {fade()}')
            page.locator('aside [data-tip^="Bin — "]').click()
            time.sleep(0.15)
            mid = fade()
            time.sleep(1.0)
            check('4b the bin dims them too, easing in', 0.5 < fade() < 0.7 and mid > fade(), f'{mid} then {fade()}')
            page.locator('aside [data-tip="Back to your notes"]').first.click()
            time.sleep(1.2)

            # --- 4c. "Group by month": off until asked, headings only, nothing moves ----------------
            archive_button(page).click()
            time.sleep(1.2)
            check('4c no month headings by default', page.locator('aside p', has_text=re.compile(r'20\d\d$')).count() == 0)
            subprocess_settings = settings()
            check('4c the setting starts off', subprocess_settings.get('archiveByMonth') is False, str(subprocess_settings.get('archiveByMonth')))
            page.locator('aside [data-tip="Sort the archive"]').click()
            page.locator('aside button', has_text='Recently archived').click()
            time.sleep(0.6)
            on_disk_before = sorted(p.name for p in (VAULT / 'Archive').iterdir())
            toggle_month(page)
            check('4c the switch in Settings → Archive saves it', settings().get('archiveByMonth') is True, str(settings().get('archiveByMonth')))
            heads = page.locator('aside p', has_text=re.compile(r'20\d\d$')).all_inner_texts()
            check('4c turned on, a month heading shows above the archived notes', len(heads) >= 1, str(heads))
            page.locator('aside').screenshot(path=str(SHOTS / '4c-month-headings.png'))
            page.locator('aside [data-tip="Sort the archive"]').click()
            page.locator('aside button', has_text='Title A–Z').click()
            time.sleep(0.6)
            check('4c sorted by title the headings step aside', page.locator('aside p', has_text=re.compile(r'20\d\d$')).count() == 0)
            check('4c nothing moved on disk', sorted(p.name for p in (VAULT / 'Archive').iterdir()) == on_disk_before)
            toggle_month(page)
            archive_button(page).click()
            time.sleep(1.2)

            # --- 5. a whole space into the archive and back -------------------------------------
            space_chip(page, 'Journal').click(button='right')
            items = menu(page)
            check('5 a space’s right-click offers Archive this space', items[:2] == ['Archive this space', 'Delete space…'],
                  str(items))
            pick(page, 'Archive this space')
            time.sleep(0.8)
            s = settings()
            check('5 its folder went into the archive', (VAULT / 'Archive/Journal').is_dir() and not (VAULT / 'Journal').exists())
            check('5 it left the switcher', [x['folder'] for x in s['spaces']] == ['Revision', 'Work'],
                  str([x['folder'] for x in s['spaces']]))
            rec = (s.get('archivedSpaces') or [{}])[0]
            check('5 its look is kept', rec.get('path') == 'Archive/Journal' and rec.get('space', {}).get('emoji') == '📓'
                  and rec.get('space', {}).get('theme') == 'dark', json.dumps(rec)[:160])
            archive_button(page).click()
            time.sleep(1.2)
            jr = row(page, 'Journal')
            jr.hover()
            jr.locator('[aria-label="Put back…"]').click()
            time.sleep(0.6)
            items = menu(page)
            page.screenshot(path=str(SHOTS / '5-put-back-space.png'))
            check('5 Put back offers "As its own space" first', items and items[0].startswith('As its own space')
                  and 'where it came from' in items[0], str(items))
            pick(page, 'As its own space')
            s = settings()
            back = next((x for x in s['spaces'] if x['folder'] == 'Journal'), {})
            check('5 it is a space again, emoji and theme and all', back.get('emoji') == '📓' and back.get('theme') == 'dark',
                  json.dumps(back)[:120])
            check('5 its record is let go', not s.get('archivedSpaces'))
            check('5 the message says so', notice(page).startswith('Put back “Journal” as a space.'), notice(page))
            page.locator('.notice .notice-action', has_text='Show').click()
            time.sleep(1.2)
            check('5 Show goes to it', settings()['activeSpaceFolder'] == 'Journal')
            # from inside it, then Undo
            space_chip(page, 'Journal').click(button='right')
            menu(page)
            pick(page, 'Archive this space')
            time.sleep(0.8)
            check('5 archiving the space you are in moves you to its neighbour',
                  settings()['activeSpaceFolder'] == 'Work', settings()['activeSpaceFolder'])
            undo(page)
            back = next((x for x in settings()['spaces'] if x['folder'] == 'Journal'), {})
            check('5 Undo brings it back as a space with its look', back.get('emoji') == '📓' and back.get('theme') == 'dark'
                  and (VAULT / 'Journal').is_dir(), json.dumps(back)[:120])

            # --- 6. "Want to archive?" ----------------------------------------------------------
            go_space(page, 'Journal')
            page.mouse.move(900, 600)
            time.sleep(0.5)
            ancient = row(page, 'Ancient')
            g = ancient.locator('.grip')
            check('6 an old note shows "?" without hovering',
                  g.get_attribute('class').count('asks') == 1 and g.evaluate('e => getComputedStyle(e).opacity') == '1')
            check('6 a recent note does not', 'asks' not in row(page, 'Recent').locator('.grip').get_attribute('class'))
            check('6 a pinned old note does not', page.locator('aside .grip.asks').count() == 1,
                  str(page.locator('aside .grip.asks').count()))
            ancient.screenshot(path=str(SHOTS / '6-row-rest.png'))
            ancient.hover()
            time.sleep(0.3)
            ancient.screenshot(path=str(SHOTS / '6-row-hover.png'))
            g.click()
            time.sleep(0.5)
            items = menu(page)
            heading = page.locator('.menu .menu-heading').first.inner_text()
            note = page.locator('.menu .menu-note').first.inner_text()
            page.screenshot(path=str(SHOTS / '6-ask.png'))
            check('6 it asks "Want to archive?" with Yes / Never ask me this again',
                  heading == 'Want to archive?' and items == ['Yes', 'Never ask me this again'], f'{heading} {items}')
            check('6 and says how long', 'Ancient' in note and 'over 3 months' in note, note)
            pick(page, 'Never ask me this again')
            check('6 "never" takes the "?" away', ancient.locator('.grip.asks').count() == 0)
            check('6 …and is kept', workspace()['entries'].get('Journal/Ancient.md', {}).get('keepOutOfArchive') is True)
            check('6 …with Undo', notice(page).startswith('“Ancient” won’t ask again.'), notice(page))
            undo(page)
            check('6 Undo brings the "?" back', ancient.locator('.grip.asks').count() == 1
                  and 'keepOutOfArchive' not in workspace()['entries'].get('Journal/Ancient.md', {}))
            row(page, 'Recent').hover()
            row(page, 'Recent').locator('.grip').click()
            time.sleep(0.3)
            ancient.locator('.grip').click()
            time.sleep(0.4)
            check('6 in a selection the handle selects instead of asking', page.locator('.menu').count() == 0
                  and 'row-picked' in (ancient.get_attribute('class') or ''), ancient.get_attribute('class'))
            page.keyboard.press('Escape')
            time.sleep(0.4)
            ancient.locator('.grip').click()
            time.sleep(0.4)
            menu(page)
            pick(page, 'Yes')
            check('6 Yes archives it', (VAULT / 'Archive/Ancient.md').exists(), notice(page))

            # --- 7. imported old notes do not all ask "Want to archive?" at once -----------------
            src = WORK / 'import-src'
            shutil.rmtree(src, ignore_errors=True)
            src.mkdir(parents=True)
            for i, title in enumerate(['Old one', 'Old two']):
                f = src / f'{title}.md'
                f.write_text(f'# {title}\n\nFrom years ago.\n')
                t = time.time() - 700 * DAY
                os.utime(f, (t, t))
            out = subprocess.run([str(NODE), str(HERE / 'import.mjs'), str(INSPECT), str(src), 'Imported'],
                                 capture_output=True, text=True, timeout=60)
            try:
                done = json.loads(out.stdout.strip().splitlines()[-1])
            except Exception:
                done = {'error': out.stdout + out.stderr}
            check('7 a real import ran', done.get('createdNotes') == 2, json.dumps(done)[:200])
            folder = done.get('spaceFolder', 'Imported')
            time.sleep(1.5)  # the sidecar is written a moment after the change
            stamp = workspace()['entries'].get(folder, {}).get('importedAt')
            check('7 its new space is stamped with today', isinstance(stamp, (int, float)) and abs(stamp / 1000 - time.time()) < 300,
                  str(stamp))
            page.reload()
            time.sleep(2.5)
            space_chip(page, folder).click()
            time.sleep(1.2)
            oldies = page.locator('aside .tree-row', has=page.locator('.tree-title', has_text='Old '))
            check('7 the imported notes are in the sidebar', oldies.count() == 2, str(oldies.count()))
            check('7 …and none of them shows the "?"', page.locator('aside .grip.asks').count() == 0,
                  str(page.locator('aside .grip.asks').count()))

            check('no errors in the window', not errors, ' | '.join(errors)[:300])
            b.close()
        finally:
            quit_app(proc)
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed' + (f' — {len(failed)} FAILED' if failed else ''))


if __name__ == '__main__':
    main()
